import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

import { createApiServer } from "../src/createApiServer";
import type { GitHubRepoSummarySnapshot } from "../src/githubRepoSummary";
import { MAX_CHILDREN_PER_PARENT } from "../src/terminalRuntime";
import type { GitClient } from "../src/terminalRuntime";

class FakeGitClient implements GitClient {
  private readonly worktreeStatusByCwd = new Map<
    string,
    {
      branchName: string;
      upstreamBranchName: string | null;
      isDirty: boolean;
      aheadCount: number;
      behindCount: number;
      insertedLineCount: number;
      deletedLineCount: number;
      hasConflicts: boolean;
      changedFiles: string[];
      defaultBaseBranchName: string | null;
    }
  >();
  private readonly commitsByCwd = new Map<string, string[]>();
  private readonly pushesByCwd = new Map<string, number>();
  private readonly syncsByCwd = new Map<string, string[]>();
  private readonly pullRequestByCwd = new Map<
    string,
    {
      number: number;
      url: string;
      title: string;
      baseRef: string;
      headRef: string;
      state: "OPEN" | "MERGED" | "CLOSED";
      isDraft: boolean;
      mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
      mergeStateStatus: string | null;
    } | null
  >();
  private readonly worktrees = new Map<
    string,
    { branchName: string; baseRef: string; cwd: string }
  >();
  private readonly branches = new Set<string>();
  private repositoryAvailable = true;
  private failRemoveWorktree = false;
  private failCommit = false;
  private failPush = false;
  private failSync = false;
  private failCreatePullRequest = false;
  private failMergePullRequest = false;

  assertAvailable(): void {}

  isRepository(): boolean {
    return this.repositoryAvailable;
  }

  addWorktree({
    cwd,
    path,
    branchName,
    baseRef,
  }: {
    cwd: string;
    path: string;
    branchName: string;
    baseRef: string;
  }): void {
    if (this.worktrees.has(path)) {
      throw new Error(`Worktree already exists: ${path}`);
    }
    mkdirSync(path, { recursive: true });
    this.branches.add(branchName);
    this.worktrees.set(path, { cwd, branchName, baseRef });
    this.worktreeStatusByCwd.set(path, {
      branchName,
      upstreamBranchName: null,
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
    this.pullRequestByCwd.set(path, null);
  }

  removeWorktree({ path }: { cwd: string; path: string }): void {
    if (this.failRemoveWorktree) {
      throw new Error(`Unable to remove worktree: ${path}`);
    }
    this.worktrees.delete(path);
    this.worktreeStatusByCwd.delete(path);
    this.commitsByCwd.delete(path);
    this.pushesByCwd.delete(path);
    this.syncsByCwd.delete(path);
    this.pullRequestByCwd.delete(path);
  }

  removeBranch({ branchName }: { cwd: string; branchName: string }): void {
    this.branches.delete(branchName);
  }

  setRepositoryAvailable(available: boolean): void {
    this.repositoryAvailable = available;
  }

  setFailRemoveWorktree(shouldFail: boolean): void {
    this.failRemoveWorktree = shouldFail;
  }

  setFailCommit(shouldFail: boolean): void {
    this.failCommit = shouldFail;
  }

  setFailPush(shouldFail: boolean): void {
    this.failPush = shouldFail;
  }

  setFailSync(shouldFail: boolean): void {
    this.failSync = shouldFail;
  }

  setFailCreatePullRequest(shouldFail: boolean): void {
    this.failCreatePullRequest = shouldFail;
  }

  setFailMergePullRequest(shouldFail: boolean): void {
    this.failMergePullRequest = shouldFail;
  }

  setWorktreeStatus(
    cwd: string,
    status: {
      branchName: string;
      upstreamBranchName: string | null;
      isDirty: boolean;
      aheadCount: number;
      behindCount: number;
      insertedLineCount: number;
      deletedLineCount: number;
      hasConflicts: boolean;
      changedFiles: string[];
      defaultBaseBranchName: string | null;
    },
  ): void {
    this.worktreeStatusByCwd.set(cwd, status);
  }

  readWorktreeStatus({
    cwd,
  }: {
    cwd: string;
  }): {
    branchName: string;
    upstreamBranchName: string | null;
    isDirty: boolean;
    aheadCount: number;
    behindCount: number;
    insertedLineCount: number;
    deletedLineCount: number;
    hasConflicts: boolean;
    changedFiles: string[];
    defaultBaseBranchName: string | null;
  } {
    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }
    return {
      ...status,
      changedFiles: [...status.changedFiles],
    };
  }

  commitAll({ cwd, message }: { cwd: string; message: string }): void {
    if (this.failCommit) {
      throw new Error("Simulated commit failure");
    }

    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }
    if (!status.isDirty) {
      throw new Error("No local changes to commit.");
    }

    const commits = this.commitsByCwd.get(cwd) ?? [];
    commits.push(message);
    this.commitsByCwd.set(cwd, commits);
    this.worktreeStatusByCwd.set(cwd, {
      ...status,
      isDirty: false,
      changedFiles: [],
      aheadCount: status.aheadCount + 1,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
    });
  }

  pushCurrentBranch({ cwd }: { cwd: string }): void {
    if (this.failPush) {
      throw new Error("Simulated push failure");
    }

    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }

    this.pushesByCwd.set(cwd, (this.pushesByCwd.get(cwd) ?? 0) + 1);
    this.worktreeStatusByCwd.set(cwd, {
      ...status,
      upstreamBranchName: status.upstreamBranchName ?? `origin/${status.branchName}`,
      aheadCount: 0,
    });
  }

  syncWithBase({ cwd, baseRef }: { cwd: string; baseRef: string }): void {
    if (this.failSync) {
      throw new Error("Simulated sync failure");
    }

    const status = this.worktreeStatusByCwd.get(cwd);
    if (!status) {
      throw new Error(`Missing fake status for ${cwd}`);
    }
    const syncs = this.syncsByCwd.get(cwd) ?? [];
    syncs.push(baseRef);
    this.syncsByCwd.set(cwd, syncs);
    this.worktreeStatusByCwd.set(cwd, {
      ...status,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
    });
  }

  setWorktreePullRequest(
    cwd: string,
    pullRequest: {
      number: number;
      url: string;
      title: string;
      baseRef: string;
      headRef: string;
      state: "OPEN" | "MERGED" | "CLOSED";
      isDraft: boolean;
      mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
      mergeStateStatus: string | null;
    } | null,
  ): void {
    this.pullRequestByCwd.set(cwd, pullRequest);
  }

  readCurrentBranchPullRequest({
    cwd,
  }: {
    cwd: string;
  }): {
    number: number;
    url: string;
    title: string;
    baseRef: string;
    headRef: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    isDraft: boolean;
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    mergeStateStatus: string | null;
  } | null {
    const pullRequest = this.pullRequestByCwd.get(cwd);
    if (pullRequest === undefined || pullRequest === null) {
      return null;
    }

    return {
      ...pullRequest,
    };
  }

  createPullRequest({
    cwd,
    title,
    baseRef,
    headRef,
  }: {
    cwd: string;
    title: string;
    body: string;
    baseRef: string;
    headRef: string;
  }): {
    number: number;
    url: string;
    title: string;
    baseRef: string;
    headRef: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    isDraft: boolean;
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    mergeStateStatus: string | null;
  } | null {
    if (this.failCreatePullRequest) {
      throw new Error("Simulated create PR failure");
    }

    const nextNumber = (this.pullRequestByCwd.get(cwd)?.number ?? 100) + 1;
    const pullRequest = {
      number: nextNumber,
      url: `https://github.com/hesamsheikh/octogent/pull/${nextNumber}`,
      title,
      baseRef,
      headRef,
      state: "OPEN" as const,
      isDraft: false,
      mergeable: "MERGEABLE" as const,
      mergeStateStatus: "CLEAN",
    };
    this.pullRequestByCwd.set(cwd, pullRequest);
    return pullRequest;
  }

  mergeCurrentBranchPullRequest({
    cwd,
  }: {
    cwd: string;
    strategy: "squash" | "merge" | "rebase";
  }): void {
    if (this.failMergePullRequest) {
      throw new Error("Simulated merge PR failure");
    }

    const pullRequest = this.pullRequestByCwd.get(cwd);
    if (!pullRequest) {
      throw new Error("No open pull request for this branch.");
    }

    this.pullRequestByCwd.set(cwd, {
      ...pullRequest,
      state: "MERGED",
      mergeable: "UNKNOWN",
      mergeStateStatus: "MERGED",
    });
  }

  getWorktree(path: string): { branchName: string; baseRef: string; cwd: string } | null {
    return this.worktrees.get(path) ?? null;
  }

  hasBranch(branchName: string): boolean {
    return this.branches.has(branchName);
  }

  getLastCommitMessage(cwd: string): string | null {
    const commits = this.commitsByCwd.get(cwd);
    if (!commits || commits.length === 0) {
      return null;
    }
    return commits[commits.length - 1] ?? null;
  }

  getPushCount(cwd: string): number {
    return this.pushesByCwd.get(cwd) ?? 0;
  }

  getSyncBaseRefs(cwd: string): string[] {
    return [...(this.syncsByCwd.get(cwd) ?? [])];
  }

  getPullRequestState(cwd: string): "OPEN" | "MERGED" | "CLOSED" | null {
    return this.pullRequestByCwd.get(cwd)?.state ?? null;
  }
}

