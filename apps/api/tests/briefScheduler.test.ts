import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrainDigest } from "../src/createApiServer/brainRoutes";

import {
  DEFAULT_BRIEF_CONFIG,
  parseBriefConfigPatch,
  readBriefConfig,
  renderBriefMarkdown,
  runBriefCheck,
  shouldWriteBrief,
  writeBriefConfig,
} from "../src/createApiServer/briefScheduler";

const tempDirs: string[] = [];
const makeDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const digest = (): BrainDigest => ({
  configured: true,
  date: "2026-06-12",
  dailyNote: { exists: false, path: null },
  recentNotes: [
    { title: "Plan", path: "Areas/Plan.md", modified: "2026-06-12T08:00:00.000Z", snippet: "x" },
  ],
  tasks: { open: ["Call vendor", "Review PR"], openCount: 2 },
  journal: [
    {
      ts: "2026-06-12T07:00:00.000Z",
      status: "ok",
      skill: null,
      action: "Ran digest",
      detail: null,
    },
  ],
  memory: { factCount: 3 },
});

// 2026-06-12 is a Friday at 09:00 local
const NINE_AM = new Date(2026, 5, 12, 9, 0, 0);
const SEVEN_AM = new Date(2026, 5, 12, 7, 0, 0);

describe("shouldWriteBrief", () => {
  it("is false when disabled", () => {
    expect(shouldWriteBrief({ ...DEFAULT_BRIEF_CONFIG, enabled: false }, NINE_AM)).toBe(false);
  });

  it("is true once the configured time has passed and not yet written today", () => {
    expect(
      shouldWriteBrief(
        { enabled: true, time: "08:00", lastBriefDate: null, lastBriefAt: null },
        NINE_AM,
      ),
    ).toBe(true);
  });

  it("is false before the configured time", () => {
    expect(
      shouldWriteBrief(
        { enabled: true, time: "08:00", lastBriefDate: null, lastBriefAt: null },
        SEVEN_AM,
      ),
    ).toBe(false);
  });

  it("is false when today's brief was already written", () => {
    expect(
      shouldWriteBrief(
        { enabled: true, time: "08:00", lastBriefDate: "2026-06-12", lastBriefAt: null },
        NINE_AM,
      ),
    ).toBe(false);
  });
});

describe("parseBriefConfigPatch", () => {
  it("accepts enabled + valid time", () => {
    expect(parseBriefConfigPatch(DEFAULT_BRIEF_CONFIG, { enabled: true, time: "06:30" })).toEqual({
      config: { ...DEFAULT_BRIEF_CONFIG, enabled: true, time: "06:30" },
    });
  });

  it("rejects an invalid time", () => {
    expect(parseBriefConfigPatch(DEFAULT_BRIEF_CONFIG, { time: "25:00" })).toHaveProperty("error");
    expect(parseBriefConfigPatch(DEFAULT_BRIEF_CONFIG, { time: "8am" })).toHaveProperty("error");
  });

  it("rejects a non-boolean enabled", () => {
    expect(parseBriefConfigPatch(DEFAULT_BRIEF_CONFIG, { enabled: "yes" })).toHaveProperty("error");
  });
});

describe("renderBriefMarkdown", () => {
  it("includes the date, tasks, notes, and activity", () => {
    const md = renderBriefMarkdown(digest(), "2026-06-12T09:00:00.000Z");
    expect(md).toContain("# Daily Brief — 2026-06-12");
    expect(md).toContain("no agent run");
    expect(md).toContain("Open tasks (2)");
    expect(md).toContain("- Call vendor");
    expect(md).toContain("Ran digest");
    expect(md).toContain("Memory facts on file: 3");
  });
});

describe("runBriefCheck", () => {
  it("writes the dated note when due and records the run", () => {
    const stateDir = makeDir("octogent-brief-state-");
    const vaultDir = makeDir("octogent-brief-vault-");
    writeBriefConfig(stateDir, {
      enabled: true,
      time: "08:00",
      lastBriefDate: null,
      lastBriefAt: null,
    });

    const result = runBriefCheck({
      projectStateDir: stateDir,
      now: NINE_AM,
      computeDigest: digest,
      getVaultDir: () => vaultDir,
    });

    expect(result.written).toBe(true);
    const notePath = join(vaultDir, "Journal", "Daily Brief - 2026-06-12.md");
    expect(existsSync(notePath)).toBe(true);
    expect(readFileSync(notePath, "utf8")).toContain("# Daily Brief — 2026-06-12");
    expect(readBriefConfig(stateDir).lastBriefDate).toBe("2026-06-12");
  });

  it("does not write twice for the same date", () => {
    const stateDir = makeDir("octogent-brief-state-");
    const vaultDir = makeDir("octogent-brief-vault-");
    writeBriefConfig(stateDir, {
      enabled: true,
      time: "08:00",
      lastBriefDate: null,
      lastBriefAt: null,
    });

    const first = runBriefCheck({
      projectStateDir: stateDir,
      now: NINE_AM,
      computeDigest: digest,
      getVaultDir: () => vaultDir,
    });
    expect(first.written).toBe(true);

    const second = runBriefCheck({
      projectStateDir: stateDir,
      now: new Date(2026, 5, 12, 10, 0, 0),
      computeDigest: digest,
      getVaultDir: () => vaultDir,
    });
    expect(second.written).toBe(false);
  });

  it("never overwrites an existing note file for the date", () => {
    const stateDir = makeDir("octogent-brief-state-");
    const vaultDir = makeDir("octogent-brief-vault-");
    writeBriefConfig(stateDir, {
      enabled: true,
      time: "08:00",
      lastBriefDate: null,
      lastBriefAt: null,
    });

    const noteDir = join(vaultDir, "Journal");
    const notePath = join(noteDir, "Daily Brief - 2026-06-12.md");
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(notePath, "pre-existing", "utf8");

    const result = runBriefCheck({
      projectStateDir: stateDir,
      now: NINE_AM,
      computeDigest: digest,
      getVaultDir: () => vaultDir,
    });
    expect(result.written).toBe(false);
    expect(readFileSync(notePath, "utf8")).toBe("pre-existing");
  });

  it("reports no-vault when the vault is not configured", () => {
    const stateDir = makeDir("octogent-brief-state-");
    writeBriefConfig(stateDir, {
      enabled: true,
      time: "08:00",
      lastBriefDate: null,
      lastBriefAt: null,
    });
    const result = runBriefCheck({
      projectStateDir: stateDir,
      now: NINE_AM,
      computeDigest: digest,
      getVaultDir: () => null,
    });
    expect(result).toEqual({ written: false, reason: "no-vault" });
  });
});
