import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readTokenTelemetry,
  recordSessionTokenUsage,
  scanTranscriptTokenUsage,
} from "../src/terminalRuntime/tokenTelemetry";

const tempDirs: string[] = [];

const makeStateDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-telemetry-test-"));
  tempDirs.push(dir);
  return dir;
};

const writeTranscript = (lines: unknown[]): string => {
  const dir = makeStateDir();
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return path;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("scanTranscriptTokenUsage", () => {
  it("returns null when the transcript file does not exist", () => {
    expect(scanTranscriptTokenUsage(join(tmpdir(), "nope-does-not-exist.jsonl"))).toBeNull();
  });

  it("returns null when no assistant message carries a usage block", () => {
    const path = writeTranscript([
      { type: "user", message: { role: "user", content: "hi" } },
      { type: "assistant", message: { role: "assistant", content: "hello" } },
    ]);
    expect(scanTranscriptTokenUsage(path)).toBeNull();
  });

  it("sums real usage across assistant messages and ignores other lines", () => {
    const path = writeTranscript([
      { type: "user", message: { role: "user", content: "go" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 10,
          },
        },
      },
      { type: "summary", summary: "ignored" },
      {
        type: "assistant",
        message: {
          role: "assistant",
          usage: { input_tokens: 50, output_tokens: 8 },
        },
      },
    ]);

    expect(scanTranscriptTokenUsage(path)).toEqual({
      inputTokens: 150,
      outputTokens: 28,
      cacheCreationTokens: 5,
      cacheReadTokens: 10,
      messageCount: 2,
    });
  });

  it("skips assistant usage blocks whose counts are all zero", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: { role: "assistant", usage: { input_tokens: 0, output_tokens: 0 } },
      },
    ]);
    expect(scanTranscriptTokenUsage(path)).toBeNull();
  });
});

describe("recordSessionTokenUsage / readTokenTelemetry", () => {
  const totals = {
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    messageCount: 1,
  };

  it("returns an empty document before anything is recorded", () => {
    const stateDir = makeStateDir();
    expect(readTokenTelemetry(stateDir)).toEqual({ version: 1, sessions: {} });
  });

  it("persists a session entry and reads it back", () => {
    const stateDir = makeStateDir();
    recordSessionTokenUsage({
      projectStateDir: stateDir,
      sessionId: "sess-1",
      terminalId: "terminal-1",
      tentacleId: "tentacle-1",
      totals,
      now: "2026-06-12T10:00:00.000Z",
    });

    const document = readTokenTelemetry(stateDir);
    expect(document.sessions["sess-1"]).toMatchObject({
      sessionId: "sess-1",
      terminalId: "terminal-1",
      tentacleId: "tentacle-1",
      inputTokens: 100,
      outputTokens: 20,
      firstRecordedAt: "2026-06-12T10:00:00.000Z",
      lastRecordedAt: "2026-06-12T10:00:00.000Z",
    });
  });

  it("SETS totals on re-record (idempotent) and preserves firstRecordedAt", () => {
    const stateDir = makeStateDir();
    recordSessionTokenUsage({
      projectStateDir: stateDir,
      sessionId: "sess-1",
      terminalId: "terminal-1",
      tentacleId: "tentacle-1",
      totals,
      now: "2026-06-12T10:00:00.000Z",
    });
    recordSessionTokenUsage({
      projectStateDir: stateDir,
      sessionId: "sess-1",
      terminalId: "terminal-1",
      tentacleId: "tentacle-1",
      totals: { ...totals, inputTokens: 300, outputTokens: 60, messageCount: 3 },
      now: "2026-06-12T11:00:00.000Z",
    });

    const entry = readTokenTelemetry(stateDir).sessions["sess-1"];
    expect(entry?.inputTokens).toBe(300);
    expect(entry?.outputTokens).toBe(60);
    expect(entry?.messageCount).toBe(3);
    expect(entry?.firstRecordedAt).toBe("2026-06-12T10:00:00.000Z");
    expect(entry?.lastRecordedAt).toBe("2026-06-12T11:00:00.000Z");
  });

  it("recovers from a corrupt telemetry file by treating it as empty", () => {
    const stateDir = makeStateDir();
    const statePath = join(stateDir, "state");
    rmSync(statePath, { recursive: true, force: true });
    writeFileSync(join(stateDir, "telemetry-placeholder"), "x", "utf8");
    // Write corrupt content at the real telemetry path.
    recordSessionTokenUsage({
      projectStateDir: stateDir,
      sessionId: "sess-1",
      terminalId: "terminal-1",
      tentacleId: "tentacle-1",
      totals,
      now: "2026-06-12T10:00:00.000Z",
    });
    const telemetryPath = join(stateDir, "state", "telemetry.json");
    writeFileSync(telemetryPath, "{ not json", "utf8");
    expect(readTokenTelemetry(stateDir)).toEqual({ version: 1, sessions: {} });
    // Recording after corruption rebuilds a clean document.
    recordSessionTokenUsage({
      projectStateDir: stateDir,
      sessionId: "sess-2",
      terminalId: "terminal-2",
      tentacleId: "tentacle-2",
      totals,
      now: "2026-06-12T12:00:00.000Z",
    });
    expect(Object.keys(readTokenTelemetry(stateDir).sessions)).toEqual(["sess-2"]);
    expect(readFileSync(telemetryPath, "utf8")).toContain("sess-2");
  });
});