describe("createApiServer", () => {
  let stopServer: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const startServer = async (options: Partial<Parameters<typeof createApiServer>[0]> = {}) => {
    const workspaceCwd =
      options.workspaceCwd ??
      (() => {
        const directory = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
        temporaryDirectories.push(directory);
        return directory;
      })();
    const apiServer = createApiServer({
      workspaceCwd,
      gitClient: options.gitClient ?? new FakeGitClient(),
      ...options,
    });
    const address = await apiServer.start(0, "127.0.0.1");
    stopServer = () => apiServer.stop();
    return `http://${address.host}:${address.port}`;
  };

  const toWebSocketBaseUrl = (httpBaseUrl: string) =>
    httpBaseUrl.startsWith("https://")
      ? httpBaseUrl.replace("https://", "wss://")
      : httpBaseUrl.replace("http://", "ws://");

  const waitForRegistryDocument = async <TDocument>(
    workspaceCwd: string,
    predicate: (document: TDocument) => boolean,
  ): Promise<TDocument> => {
    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    // Generous deadline: under heavy parallel test load on Windows, file
    // persistence can land just after a tight 2s window, causing spurious flakes.
    const timeoutAt = Date.now() + 15_000;

    while (Date.now() < timeoutAt) {
      if (existsSync(registryPath)) {
        const document = JSON.parse(readFileSync(registryPath, "utf8")) as TDocument;
        if (predicate(document)) {
          return document;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Timed out waiting for registry persistence at ${registryPath}`);
  };

  const writeConversationTranscript = (
    workspaceCwd: string,
    sessionId: string,
    events: unknown[],
  ) => {
    const transcriptDirectory = join(workspaceCwd, ".octogent", "state", "transcripts");
    mkdirSync(transcriptDirectory, { recursive: true });
    const transcriptPath = join(transcriptDirectory, `${encodeURIComponent(sessionId)}.jsonl`);
    writeFileSync(
      transcriptPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
  };

  const writeClaudeTurns = (
    workspaceCwd: string,
    sessionId: string,
    turns: Array<{
      turnId: string;
      role: string;
      content: string;
      startedAt: string;
      endedAt: string;
    }>,
  ) => {
    const transcriptDirectory = join(workspaceCwd, ".octogent", "state", "transcripts");
    mkdirSync(transcriptDirectory, { recursive: true });
    const turnsPath = join(
      transcriptDirectory,
      `${encodeURIComponent(sessionId)}.claude-turns.json`,
    );
    writeFileSync(turnsPath, JSON.stringify(turns), "utf8");
  };

  describe("bearer token auth", () => {
    it("reports auth as not required and serves API routes openly when no token is configured", async () => {
      const baseUrl = await startServer();

      const statusResponse = await fetch(`${baseUrl}/api/auth/status`);
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toEqual({ authRequired: false });

      const openResponse = await fetch(`${baseUrl}/api/terminal-snapshots`);
      expect(openResponse.status).toBe(200);
    });

    it("rejects API requests without or with a wrong token when auth is enabled", async () => {
      const baseUrl = await startServer({ authToken: "test-secret-token" });

      const missingResponse = await fetch(`${baseUrl}/api/terminal-snapshots`);
      expect(missingResponse.status).toBe(401);
      await expect(missingResponse.json()).resolves.toEqual({
        error: "Authentication required.",
      });

      const wrongResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(wrongResponse.status).toBe(401);
    });

    it("accepts the token via Authorization header and via ?token= query parameter", async () => {
      const baseUrl = await startServer({ authToken: "test-secret-token" });

      const headerResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
        headers: { Authorization: "Bearer test-secret-token" },
      });
      expect(headerResponse.status).toBe(200);

      const queryResponse = await fetch(
        `${baseUrl}/api/terminal-snapshots?token=test-secret-token`,
      );
      expect(queryResponse.status).toBe(200);
    });

    it("keeps /api/auth/status public so the UI can discover the auth requirement", async () => {
      const baseUrl = await startServer({ authToken: "test-secret-token" });

      const statusResponse = await fetch(`${baseUrl}/api/auth/status`);
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toEqual({ authRequired: true });
    });

    it("verifies tokens via POST /api/auth/verify", async () => {
      const baseUrl = await startServer({ authToken: "test-secret-token" });

      const validResponse = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { Authorization: "Bearer test-secret-token" },
      });
      expect(validResponse.status).toBe(204);

      const invalidResponse = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { Authorization: "Bearer nope" },
      });
      expect(invalidResponse.status).toBe(401);
    });

    it("answers OPTIONS preflight without a token when auth is enabled", async () => {
      const baseUrl = await startServer({ authToken: "test-secret-token" });

      const preflightResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
        method: "OPTIONS",
      });
      expect(preflightResponse.status).toBe(204);
    });

    it("treats an exempt path with a trailing slash as exempt (not a 401)", async () => {
      const baseUrl = await startServer({ authToken: "test-secret-token" });

      // "/api/auth/status/" normalizes to the exempt "/api/auth/status", so the
      // gate must not reject it with 401 (it 404s — no exact handler match —
      // which still proves the trailing slash was treated as exempt).
      const slashResponse = await fetch(`${baseUrl}/api/auth/status/`);
      expect(slashResponse.status).not.toBe(401);
    });

    it("serves the static web bundle without a token so the token prompt can load", async () => {
      const webDistDir = mkdtempSync(join(tmpdir(), "octogent-webdist-test-"));
      temporaryDirectories.push(webDistDir);
      writeFileSync(join(webDistDir, "index.html"), "<html><body>jarvis</body></html>", "utf8");

      const baseUrl = await startServer({ authToken: "test-secret-token", webDistDir });

      const htmlResponse = await fetch(`${baseUrl}/`);
      expect(htmlResponse.status).toBe(200);
      await expect(htmlResponse.text()).resolves.toContain("jarvis");
    });
  });

  describe("home tiles", () => {
    it("reports not-configured tiles when no sources are available", async () => {
      vi.stubEnv("OBSIDIAN_VAULT_PATH", "");
      vi.stubEnv("GMAIL_REFRESH_TOKEN", "");
      vi.stubEnv("APOLLO_API_KEY", "");
      vi.stubEnv("LOCALFALCON_API_KEY", "");

      const baseUrl = await startServer();
      const response = await fetch(`${baseUrl}/api/tiles`);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        tiles: Array<{ id: string; status: string; value: unknown }>;
        generatedAt: string;
      };

      const byId = new Map(payload.tiles.map((tile) => [tile.id, tile]));
      expect(byId.get("open-tasks")?.status).toBe("not-configured");
      expect(byId.get("brain-notes")?.status).toBe("not-configured");
      expect(byId.get("journal-week")?.status).toBe("not-configured");
      expect(byId.get("gmail-unread")?.status).toBe("not-configured");
      expect(byId.get("apollo")?.status).toBe("not-configured");
      expect(byId.get("local-falcon")?.status).toBe("not-configured");
      // never a fabricated value
      for (const tile of payload.tiles) {
        if (tile.status === "not-configured") {
          expect(tile.value).toBeNull();
        }
      }
      expect(typeof payload.generatedAt).toBe("string");
    });

    it("reports real local-data tile values when a vault is configured", async () => {
      const vaultDir = mkdtempSync(join(tmpdir(), "octogent-tiles-vault-"));
      temporaryDirectories.push(vaultDir);
      writeFileSync(join(vaultDir, "note.md"), "# Note\n- [ ] do a thing\n", "utf8");
      vi.stubEnv("OBSIDIAN_VAULT_PATH", vaultDir);
      vi.stubEnv("GMAIL_REFRESH_TOKEN", "");
      vi.stubEnv("APOLLO_API_KEY", "");
      vi.stubEnv("LOCALFALCON_API_KEY", "");

      const baseUrl = await startServer();
      const response = await fetch(`${baseUrl}/api/tiles`);
      const payload = (await response.json()) as {
        tiles: Array<{ id: string; status: string; value: unknown }>;
      };
      const byId = new Map(payload.tiles.map((tile) => [tile.id, tile]));
      expect(byId.get("open-tasks")?.status).toBe("ok");
      expect(byId.get("open-tasks")?.value).toBe(1);
      expect(byId.get("brain-notes")?.value).toBe(1);
    });
  });

  describe("morning brief scheduler", () => {
    it("defaults to disabled and round-trips config via PATCH", async () => {
      const baseUrl = await startServer();

      const initial = await fetch(`${baseUrl}/api/brief/config`);
      expect(initial.status).toBe(200);
      await expect(initial.json()).resolves.toMatchObject({
        enabled: false,
        time: "08:00",
        lastBriefDate: null,
      });

      const patch = await fetch(`${baseUrl}/api/brief/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, time: "07:15" }),
      });
      expect(patch.status).toBe(200);
      await expect(patch.json()).resolves.toMatchObject({ enabled: true, time: "07:15" });

      const readBack = await fetch(`${baseUrl}/api/brief/config`);
      await expect(readBack.json()).resolves.toMatchObject({ enabled: true, time: "07:15" });
    });

    it("rejects an invalid brief time", async () => {
      const baseUrl = await startServer();
      const bad = await fetch(`${baseUrl}/api/brief/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: "99:99" }),
      });
      expect(bad.status).toBe(400);
    });
  });

  describe("token telemetry", () => {
    it("returns an empty session list before any telemetry is collected", async () => {
      const baseUrl = await startServer();

      const response = await fetch(`${baseUrl}/api/telemetry/tokens`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ sessions: [] });
    });

    it("returns recorded session token usage newest-first", async () => {
      const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
      temporaryDirectories.push(workspaceCwd);

      const { recordSessionTokenUsage } = await import("../src/terminalRuntime/tokenTelemetry");
      const stateDir = join(workspaceCwd, ".octogent");
      recordSessionTokenUsage({
        projectStateDir: stateDir,
        sessionId: "sess-old",
        terminalId: "terminal-1",
        tentacleId: "tentacle-1",
        totals: {
          inputTokens: 10,
          outputTokens: 2,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          messageCount: 1,
        },
        now: "2026-06-12T09:00:00.000Z",
      });
      recordSessionTokenUsage({
        projectStateDir: stateDir,
        sessionId: "sess-new",
        terminalId: "terminal-2",
        tentacleId: "tentacle-2",
        totals: {
          inputTokens: 500,
          outputTokens: 80,
          cacheCreationTokens: 12,
          cacheReadTokens: 30,
          messageCount: 4,
        },
        now: "2026-06-12T12:00:00.000Z",
      });

      const baseUrl = await startServer({ workspaceCwd });
      const response = await fetch(`${baseUrl}/api/telemetry/tokens`);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        sessions: Array<{ sessionId: string; inputTokens: number }>;
      };
      expect(payload.sessions.map((s) => s.sessionId)).toEqual(["sess-new", "sess-old"]);
      expect(payload.sessions[0]?.inputTokens).toBe(500);
    });
  });

  describe("agent alerts", () => {
    it("defaults to a disabled stuck rule and no active alerts", async () => {
      const baseUrl = await startServer();

      const response = await fetch(`${baseUrl}/api/monitor/alerts`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        config: { agentStuckMinutes: null },
        alerts: [],
      });
    });

    it("exports alert state as JSON and Markdown downloads", async () => {
      const baseUrl = await startServer();

      const jsonResponse = await fetch(`${baseUrl}/api/monitor/export?format=json`);
      expect(jsonResponse.status).toBe(200);
      expect(jsonResponse.headers.get("content-type")).toContain("application/json");
      expect(jsonResponse.headers.get("content-disposition")).toContain("octogent-alerts.json");
      const exported = (await jsonResponse.json()) as {
        config: { agentStuckMinutes: number | null };
        alerts: unknown[];
        generatedAt: string;
      };
      expect(exported.config).toEqual({ agentStuckMinutes: null });
      expect(exported.alerts).toEqual([]);
      expect(typeof exported.generatedAt).toBe("string");

      const mdResponse = await fetch(`${baseUrl}/api/monitor/export?format=md`);
      expect(mdResponse.status).toBe(200);
      expect(mdResponse.headers.get("content-type")).toContain("text/markdown");
      const markdown = await mdResponse.text();
      expect(markdown).toContain("# Octogent — Agent Alerts Export");
    });

    it("persists the stuck-rule threshold via PATCH and rejects bad values", async () => {
      const baseUrl = await startServer();

      const patch = await fetch(`${baseUrl}/api/monitor/alerts/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentStuckMinutes: 12 }),
      });
      expect(patch.status).toBe(200);
      await expect(patch.json()).resolves.toEqual({ agentStuckMinutes: 12 });

      const readBack = await fetch(`${baseUrl}/api/monitor/alerts/config`);
      await expect(readBack.json()).resolves.toEqual({ agentStuckMinutes: 12 });

      const bad = await fetch(`${baseUrl}/api/monitor/alerts/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentStuckMinutes: -3 }),
      });
      expect(bad.status).toBe(400);
    });
  });

  it("returns snapshots for GET /api/terminal-snapshots", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("reports voice providers without exposing secrets", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("PIPER_BIN", "");
    vi.stubEnv("PIPER_MODEL", "");
    const baseUrl = await startServer();

    try {
      const response = await fetch(`${baseUrl}/api/voice/config`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        wake: {
          provider: "browser-speech-recognition",
          phrases: ["yo jarvis", "heyo jarvis", "hey jarvis", "okay jarvis", "jarvis"],
        },
        transcription: {
          provider: "openai",
          configured: false,
          defaultModel: "gpt-4o-mini-transcribe",
          models: [
            "gpt-4o-mini-transcribe",
            "gpt-4o-transcribe",
            "gpt-4o-transcribe-diarize",
            "whisper-1",
          ],
          whisperSupported: true,
        },
        tts: {
          configured: false,
          providers: ["browser"],
          recommended: "browser",
          fallback: "browser-speech-synthesis",
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects voice transcription when OpenAI credentials are missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const baseUrl = await startServer();

    try {
      const response = await fetch(`${baseUrl}/api/voice/transcribe?model=whisper-1`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "audio/webm",
        },
        body: new Uint8Array([1, 2, 3]),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "OPENAI_API_KEY is not configured.",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resolves wake-prefixed Jarvis voice commands", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/voice/intent`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript: "Yo Jarvis search my brain for monitor ideas",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      transcript: "Yo Jarvis search my brain for monitor ideas",
      commandText: "search my brain for monitor ideas",
      intent: {
        type: "brain-search",
        query: "monitor ideas",
      },
    });
  });

  it("returns session summaries for GET /api/conversations", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    writeConversationTranscript(workspaceCwd, "terminal-1", [
      {
        type: "session_start",
        eventId: "terminal-1:1",
        sessionId: "terminal-1",
        tentacleId: "terminal-1",
        timestamp: "2026-03-05T10:00:00.000Z",
      },
      {
        type: "session_end",
        eventId: "terminal-1:5",
        sessionId: "terminal-1",
        tentacleId: "terminal-1",
        reason: "pty_exit",
        exitCode: 0,
        signal: 0,
        timestamp: "2026-03-05T10:00:04.000Z",
      },
    ]);
    writeClaudeTurns(workspaceCwd, "terminal-1", [
      {
        turnId: "turn-1",
        role: "user",
        content: "build export",
        startedAt: "2026-03-05T10:00:01.000Z",
        endedAt: "2026-03-05T10:00:01.000Z",
      },
      {
        turnId: "turn-2",
        role: "assistant",
        content: "implemented",
        startedAt: "2026-03-05T10:00:02.000Z",
        endedAt: "2026-03-05T10:00:03.000Z",
      },
    ]);

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const response = await fetch(`${baseUrl}/api/conversations`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        sessionId: "terminal-1",
        tentacleId: "terminal-1",
        startedAt: "2026-03-05T10:00:00.000Z",
        endedAt: "2026-03-05T10:00:04.000Z",
        lastEventAt: "2026-03-05T10:00:04.000Z",
        eventCount: 2,
        turnCount: 2,
        userTurnCount: 1,
        assistantTurnCount: 1,
        firstUserTurnPreview: "build export",
        lastUserTurnPreview: "build export",
        lastAssistantTurnPreview: "implemented",
      },
    ]);
  });

  it("returns assembled conversation details and export payloads", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    writeConversationTranscript(workspaceCwd, "terminal-2-agent-1", [
      {
        type: "session_start",
        eventId: "terminal-2-agent-1:1",
        sessionId: "terminal-2-agent-1",
        tentacleId: "terminal-2",
        timestamp: "2026-03-05T11:00:00.000Z",
      },
    ]);
    writeClaudeTurns(workspaceCwd, "terminal-2-agent-1", [
      {
        turnId: "turn-1",
        role: "user",
        content: "summarize",
        startedAt: "2026-03-05T11:00:01.000Z",
        endedAt: "2026-03-05T11:00:01.000Z",
      },
      {
        turnId: "turn-2",
        role: "assistant",
        content: "summary ready",
        startedAt: "2026-03-05T11:00:02.000Z",
        endedAt: "2026-03-05T11:00:03.000Z",
      },
    ]);

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const detailResponse = await fetch(`${baseUrl}/api/conversations/terminal-2-agent-1`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      sessionId: "terminal-2-agent-1",
      turnCount: 2,
      turns: [
        {
          role: "user",
          content: "summarize",
        },
        {
          role: "assistant",
          content: "summary ready",
        },
      ],
    });

    const jsonExportResponse = await fetch(
      `${baseUrl}/api/conversations/terminal-2-agent-1/export?format=json`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    );
    expect(jsonExportResponse.status).toBe(200);
    await expect(jsonExportResponse.json()).resolves.toMatchObject({
      sessionId: "terminal-2-agent-1",
      turnCount: 2,
    });

    const markdownExportResponse = await fetch(
      `${baseUrl}/api/conversations/terminal-2-agent-1/export?format=md`,
      {
        method: "GET",
      },
    );
    expect(markdownExportResponse.status).toBe(200);
    expect(markdownExportResponse.headers.get("content-type")).toContain("text/markdown");
    const markdownBody = await markdownExportResponse.text();
    expect(markdownBody).toContain("## User");
    expect(markdownBody).toContain("summarize");
    expect(markdownBody).toContain("## Assistant");
    expect(markdownBody).toContain("summary ready");
  });

  it("returns 400 for unsupported conversation export format", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    writeConversationTranscript(workspaceCwd, "terminal-3-agent-1", [
      {
        type: "session_start",
        eventId: "terminal-3-agent-1:1",
        sessionId: "terminal-3-agent-1",
        tentacleId: "terminal-3",
        timestamp: "2026-03-05T12:00:00.000Z",
      },
    ]);

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const response = await fetch(
      `${baseUrl}/api/conversations/terminal-3-agent-1/export?format=txt`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported conversation export format.",
    });
  });

  it("PATCH /api/conversations/:id/meta pin round-trip and tags round-trip", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const sessionId = "meta-session-1";
    writeConversationTranscript(workspaceCwd, sessionId, [
      {
        type: "session_start",
        eventId: `${sessionId}:1`,
        sessionId,
        tentacleId: "t1",
        timestamp: "2026-03-05T13:00:00.000Z",
      },
    ]);
    writeClaudeTurns(workspaceCwd, sessionId, [
      {
        turnId: "turn-1",
        role: "user",
        content: "hello",
        startedAt: "2026-03-05T13:00:01.000Z",
        endedAt: "2026-03-05T13:00:01.000Z",
      },
    ]);

    const baseUrl = await startServer({ workspaceCwd });

    // Pin the session
    const pinRes = await fetch(`${baseUrl}/api/conversations/${sessionId}/meta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pinRes.status).toBe(204);

    // Verify pin is reflected in session list
    const listRes = await fetch(`${baseUrl}/api/conversations`, {
      headers: { Accept: "application/json" },
    });
    expect(listRes.status).toBe(200);
    const sessions = (await listRes.json()) as { sessionId: string; pinned?: boolean }[];
    expect(sessions.find((s) => s.sessionId === sessionId)?.pinned).toBe(true);

    // Add tags
    const tagRes = await fetch(`${baseUrl}/api/conversations/${sessionId}/meta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["work", "important"] }),
    });
    expect(tagRes.status).toBe(204);

    // Verify tags are reflected (pin should still be set)
    const listRes2 = await fetch(`${baseUrl}/api/conversations`, {
      headers: { Accept: "application/json" },
    });
    const sessions2 = (await listRes2.json()) as {
      sessionId: string;
      pinned?: boolean;
      tags?: string[];
    }[];
    const updated = sessions2.find((s) => s.sessionId === sessionId);
    expect(updated?.pinned).toBe(true);
    expect(updated?.tags).toEqual(["work", "important"]);
  });

  it("PATCH /api/conversations/:id/meta returns 400 for invalid body", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const sessionId = "meta-session-bad";
    writeConversationTranscript(workspaceCwd, sessionId, [
      {
        type: "session_start",
        eventId: `${sessionId}:1`,
        sessionId,
        tentacleId: "t1",
        timestamp: "2026-03-05T13:00:00.000Z",
      },
    ]);

    const baseUrl = await startServer({ workspaceCwd });

    const res = await fetch(`${baseUrl}/api/conversations/${sessionId}/meta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: "yes" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("PATCH /api/conversations/:id/meta returns 404 for unknown session", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);

    const baseUrl = await startServer({ workspaceCwd });

    const res = await fetch(`${baseUrl}/api/conversations/no-such-session/meta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects non-local browser origins for HTTP endpoints", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Origin: "https://attacker.example",
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Origin not allowed.",
    });
  });

  it("allows loopback browser origins and reflects CORS origin", async () => {
    const baseUrl = await startServer();
    const origin = "http://localhost:5173";

    const response = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Origin: origin,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("rejects non-local CORS preflight requests", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/terminals`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.status).toBe(403);
  });

  it("rejects websocket upgrades from non-local origins", async () => {
    const baseUrl = await startServer();
    const wsUrl = new URL(`${toWebSocketBaseUrl(baseUrl)}/api/terminals/terminal-1/ws`);

    const opened = await new Promise<boolean>((resolve) => {
      const socket = createConnection({
        host: wsUrl.hostname,
        port: Number.parseInt(wsUrl.port, 10),
      });
      let settled = false;
      let responseHead = "";

      const finish = (didOpen: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(didOpen);
      };

      socket.on("connect", () => {
        socket.write(
          `GET ${wsUrl.pathname} HTTP/1.1\r\nHost: ${wsUrl.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: https://attacker.example\r\n\r\n`,
        );
      });
      socket.on("data", (chunk) => {
        responseHead += chunk.toString("utf8");
        if (responseHead.includes("101 Switching Protocols")) {
          finish(true);
        }
      });
      socket.on("error", () => finish(false));
      socket.on("close", () => finish(false));
      setTimeout(() => finish(false), 1_000);
    });

    expect(opened).toBe(false);
  });

  it("returns 405 for unsupported methods on /api/terminal-snapshots", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("sanitizes unexpected internal errors from API responses", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/terminals/%E0%A4%A`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("returns codex usage snapshot for GET /api/codex/usage", async () => {
    const codexSnapshot = {
      status: "ok",
      source: "oauth-api",
      fetchedAt: "2026-02-25T12:00:00.000Z",
      planType: "pro",
      primaryUsedPercent: 12,
      secondaryUsedPercent: 28,
      creditsBalance: 88.5,
      creditsUnlimited: false,
    } as const;

    const baseUrl = await startServer({
      readCodexUsageSnapshot: async () => codexSnapshot,
    });

    const response = await fetch(`${baseUrl}/api/codex/usage`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(codexSnapshot);
  });

  it("returns claude usage snapshot for GET /api/claude/usage", async () => {
    const claudeSnapshot = {
      status: "ok",
      source: "oauth-api",
      fetchedAt: "2026-03-03T12:00:00.000Z",
      planType: "pro",
      primaryUsedPercent: 11,
      primaryResetAt: "2026-03-03T15:00:00.000Z",
      secondaryUsedPercent: 27,
      secondaryResetAt: "2026-03-05T00:00:00.000Z",
      sonnetUsedPercent: 19,
      sonnetResetAt: "2026-03-05T00:00:00.000Z",
    } as const;

    const baseUrl = await startServer({
      readClaudeUsageSnapshot: async () => claudeSnapshot,
    });

    const response = await fetch(`${baseUrl}/api/claude/usage`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claudeSnapshot);
  });

  it("returns oauth claude usage snapshot for GET /api/claude/usage/oauth", async () => {
    const claudeSnapshot = {
      status: "ok",
      source: "oauth-api",
      fetchedAt: "2026-03-03T12:00:00.000Z",
      primaryUsedPercent: 11,
      secondaryUsedPercent: 27,
    } as const;

    const baseUrl = await startServer({
      readClaudeOauthUsageSnapshot: async () => claudeSnapshot,
    });

    const response = await fetch(`${baseUrl}/api/claude/usage/oauth`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claudeSnapshot);
  });

  it("returns cli claude usage snapshot for GET /api/claude/usage/cli", async () => {
    const claudeSnapshot = {
      status: "ok",
      source: "cli-pty",
      fetchedAt: "2026-03-03T12:00:00.000Z",
      primaryUsedPercent: 9,
      secondaryUsedPercent: 22,
      sonnetUsedPercent: 14,
    } as const;

    const baseUrl = await startServer({
      readClaudeCliUsageSnapshot: async () => claudeSnapshot,
    });

    const response = await fetch(`${baseUrl}/api/claude/usage/cli`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claudeSnapshot);
  });

  it("returns github summary for GET /api/github/summary", async () => {
    const githubSummary: GitHubRepoSummarySnapshot = {
      status: "ok",
      fetchedAt: "2026-02-27T12:00:00.000Z",
      source: "gh-cli",
      repo: "hesamsheikh/octogent",
      stargazerCount: 42,
      openIssueCount: 7,
      openPullRequestCount: 3,
      commitsPerDay: [
        { date: "2026-02-25", count: 4 },
        { date: "2026-02-26", count: 6 },
        { date: "2026-02-27", count: 8 },
      ],
      recentCommits: [
        {
          hash: "d8f2d9b7aa9f53f8fa254d8e0f3a13270435e321",
          shortHash: "d8f2d9b",
          subject: "tighten monitor polling backoff strategy",
          authorName: "Hesam Sheikh",
          authorEmail: "hesam@example.com",
          authoredAt: "2026-02-27T10:12:00.000Z",
          body: "Reduce the backoff multiplier from 2x to 1.5x to improve\nresponsiveness when rate limits recover.",
          filesChanged: 3,
          insertions: 42,
          deletions: 7,
        },
      ],
    };

    const baseUrl = await startServer({
      readGithubRepoSummary: async () => githubSummary,
    });

    const response = await fetch(`${baseUrl}/api/github/summary`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(githubSummary);
  });

  it("returns 405 for unsupported methods on /api/codex/usage", async () => {
    const baseUrl = await startServer({
      readCodexUsageSnapshot: async () => ({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-25T12:00:00.000Z",
      }),
    });

    const response = await fetch(`${baseUrl}/api/codex/usage`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 405 for unsupported methods on /api/claude/usage", async () => {
    const baseUrl = await startServer({
      readClaudeUsageSnapshot: async () => ({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-03-03T12:00:00.000Z",
      }),
    });

    const response = await fetch(`${baseUrl}/api/claude/usage`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 405 for unsupported methods on /api/claude/usage/oauth", async () => {
    const baseUrl = await startServer({
      readClaudeOauthUsageSnapshot: async () => ({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-03-03T12:00:00.000Z",
      }),
    });

    const response = await fetch(`${baseUrl}/api/claude/usage/oauth`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 405 for unsupported methods on /api/claude/usage/cli", async () => {
    const baseUrl = await startServer({
      readClaudeCliUsageSnapshot: async () => ({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-03-03T12:00:00.000Z",
      }),
    });

    const response = await fetch(`${baseUrl}/api/claude/usage/cli`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("POST /api/hooks/session-start invalidates claude usage cache", async () => {
    let callCount = 0;
    const readClaudeUsageSnapshot = async () => {
      callCount++;
      return {
        status: "ok" as const,
        source: "oauth-api" as const,
        fetchedAt: "2026-03-03T12:00:00.000Z",
        planType: "pro",
        primaryUsedPercent: callCount * 10,
        secondaryUsedPercent: 50,
        sonnetUsedPercent: 30,
      };
    };

    const invalidateCalls: number[] = [];
    const invalidateClaudeUsageCache = () => {
      invalidateCalls.push(Date.now());
    };

    const baseUrl = await startServer({
      readClaudeUsageSnapshot,
      invalidateClaudeUsageCache,
    });

    // First GET — callCount becomes 1
    const first = await fetch(`${baseUrl}/api/claude/usage`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { primaryUsedPercent: number };
    expect(firstBody.primaryUsedPercent).toBe(10);

    // POST hook — should invalidate and warm cache
    const hookResponse = await fetch(`${baseUrl}/api/hooks/session-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "test-session" }),
    });
    expect(hookResponse.status).toBe(200);
    expect(invalidateCalls.length).toBe(1);

    // Next GET triggers a fresh read (callCount incremented again)
    const second = await fetch(`${baseUrl}/api/claude/usage`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { primaryUsedPercent: number };
    // callCount > 2 confirms the warm call + this GET both invoked the reader
    expect(secondBody.primaryUsedPercent).toBeGreaterThan(10);
  });

  it("POST /api/hooks/user-prompt-submit auto-renames generated default terminal names", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const hookResponse = await fetch(
      `${baseUrl}/api/hooks/user-prompt-submit?octogent_session=terminal-1`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Investigate flaky CI failures" }),
      },
    );
    expect(hookResponse.status).toBe(200);

    const secondHookResponse = await fetch(
      `${baseUrl}/api/hooks/user-prompt-submit?octogent_session=terminal-1`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Something else later" }),
      },
    );
    expect(secondHookResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleName: "Investigate flaky CI failures",
        }),
      ]),
    );
  });

  it("POST /api/hooks/user-prompt-submit preserves explicit terminal names", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "reviewer" }),
    });
    expect(createResponse.status).toBe(201);

    const hookResponse = await fetch(
      `${baseUrl}/api/hooks/user-prompt-submit?octogent_session=terminal-1`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Investigate flaky CI failures" }),
      },
    );
    expect(hookResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleName: "reviewer",
        }),
      ]),
    );
  });

  it("infers generated terminal names from older registry entries", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    mkdirSync(join(workspaceCwd, ".octogent", "state"), { recursive: true });
    writeFileSync(
      registryPath,
      `${JSON.stringify(
        {
          version: 3,
          terminals: [
            {
              terminalId: "terminal-1",
              tentacleId: "terminal-1",
              tentacleName: "Octogent Terminal 1",
              createdAt: "2026-04-10T10:00:00.000Z",
              workspaceMode: "shared",
            },
          ],
          uiState: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });

    const hookResponse = await fetch(
      `${baseUrl}/api/hooks/user-prompt-submit?octogent_session=terminal-1`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Investigate flaky CI failures" }),
      },
    );
    expect(hookResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleName: "Investigate flaky CI failures",
        }),
      ]),
    );
  });

  it("returns 405 for unsupported methods on /api/github/summary", async () => {
    const baseUrl = await startServer({
      readGithubRepoSummary: async () => ({
        status: "unavailable",
        fetchedAt: "2026-02-27T12:00:00.000Z",
        source: "none",
        message: "GitHub CLI not available.",
      }),
    });

    const response = await fetch(`${baseUrl}/api/github/summary`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("returns 405 for unsupported methods on /api/ui-state", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });

  it("reports file-backed workspace setup status and updates it through setup actions", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const baseUrl = await startServer({ workspaceCwd });

    const initialResponse = await fetch(`${baseUrl}/api/setup`, {
      headers: { Accept: "application/json" },
    });
    expect(initialResponse.status).toBe(200);
    const initialPayload = (await initialResponse.json()) as {
      isFirstRun: boolean;
      shouldShowSetupCard: boolean;
      hasAnyTentacles: boolean;
      steps: Array<{ id: string; complete: boolean }>;
    };
    expect(existsSync(join(workspaceCwd, ".octogent"))).toBe(false);
    expect(existsSync(join(workspaceCwd, ".gitignore"))).toBe(false);
    expect(initialPayload.isFirstRun).toBe(true);
    expect(initialPayload.shouldShowSetupCard).toBe(true);
    expect(initialPayload.hasAnyTentacles).toBe(false);
    expect(initialPayload.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "initialize-workspace", complete: false }),
        expect.objectContaining({ id: "ensure-gitignore", complete: false }),
        expect.objectContaining({ id: "create-tentacles", complete: false }),
      ]),
    );

    const initializeResponse = await fetch(`${baseUrl}/api/setup/steps/initialize-workspace`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(initializeResponse.status).toBe(200);
    expect(existsSync(join(workspaceCwd, ".octogent", "project.json"))).toBe(true);
    expect(existsSync(join(workspaceCwd, ".octogent", "tentacles"))).toBe(true);
    expect(existsSync(join(workspaceCwd, ".octogent", "worktrees"))).toBe(true);

    const gitignoreResponse = await fetch(`${baseUrl}/api/setup/steps/ensure-gitignore`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(gitignoreResponse.status).toBe(200);
    expect(readFileSync(join(workspaceCwd, ".gitignore"), "utf8")).toContain(".octogent");

    const createTentacleResponse = await fetch(`${baseUrl}/api/deck/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "docs",
        description: "Docs and guides",
      }),
    });
    expect(createTentacleResponse.status).toBe(201);

    const finalResponse = await fetch(`${baseUrl}/api/setup`, {
      headers: { Accept: "application/json" },
    });
    expect(finalResponse.status).toBe(200);
    const finalPayload = (await finalResponse.json()) as {
      isFirstRun: boolean;
      hasAnyTentacles: boolean;
      tentacleCount: number;
      steps: Array<{ id: string; complete: boolean }>;
    };
    expect(finalPayload.isFirstRun).toBe(false);
    expect(finalPayload.hasAnyTentacles).toBe(true);
    expect(finalPayload.tentacleCount).toBe(1);
    expect(finalPayload.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "initialize-workspace", complete: true }),
        expect.objectContaining({ id: "ensure-gitignore", complete: true }),
        expect.objectContaining({ id: "create-tentacles", complete: true }),
      ]),
    );
  });

  it("returns 413 when create tentacle body exceeds size limit", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "x".repeat(1024 * 1024 + 1),
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large.",
    });
  });

  it("returns 413 when ui-state patch body exceeds size limit", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        minimizedTerminalIds: ["terminal-1"],
        blob: "x".repeat(1024 * 1024 + 1),
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large.",
    });
  });

  it("lists Claude skills from the project skills folder", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const projectSkillDir = join(workspaceCwd, ".claude", "skills", "docs-writer");
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      [
        "---",
        "name: docs-writer",
        "description: Helps keep docs aligned with product changes.",
        "---",
        "",
        "# Docs Writer",
        "",
        "Writes and updates docs.",
        "",
      ].join("\n"),
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });
    const response = await fetch(`${baseUrl}/api/deck/skills`, {
      headers: { Accept: "application/json" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "docs-writer",
          description: "Helps keep docs aligned with product changes.",
          source: "project",
        }),
      ]),
    );
  });

  it("ignores a root project skills SKILL.md file and only lists folder-based skills", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const skillsDir = join(workspaceCwd, ".claude", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "SKILL.md"),
      [
        "---",
        "name: not-a-real-skill",
        "description: Should not be listed.",
        "---",
        "",
        "# Root Marker",
        "",
      ].join("\n"),
      "utf8",
    );
    mkdirSync(join(skillsDir, "docs-writer"), { recursive: true });
    writeFileSync(
      join(skillsDir, "docs-writer", "SKILL.md"),
      [
        "---",
        "name: docs-writer",
        "description: Helps keep docs aligned with product changes.",
        "---",
        "",
      ].join("\n"),
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });
    const response = await fetch(`${baseUrl}/api/deck/skills`, {
      headers: { Accept: "application/json" },
    });

    expect(response.status).toBe(200);
    const skills = (await response.json()) as Array<{ name: string; source: string }>;
    // The folder-based project skill is listed; the root-level SKILL.md is ignored.
    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "docs-writer",
          description: "Helps keep docs aligned with product changes.",
          source: "project",
        }),
      ]),
    );
    expect(skills.some((skill) => skill.name === "not-a-real-skill")).toBe(false);
    // Bundled catalog skills surface alongside project skills.
    expect(skills.some((skill) => skill.source === "bundled")).toBe(true);
  });

  it("creates tentacles with suggested skills and appends the managed context block", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const baseUrl = await startServer({ workspaceCwd });

    const response = await fetch(`${baseUrl}/api/deck/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "docs",
        description: "Docs and guides",
        suggestedSkills: ["release-helper", "docs-writer"],
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "docs",
        suggestedSkills: ["docs-writer", "release-helper"],
      }),
    );

    const context = readFileSync(
      join(workspaceCwd, ".octogent", "tentacles", "docs", "CONTEXT.md"),
      "utf8",
    );
    expect(context).toContain("## Suggested Skills");
    expect(context).toContain("You can use these skills if you need to.");
    expect(context).toContain("- `docs-writer`");
    expect(context).toContain("- `release-helper`");

    const listResponse = await fetch(`${baseUrl}/api/deck/tentacles`, {
      headers: { Accept: "application/json" },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tentacleId: "docs",
          suggestedSkills: ["docs-writer", "release-helper"],
        }),
      ]),
    );
  });

  it("updates tentacle suggested skills and removes the managed context block when cleared", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const baseUrl = await startServer({ workspaceCwd });

    const createResponse = await fetch(`${baseUrl}/api/deck/tentacles`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "docs",
        description: "Docs and guides",
      }),
    });
    expect(createResponse.status).toBe(201);

    const updateResponse = await fetch(`${baseUrl}/api/deck/tentacles/docs/skills`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        suggestedSkills: ["code-review-specialist"],
      }),
    });

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "docs",
        suggestedSkills: ["code-review-specialist"],
      }),
    );

    const contextPath = join(workspaceCwd, ".octogent", "tentacles", "docs", "CONTEXT.md");
    expect(readFileSync(contextPath, "utf8")).toContain("- `code-review-specialist`");

    const clearResponse = await fetch(`${baseUrl}/api/deck/tentacles/docs/skills`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        suggestedSkills: [],
      }),
    });

    expect(clearResponse.status).toBe(200);
    await expect(clearResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "docs",
        suggestedSkills: [],
      }),
    );
    expect(readFileSync(contextPath, "utf8")).not.toContain("## Suggested Skills");
    expect(readFileSync(contextPath, "utf8")).not.toContain("octogent:suggested-skills:start");
  });

  it("returns 400 for unsupported tentacle completion sound values", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/ui-state`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        terminalCompletionSound: "laser-zap",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "terminalCompletionSound must be one of the supported sound identifiers.",
    });
  });

  it("restores ui state across API restarts using persisted registry", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);

    const firstBaseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${firstBaseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const patchResponse = await fetch(`${firstBaseUrl}/api/ui-state`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isAgentsSidebarVisible: false,
        sidebarWidth: 380,
        isActiveAgentsSectionExpanded: false,
        isRuntimeStatusStripVisible: false,
        isMonitorVisible: false,
        isBottomTelemetryVisible: false,
        isCodexUsageVisible: false,
        isClaudeUsageVisible: false,
        isClaudeUsageSectionExpanded: false,
        isCodexUsageSectionExpanded: false,
        terminalCompletionSound: "double-beep",
        minimizedTerminalIds: ["terminal-1"],
        terminalWidths: {
          "terminal-1": 420,
        },
      }),
    });
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toEqual({
      isAgentsSidebarVisible: false,
      sidebarWidth: 380,
      isActiveAgentsSectionExpanded: false,
      isRuntimeStatusStripVisible: false,
      isMonitorVisible: false,
      isBottomTelemetryVisible: false,
      isCodexUsageVisible: false,
      isClaudeUsageVisible: false,
      isClaudeUsageSectionExpanded: false,
      isCodexUsageSectionExpanded: false,
      terminalCompletionSound: "double-beep",
      minimizedTerminalIds: ["terminal-1"],
      terminalWidths: {
        "terminal-1": 420,
      },
    });

    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    const secondBaseUrl = await startServer({
      workspaceCwd,
    });

    const getResponse = await fetch(`${secondBaseUrl}/api/ui-state`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      isAgentsSidebarVisible: false,
      sidebarWidth: 380,
      isActiveAgentsSectionExpanded: false,
      isRuntimeStatusStripVisible: false,
      isMonitorVisible: false,
      isBottomTelemetryVisible: false,
      isCodexUsageVisible: false,
      isClaudeUsageVisible: false,
      isClaudeUsageSectionExpanded: false,
      isCodexUsageSectionExpanded: false,
      terminalCompletionSound: "double-beep",
      minimizedTerminalIds: ["terminal-1"],
      terminalWidths: {
        "terminal-1": 420,
      },
    });
  });

  it("creates new tentacles with unique incremental ids", async () => {
    const baseUrl = await startServer();

    const createFirstResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "planner" }),
    });

    expect(createFirstResponse.status).toBe(201);
    await expect(createFirstResponse.json()).resolves.toEqual(
      expect.objectContaining({
        terminalId: "terminal-1",
        label: "terminal-1",
        state: "live",
        tentacleId: "terminal-1",
        tentacleName: "planner",
        workspaceMode: "shared",
      }),
    );

    const createSecondResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    expect(createSecondResponse.status).toBe(201);
    await expect(createSecondResponse.json()).resolves.toEqual(
      expect.objectContaining({
        terminalId: "terminal-2",
        label: "terminal-2",
        state: "live",
        tentacleId: "terminal-2",
        tentacleName: "Octogent Terminal 1",
        workspaceMode: "shared",
      }),
    );

    const renameResponse = await fetch(`${baseUrl}/api/terminals/terminal-2`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "reviewer" }),
    });

    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "terminal-2",
        tentacleName: "reviewer",
      }),
    );

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleId: "terminal-1",
          tentacleName: "planner",
          workspaceMode: "shared",
        }),
        expect.objectContaining({
          terminalId: "terminal-2",
          tentacleId: "terminal-2",
          tentacleName: "reviewer",
          workspaceMode: "shared",
        }),
      ]),
    );
  });

  it("reuses the minimum available tentacle number after deletions", async () => {
    const baseUrl = await startServer();

    const createFirstResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createFirstResponse.status).toBe(201);

    const createSecondResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createSecondResponse.status).toBe(201);

    const deleteFirstResponse = await fetch(`${baseUrl}/api/terminals/terminal-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteFirstResponse.status).toBe(204);

    const createThirdResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createThirdResponse.status).toBe(201);
    await expect(createThirdResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "terminal-1",
      }),
    );
  });

  it("ignores stale persisted nextTentacleNumber values and starts from the minimum available id", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    mkdirSync(join(workspaceCwd, ".octogent", "state"), { recursive: true });
    writeFileSync(
      registryPath,
      `${JSON.stringify(
        {
          version: 2,
          nextTentacleNumber: 19,
          tentacles: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "terminal-1",
      }),
    );
  });

  it("skips tentacle ids that already have an existing worktree directory", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    mkdirSync(join(workspaceCwd, ".octogent", "worktrees", "terminal-1"), {
      recursive: true,
    });

    const baseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "terminal-2",
      }),
    );
  });

  it("persists tentacle metadata without runtime bootstrap flags", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const baseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "planner" }),
    });
    expect(createResponse.status).toBe(201);

    const registryDocument = await waitForRegistryDocument<{
      terminals: Array<{
        terminalId: string;
        tentacleId: string;
        workspaceMode: "shared" | "worktree";
      }>;
    }>(workspaceCwd, (document) =>
      document.terminals.some(
        (terminal) =>
          terminal.terminalId === "terminal-1" &&
          terminal.tentacleId === "terminal-1" &&
          terminal.workspaceMode === "shared",
      ),
    );
    expect(registryDocument.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleId: "terminal-1",
          workspaceMode: "shared",
        }),
      ]),
    );
  });

  it("marks auto-started prompted terminals as active immediately", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const baseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "planner", initialPrompt: "Start working." }),
    });
    expect(createResponse.status).toBe(201);

    const snapshotsResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      headers: { Accept: "application/json" },
    });
    expect(snapshotsResponse.status).toBe(200);
    await expect(snapshotsResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          hasUserPrompt: true,
        }),
      ]),
    );
  });

  it("injects a default tentacle context prompt for tentacle terminals", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const tentacleDir = join(workspaceCwd, ".octogent", "tentacles", "docs");
    const relativeTentacleDir = ".octogent/tentacles/docs";
    const promptsDir = join(process.cwd(), "..", "..", "prompts");
    mkdirSync(tentacleDir, { recursive: true });
    writeFileSync(join(tentacleDir, "CONTEXT.md"), "# Docs\n\nDocumentation team.\n", "utf8");
    writeFileSync(join(tentacleDir, "todo.md"), "# Todo\n", "utf8");
    const baseUrl = await startServer({
      workspaceCwd,
      promptsDir,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tentacleId: "docs", workspaceMode: "shared" }),
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({
        terminalId: "terminal-1",
        tentacleId: "docs",
      }),
    );

    const registryDocument = await waitForRegistryDocument<{
      terminals: Array<{
        terminalId: string;
        initialInputDraft?: string;
      }>;
    }>(workspaceCwd, (document) =>
      document.terminals.some(
        (terminal) =>
          terminal.terminalId === "terminal-1" &&
          terminal.initialInputDraft ===
            `You are working on the Docs section. For tool-list items, context, and docs, check ${relativeTentacleDir}.`,
      ),
    );
    expect(registryDocument.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          initialInputDraft: `You are working on the Docs section. For tool-list items, context, and docs, check ${relativeTentacleDir}.`,
        }),
      ]),
    );

    const snapshotsResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      headers: { Accept: "application/json" },
    });
    expect(snapshotsResponse.status).toBe(200);
    await expect(snapshotsResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          hasUserPrompt: false,
        }),
      ]),
    );
  });

  it("creates isolated worktree terminals with dedicated cwd", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "planner",
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({
        tentacleId: "terminal-1",
        tentacleName: "planner",
        workspaceMode: "worktree",
      }),
    );

    const expectedWorktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    expect(gitClient.getWorktree(expectedWorktreePath)).toEqual(
      expect.objectContaining({
        cwd: workspaceCwd,
        branchName: "octogent/terminal-1",
        baseRef: "HEAD",
      }),
    );

    const registryDocument = await waitForRegistryDocument<{
      terminals: Array<{
        terminalId: string;
        tentacleId: string;
        workspaceMode: "shared" | "worktree";
      }>;
    }>(workspaceCwd, (document) =>
      document.terminals.some(
        (terminal) =>
          terminal.terminalId === "terminal-1" &&
          terminal.tentacleId === "terminal-1" &&
          terminal.workspaceMode === "worktree",
      ),
    );
    expect(registryDocument.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleId: "terminal-1",
          workspaceMode: "worktree",
        }),
      ]),
    );
  });

  it("returns git status for worktree tentacles", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: true,
      aheadCount: 2,
      behindCount: 1,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: ["apps/web/src/App.tsx", "README.md"],
      defaultBaseBranchName: "main",
    });

    const statusResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual({
      tentacleId: "terminal-1",
      workspaceMode: "worktree",
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: true,
      aheadCount: 2,
      behindCount: 1,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: ["apps/web/src/App.tsx", "README.md"],
      defaultBaseBranchName: "main",
    });
  });

  it("returns 409 for git status on shared tentacles", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const statusResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(statusResponse.status).toBe(409);
    await expect(statusResponse.json()).resolves.toEqual({
      error: "Git lifecycle actions are only available for worktree terminals.",
    });
  });

  it("commits pending worktree changes with a required message", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: true,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: ["apps/web/src/App.tsx"],
      defaultBaseBranchName: "main",
    });

    const commitResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/commit`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "feat: add worktree git actions",
      }),
    });
    expect(commitResponse.status).toBe(200);
    expect(gitClient.getLastCommitMessage(worktreePath)).toBe("feat: add worktree git actions");
    await expect(commitResponse.json()).resolves.toEqual({
      tentacleId: "terminal-1",
      workspaceMode: "worktree",
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: false,
      aheadCount: 1,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
  });

  it("returns 400 for commit when message is empty", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    const commitResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/commit`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "   ",
      }),
    });
    expect(commitResponse.status).toBe(400);
    expect(gitClient.getLastCommitMessage(worktreePath)).toBeNull();
    await expect(commitResponse.json()).resolves.toEqual({
      error: "Commit message cannot be empty.",
    });
  });

  it("pushes worktree branch and updates ahead count", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/terminal-1",
      upstreamBranchName: null,
      isDirty: false,
      aheadCount: 3,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });

    const pushResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/push`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(pushResponse.status).toBe(200);
    expect(gitClient.getPushCount(worktreePath)).toBe(1);
    await expect(pushResponse.json()).resolves.toEqual({
      tentacleId: "terminal-1",
      workspaceMode: "worktree",
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
  });

  it("syncs worktree branch with base ref", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 4,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });

    const syncResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/sync`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        baseRef: "main",
      }),
    });
    expect(syncResponse.status).toBe(200);
    expect(gitClient.getSyncBaseRefs(worktreePath)).toEqual(["main"]);
    await expect(syncResponse.json()).resolves.toEqual({
      tentacleId: "terminal-1",
      workspaceMode: "worktree",
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
  });

  it("returns PR status for worktree tentacles", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreePullRequest(worktreePath, {
      number: 142,
      url: "https://github.com/hesamsheikh/octogent/pull/142",
      title: "feat: worktree git lifecycle menu",
      baseRef: "main",
      headRef: "octogent/terminal-1",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });

    const prStatusResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/pr`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(prStatusResponse.status).toBe(200);
    await expect(prStatusResponse.json()).resolves.toEqual({
      tentacleId: "terminal-1",
      workspaceMode: "worktree",
      status: "open",
      number: 142,
      url: "https://github.com/hesamsheikh/octogent/pull/142",
      title: "feat: worktree git lifecycle menu",
      baseRef: "main",
      headRef: "octogent/terminal-1",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });
  });

  it("creates PR for worktree tentacles and returns PR snapshot", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });

    const createPrResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/pr`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "feat: expose worktree lifecycle actions",
        body: "Adds PR controls in the tentacle header.",
        baseRef: "main",
      }),
    });
    expect(createPrResponse.status).toBe(200);
    await expect(createPrResponse.json()).resolves.toEqual({
      tentacleId: "terminal-1",
      workspaceMode: "worktree",
      status: "open",
      number: 101,
      url: "https://github.com/hesamsheikh/octogent/pull/101",
      title: "feat: expose worktree lifecycle actions",
      baseRef: "main",
      headRef: "octogent/terminal-1",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });
  });

  it("returns 409 when creating a PR and an open PR already exists for the branch", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreeStatus(worktreePath, {
      branchName: "octogent/terminal-1",
      upstreamBranchName: "origin/octogent/terminal-1",
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    });
    gitClient.setWorktreePullRequest(worktreePath, {
      number: 142,
      url: "https://github.com/hesamsheikh/octogent/pull/142",
      title: "feat: existing worktree lifecycle PR",
      baseRef: "main",
      headRef: "octogent/terminal-1",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });

    const createPrResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/pr`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "feat: should not create duplicate PR",
        body: "Should fail because the branch already has an open PR.",
        baseRef: "main",
      }),
    });
    expect(createPrResponse.status).toBe(409);
    await expect(createPrResponse.json()).resolves.toEqual({
      error: "An open pull request already exists for this branch.",
    });

    expect(gitClient.getPullRequestState(worktreePath)).toBe("OPEN");
  });

  it("merges the current branch PR for worktree tentacles", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const worktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setWorktreePullRequest(worktreePath, {
      number: 190,
      url: "https://github.com/hesamsheikh/octogent/pull/190",
      title: "feat: ship worktree lifecycle",
      baseRef: "main",
      headRef: "octogent/terminal-1",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
    });

    const mergeResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/pr/merge`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(mergeResponse.status).toBe(200);
    expect(gitClient.getPullRequestState(worktreePath)).toBe("MERGED");
    await expect(mergeResponse.json()).resolves.toEqual({
      tentacleId: "terminal-1",
      workspaceMode: "worktree",
      status: "merged",
      number: 190,
      url: "https://github.com/hesamsheikh/octogent/pull/190",
      title: "feat: ship worktree lifecycle",
      baseRef: "main",
      headRef: "octogent/terminal-1",
      isDraft: false,
      mergeable: "UNKNOWN",
      mergeStateStatus: "MERGED",
    });
  });

  it("returns 409 for PR actions on shared tentacles", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const prStatusResponse = await fetch(`${baseUrl}/api/tentacles/terminal-1/git/pr`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(prStatusResponse.status).toBe(409);
    await expect(prStatusResponse.json()).resolves.toEqual({
      error: "Git lifecycle actions are only available for worktree terminals.",
    });
  });

  it("removes isolated worktree metadata when deleting a worktree tentacle", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const expectedWorktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    expect(gitClient.getWorktree(expectedWorktreePath)).toEqual(
      expect.objectContaining({
        cwd: workspaceCwd,
        branchName: "octogent/terminal-1",
      }),
    );

    const deleteResponse = await fetch(`${baseUrl}/api/terminals/terminal-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteResponse.status).toBe(204);
    expect(gitClient.getWorktree(expectedWorktreePath)).toBeNull();
    expect(gitClient.hasBranch("octogent/terminal-1")).toBe(false);
  });

  it("returns 409 and keeps tentacle state when worktree deletion fails", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(201);

    const expectedWorktreePath = join(workspaceCwd, ".octogent", "worktrees", "terminal-1");
    gitClient.setFailRemoveWorktree(true);

    const deleteResponse = await fetch(`${baseUrl}/api/terminals/terminal-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteResponse.status).toBe(409);
    await expect(deleteResponse.json()).resolves.toEqual({
      error: expect.stringContaining("Unable to remove worktree for terminal-1"),
    });
    expect(gitClient.getWorktree(expectedWorktreePath)).toEqual(
      expect.objectContaining({
        cwd: workspaceCwd,
        branchName: "octogent/terminal-1",
      }),
    );

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleId: "terminal-1",
        }),
      ]),
    );
  });

  it("returns 400 when workspace mode is invalid", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "invalid-mode",
      }),
    });

    expect(createResponse.status).toBe(400);
    await expect(createResponse.json()).resolves.toEqual({
      error: "Terminal workspace mode must be either 'shared' or 'worktree'.",
    });
  });

  it("refreshes builtin prompts from promptsDir on server start", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    const projectStateDir = mkdtempSync(join(tmpdir(), "octogent-state-test-"));
    const promptsDir = mkdtempSync(join(tmpdir(), "octogent-prompts-test-"));
    temporaryDirectories.push(workspaceCwd, projectStateDir, promptsDir);

    mkdirSync(join(projectStateDir, "prompts", "core"), { recursive: true });
    writeFileSync(
      join(projectStateDir, "prompts", "core", "swarm-parent.md"),
      "stale prompt with {{workerBranches}}\n",
      "utf8",
    );
    writeFileSync(
      join(promptsDir, "swarm-parent.md"),
      "fresh prompt with {{workerSpawnCommands}}\n",
      "utf8",
    );

    const baseUrl = await startServer({
      workspaceCwd,
      projectStateDir,
      promptsDir,
    });

    const response = await fetch(`${baseUrl}/api/prompts/swarm-parent`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "swarm-parent",
      source: "builtin",
      content: "fresh prompt with {{workerSpawnCommands}}",
    });
  });

  it("reads builtin prompts from the live promptsDir after server start", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    const projectStateDir = mkdtempSync(join(tmpdir(), "octogent-state-test-"));
    const promptsDir = mkdtempSync(join(tmpdir(), "octogent-prompts-test-"));
    temporaryDirectories.push(workspaceCwd, projectStateDir, promptsDir);

    writeFileSync(join(promptsDir, "tentacle-update-tentacle.md"), "version one\n", "utf8");

    const baseUrl = await startServer({
      workspaceCwd,
      projectStateDir,
      promptsDir,
    });

    writeFileSync(join(promptsDir, "tentacle-update-tentacle.md"), "version two\n", "utf8");

    const response = await fetch(`${baseUrl}/api/prompts/tentacle-update-tentacle`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "tentacle-update-tentacle",
      source: "builtin",
      content: "version two",
    });
  });

  it("returns 400 when creating worktree tentacle outside a git repository", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const gitClient = new FakeGitClient();
    gitClient.setRepositoryAvailable(false);
    const baseUrl = await startServer({
      workspaceCwd,
      gitClient,
    });

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceMode: "worktree",
      }),
    });
    expect(createResponse.status).toBe(400);
    await expect(createResponse.json()).resolves.toEqual({
      error: "Worktree terminals require a git repository at the workspace root.",
    });

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([]);
  });

  it("returns 400 when tentacle name is empty after trimming", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: " " }),
    });

    expect(createResponse.status).toBe(400);

    const validCreateResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(validCreateResponse.status).toBe(201);

    const renameResponse = await fetch(`${baseUrl}/api/terminals/terminal-1`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: " " }),
    });

    expect(renameResponse.status).toBe(400);
  });

  it("spawns a shared-workspace todo agent for an individual item", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    mkdirSync(join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge"), {
      recursive: true,
    });
    writeFileSync(
      join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge", "CONTEXT.md"),
      "# Docs & Knowledge\n",
      "utf8",
    );
    writeFileSync(
      join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge", "todo.md"),
      "# Todo\n\n- [ ] Audit docs\n- [ ] Consolidate principles\n",
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });

    const solveResponse = await fetch(`${baseUrl}/api/deck/tentacles/docs-knowledge/todo/solve`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ itemIndex: 0 }),
    });

    expect(solveResponse.status).toBe(201);
    await expect(solveResponse.json()).resolves.toEqual({
      terminalId: "docs-knowledge-todo-0",
      tentacleId: "docs-knowledge",
      itemIndex: 0,
      workspaceMode: "shared",
    });

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        terminalId: "docs-knowledge-todo-0",
        tentacleId: "docs-knowledge",
        tentacleName: "Docs & Knowledge",
        workspaceMode: "shared",
      }),
    ]);
  });

  it("auto-renames todo agents from the todo item context on first prompt submit", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    mkdirSync(join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge"), {
      recursive: true,
    });
    writeFileSync(
      join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge", "CONTEXT.md"),
      "# Docs & Knowledge\n",
      "utf8",
    );
    writeFileSync(
      join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge", "todo.md"),
      "# Todo\n\n- [ ] Audit docs\n- [ ] Consolidate principles\n",
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });

    const solveResponse = await fetch(`${baseUrl}/api/deck/tentacles/docs-knowledge/todo/solve`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ itemIndex: 0 }),
    });
    expect(solveResponse.status).toBe(201);

    const hookResponse = await fetch(
      `${baseUrl}/api/hooks/user-prompt-submit?octogent_session=docs-knowledge-todo-0`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Generic worker prompt body" }),
      },
    );
    expect(hookResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        terminalId: "docs-knowledge-todo-0",
        tentacleId: "docs-knowledge",
        tentacleName: "Audit docs",
        workspaceMode: "shared",
      }),
    ]);
  });

  it("limits swarm prompts to the top-priority items that fit under the child cap", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    mkdirSync(join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge"), {
      recursive: true,
    });
    writeFileSync(
      join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge", "CONTEXT.md"),
      "# Docs & Knowledge\n",
      "utf8",
    );
    const todoItems = Array.from(
      { length: MAX_CHILDREN_PER_PARENT + 4 },
      (_, index) => `- [ ] item ${index}`,
    ).join("\n");
    writeFileSync(
      join(workspaceCwd, ".octogent", "tentacles", "docs-knowledge", "todo.md"),
      `# Todo\n\n${todoItems}\n`,
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });

    const swarmResponse = await fetch(`${baseUrl}/api/deck/tentacles/docs-knowledge/swarm`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(swarmResponse.status).toBe(201);
    await expect(swarmResponse.json()).resolves.toEqual({
      tentacleId: "docs-knowledge",
      parentTerminalId: "docs-knowledge-swarm-parent",
      workers: Array.from({ length: MAX_CHILDREN_PER_PARENT }, (_, index) => ({
        terminalId: `docs-knowledge-swarm-${index}`,
        todoIndex: index,
        todoText: `item ${index}`,
      })),
    });

    const promptTemplate = readFileSync(
      join(process.cwd(), "..", "..", "prompts", "swarm-parent.md"),
      "utf8",
    );
    expect(promptTemplate).toContain(
      "Treat the listed workers as the highest-priority items and proceed without asking the user whether to batch, reprioritize, or raise the limit.",
    );
  });

  it("deletes a tentacle and removes it from snapshots", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    expect(createResponse.status).toBe(201);

    const deleteResponse = await fetch(`${baseUrl}/api/terminals/terminal-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteResponse.status).toBe(204);

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([]);

    const missingResponse = await fetch(`${baseUrl}/api/terminals/terminal-1`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(missingResponse.status).toBe(204);
  });

  it("deletes descendant terminals when deleting a parent terminal", async () => {
    const baseUrl = await startServer();

    const createParentResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ terminalId: "parent-terminal" }),
    });
    expect(createParentResponse.status).toBe(201);

    const createChildResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        terminalId: "child-terminal",
        parentTerminalId: "parent-terminal",
      }),
    });
    expect(createChildResponse.status).toBe(201);

    const createGrandchildResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        terminalId: "grandchild-terminal",
        parentTerminalId: "child-terminal",
      }),
    });
    expect(createGrandchildResponse.status).toBe(201);

    const createSiblingResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ terminalId: "unrelated-terminal" }),
    });
    expect(createSiblingResponse.status).toBe(201);

    const deleteResponse = await fetch(`${baseUrl}/api/terminals/parent-terminal`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    expect(deleteResponse.status).toBe(204);

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({ terminalId: "unrelated-terminal" }),
    ]);
  });

  it("restores tentacles across API restarts using persisted registry", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);

    const firstBaseUrl = await startServer({
      workspaceCwd,
    });

    const createResponse = await fetch(`${firstBaseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "planner" }),
    });
    expect(createResponse.status).toBe(201);

    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    const secondBaseUrl = await startServer({
      workspaceCwd,
    });

    const listResponse = await fetch(`${secondBaseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalId: "terminal-1",
          tentacleId: "terminal-1",
          tentacleName: "planner",
        }),
      ]),
    );
  });

  it("marks persisted running terminals as stale when the API starts without their session", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    mkdirSync(join(workspaceCwd, ".octogent", "state"), { recursive: true });
    writeFileSync(
      registryPath,
      `${JSON.stringify(
        {
          version: 3,
          terminals: [
            {
              terminalId: "terminal-1",
              tentacleId: "terminal-1",
              tentacleName: "planner",
              createdAt: "2026-04-09T10:00:00.000Z",
              workspaceMode: "shared",
              lifecycleState: "running",
              processId: 99999999,
              lifecycleUpdatedAt: "2026-04-09T10:01:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({
        terminalId: "terminal-1",
        state: "stale",
        lifecycleState: "stale",
        lifecycleReason: "missing_process",
        processId: 99999999,
      }),
    ]);
  });

  it("stops and prunes stale terminal records through lifecycle endpoints", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    mkdirSync(join(workspaceCwd, ".octogent", "state"), { recursive: true });
    writeFileSync(
      registryPath,
      `${JSON.stringify(
        {
          version: 3,
          terminals: [
            {
              terminalId: "terminal-1",
              tentacleId: "terminal-1",
              tentacleName: "planner",
              createdAt: "2026-04-09T10:00:00.000Z",
              workspaceMode: "shared",
              lifecycleState: "running",
              processId: 99999999,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });

    const stopResponse = await fetch(`${baseUrl}/api/terminals/terminal-1/stop`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(stopResponse.status).toBe(200);
    await expect(stopResponse.json()).resolves.toEqual(
      expect.objectContaining({
        terminalId: "terminal-1",
        lifecycleState: "stopped",
        lifecycleReason: "operator_stop",
      }),
    );

    const pruneResponse = await fetch(`${baseUrl}/api/terminals/prune`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(pruneResponse.status).toBe(200);
    await expect(pruneResponse.json()).resolves.toEqual({
      prunedTerminalIds: ["terminal-1"],
    });

    const listResponse = await fetch(`${baseUrl}/api/terminal-snapshots`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Deck — opened / pinned routes
  // ---------------------------------------------------------------------------

  const makeTentacleOnDisk = (workspaceCwd: string, tentacleId: string) => {
    const tentacleDir = join(workspaceCwd, ".octogent", "tentacles", tentacleId);
    mkdirSync(tentacleDir, { recursive: true });
    writeFileSync(join(tentacleDir, "CONTEXT.md"), `# ${tentacleId}\n\nTest tentacle.\n`, "utf8");
    writeFileSync(join(tentacleDir, "todo.md"), "# Todo\n", "utf8");
  };

  it("POST /api/deck/tentacles/:id/opened increments openCount and sets lastOpenedAt", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    makeTentacleOnDisk(workspaceCwd, "alpha");
    const baseUrl = await startServer({ workspaceCwd });

    const res1 = await fetch(`${baseUrl}/api/deck/tentacles/alpha/opened`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { openCount: number; lastOpenedAt: string | null };
    expect(body1.openCount).toBe(1);
    expect(typeof body1.lastOpenedAt).toBe("string");
    expect(Number.isNaN(new Date(body1.lastOpenedAt as string).getTime())).toBe(false);

    const res2 = await fetch(`${baseUrl}/api/deck/tentacles/alpha/opened`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { openCount: number };
    expect(body2.openCount).toBe(2);
  });

  it("POST /api/deck/tentacles/:id/opened returns 404 for unknown tentacle", async () => {
    const baseUrl = await startServer();

    const res = await fetch(`${baseUrl}/api/deck/tentacles/nonexistent/opened`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Tentacle not found" });
  });

  it("PATCH /api/deck/tentacles/:id/pinned toggles pin and round-trips via GET", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    makeTentacleOnDisk(workspaceCwd, "beta");
    const baseUrl = await startServer({ workspaceCwd });

    const pinRes = await fetch(`${baseUrl}/api/deck/tentacles/beta/pinned`, {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pinRes.status).toBe(200);
    const pinBody = (await pinRes.json()) as { pinned: boolean; tentacleId: string };
    expect(pinBody.pinned).toBe(true);
    expect(pinBody.tentacleId).toBe("beta");

    const listRes = await fetch(`${baseUrl}/api/deck/tentacles`, {
      headers: { Accept: "application/json" },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ tentacleId: string; pinned: boolean }>;
    expect(list.find((t) => t.tentacleId === "beta")?.pinned).toBe(true);

    const unpinRes = await fetch(`${baseUrl}/api/deck/tentacles/beta/pinned`, {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: false }),
    });
    expect(unpinRes.status).toBe(200);
    const unpinBody = (await unpinRes.json()) as { pinned: boolean };
    expect(unpinBody.pinned).toBe(false);
  });

  it("PATCH /api/deck/tentacles/:id/pinned returns 400 for malformed body", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    makeTentacleOnDisk(workspaceCwd, "gamma");
    const baseUrl = await startServer({ workspaceCwd });

    const res = await fetch(`${baseUrl}/api/deck/tentacles/gamma/pinned`, {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: "yes" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "pinned (boolean) is required" });
  });

  it("PATCH /api/deck/tentacles/:id/pinned returns 404 for unknown tentacle", async () => {
    const baseUrl = await startServer();

    const res = await fetch(`${baseUrl}/api/deck/tentacles/ghost/pinned`, {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Tentacle not found" });
  });

  it("disk-only tentacle gets default lastOpenedAt=null, openCount=0, pinned=false", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    makeTentacleOnDisk(workspaceCwd, "delta");
    const baseUrl = await startServer({ workspaceCwd });

    const listRes = await fetch(`${baseUrl}/api/deck/tentacles`, {
      headers: { Accept: "application/json" },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{
      tentacleId: string;
      lastOpenedAt: unknown;
      openCount: unknown;
      pinned: unknown;
    }>;
    const delta = list.find((t) => t.tentacleId === "delta");
    expect(delta?.lastOpenedAt).toBeNull();
    expect(delta?.openCount).toBe(0);
    expect(delta?.pinned).toBe(false);
  });

  it("PATCH pinned preserves unknown keys in deck.json", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-api-test-"));
    temporaryDirectories.push(workspaceCwd);
    makeTentacleOnDisk(workspaceCwd, "epsilon");

    // Pre-seed deck.json with a custom unknown key on the tentacle entry
    const deckJsonPath = join(workspaceCwd, ".octogent", "state", "deck.json");
    mkdirSync(join(workspaceCwd, ".octogent", "state"), { recursive: true });
    writeFileSync(
      deckJsonPath,
      JSON.stringify(
        {
          tentacles: {
            epsilon: {
              color: "#ff0000",
              status: "idle",
              octopus: { animation: null, expression: null, accessory: null, hairColor: null },
              scope: { paths: [], tags: [] },
              lastOpenedAt: null,
              openCount: 0,
              pinned: false,
              _customKey: "should-survive",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const baseUrl = await startServer({ workspaceCwd });

    const pinRes = await fetch(`${baseUrl}/api/deck/tentacles/epsilon/pinned`, {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pinRes.status).toBe(200);

    const rawAfter = JSON.parse(readFileSync(deckJsonPath, "utf8")) as {
      tentacles: Record<string, Record<string, unknown>>;
    };
    expect(rawAfter.tentacles.epsilon?._customKey).toBe("should-survive");
    expect(rawAfter.tentacles.epsilon?.pinned).toBe(true);
  });
});
