import { mkdtempSync, rmSync } from "node:fs";
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

class FakeGitClient {
  assertAvailable(): void {}
  isRepository(): boolean {
    return false;
  }
  getWorktreeStatus() {
    return null;
  }
  getCommits() {
    return [];
  }
  getPushCount() {
    return 0;
  }
  getSyncBaseRefs() {
    return [];
  }
  getPullRequestState() {
    return null;
  }
  hasBranch() {
    return false;
  }
  getLastCommitMessage() {
    return null;
  }
  addWorktree() {
    return Promise.resolve();
  }
  removeWorktree() {
    return Promise.resolve();
  }
  commit() {
    return Promise.resolve();
  }
  push() {
    return Promise.resolve();
  }
  sync() {
    return Promise.resolve({ conflicts: false });
  }
  createPullRequest() {
    return Promise.resolve({ number: 1, url: "https://github.com/example/pr/1" });
  }
  mergePullRequest() {
    return Promise.resolve();
  }
  listWorktrees() {
    return [];
  }
  listBranches() {
    return [];
  }
}

describe("voiceRoutes", () => {
  let stopServer: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const startServer = async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-voice-test-"));
    temporaryDirectories.push(workspaceCwd);
    const apiServer = createApiServer({
      workspaceCwd,
      gitClient: new FakeGitClient() as never,
    });
    const address = await apiServer.start(0, "127.0.0.1");
    stopServer = () => apiServer.stop();
    return `http://${address.host}:${address.port}`;
  };

  it("POST /api/voice/speak returns 400 when no provider env vars are set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    vi.stubEnv("PIPER_BIN", "");
    vi.stubEnv("PIPER_MODEL", "");
    vi.stubEnv("KOKORO_URL", "");
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("No server TTS provider configured");
  });

  it("POST /api/voice/speak with DEEPGRAM_API_KEY set proxies non-ok upstream status with provider:deepgram", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "fake-deepgram-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    vi.stubEnv("PIPER_BIN", "");
    vi.stubEnv("PIPER_MODEL", "");
    vi.stubEnv("KOKORO_URL", "");
    const baseUrl = await startServer();

    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("deepgram.com")) {
        return Promise.resolve(new Response("upstream error", { status: 429 }));
      }
      return realFetch(input, init);
    });

    const response = await fetch(`${baseUrl}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(429);
    const json = (await response.json()) as { error: string; provider: string };
    expect(json.provider).toBe("deepgram");
    expect(json.error).toBe("Speech synthesis failed.");
  });

  it("POST /api/voice/speak with ELEVENLABS 402 falls back to Deepgram and returns audio", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "fake-el-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "fake-voice-id");
    vi.stubEnv("DEEPGRAM_API_KEY", "fake-deepgram-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("PIPER_BIN", "");
    vi.stubEnv("PIPER_MODEL", "");
    vi.stubEnv("KOKORO_URL", "");
    const baseUrl = await startServer();

    const fakeAudio = new Uint8Array([0xff, 0xfb, 0x10, 0x00]);
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("elevenlabs.io")) {
        return Promise.resolve(new Response("out of credits", { status: 402 }));
      }
      if (url.includes("deepgram.com")) {
        const deepgramBody = new ReadableStream({
          start(controller) {
            controller.enqueue(fakeAudio);
            controller.close();
          },
        });
        return Promise.resolve(new Response(deepgramBody, { status: 200 }));
      }
      return realFetch(input, init);
    });

    const response = await fetch(`${baseUrl}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", provider: "elevenlabs" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
  });

  it("POST /api/voice/speak with KOKORO_URL set returns 502 when upstream throws", async () => {
    vi.stubEnv("KOKORO_URL", "http://127.0.0.1:19999");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    vi.stubEnv("PIPER_BIN", "");
    vi.stubEnv("PIPER_MODEL", "");
    const baseUrl = await startServer();

    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("19999")) {
        return Promise.reject(new Error("connection refused"));
      }
      return realFetch(input, init);
    });

    const response = await fetch(`${baseUrl}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(502);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("Kokoro TTS failed.");
  });

  it("POST /api/voice/speak returns 400 with error:text is required when body missing text", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "fake-deepgram-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    vi.stubEnv("PIPER_BIN", "");
    vi.stubEnv("PIPER_MODEL", "");
    vi.stubEnv("KOKORO_URL", "");
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepgram" }),
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("text is required.");
  });

  it("GET /api/voice/voices returns 200 and an array of voices", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/voice/voices`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { voices: unknown[] };
    expect(Array.isArray(json.voices)).toBe(true);
  });

  it("POST /api/voice/text with transcript body returns 200 plain-text echo", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/voice/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "hello world" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toBe("hello world");
  });
});
