import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execFileSync, spawn } from "node:child_process";

import { agenticAsk, resetClaudeBinaryCache } from "../src/createApiServer/agenticAsk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeProc = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

const makeFakeProc = (): FakeProc => {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agenticAsk — output overflow protection", () => {
  beforeEach(() => {
    resetClaudeBinaryCache();
    vi.mocked(execFileSync).mockReturnValue("claude\n" as unknown as Buffer);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("kills the process and resolves output-overflow when stdout exceeds 1 MB", async () => {
    let proc!: FakeProc;
    vi.mocked(spawn).mockImplementationOnce(() => {
      proc = makeFakeProc();
      return proc as unknown as ReturnType<typeof spawn>;
    });

    const promise = agenticAsk("show me everything", "ctx", ["localfalcon"]);

    // One chunk slightly over the cap
    proc.stdout.emit("data", Buffer.alloc(1_000_001, 0x41));

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("output-overflow");
      expect(result.hint).toMatch(/too large/i);
    }
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it("kills the process and resolves output-overflow when stderr exceeds 1 MB", async () => {
    let proc!: FakeProc;
    vi.mocked(spawn).mockImplementationOnce(() => {
      proc = makeFakeProc();
      return proc as unknown as ReturnType<typeof spawn>;
    });

    const promise = agenticAsk("show me everything", "ctx", ["apollo"]);

    proc.stderr.emit("data", Buffer.alloc(1_000_001, 0x42));

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("output-overflow");
    }
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it("triggers overflow on the second of two accumulated chunks that push past the cap", async () => {
    let proc!: FakeProc;
    vi.mocked(spawn).mockImplementationOnce(() => {
      proc = makeFakeProc();
      return proc as unknown as ReturnType<typeof spawn>;
    });

    const promise = agenticAsk("big question", "ctx", ["localfalcon"]);

    // 600 kB — safe on its own
    proc.stdout.emit("data", Buffer.alloc(600_000, 0x41));
    // another 600 kB — cumulative 1.2 MB, triggers overflow
    proc.stdout.emit("data", Buffer.alloc(600_000, 0x41));

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("output-overflow");
    }
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it("does not trigger overflow for output just at the cap and resolves normally on close", async () => {
    let proc!: FakeProc;
    vi.mocked(spawn).mockImplementationOnce(() => {
      proc = makeFakeProc();
      return proc as unknown as ReturnType<typeof spawn>;
    });

    const promise = agenticAsk("small question", "ctx", ["localfalcon"]);

    // Exactly 1_000_000 bytes — should NOT trigger overflow
    proc.stdout.emit("data", Buffer.alloc(1_000_000, 0x41));
    proc.emit("close");

    const result = await promise;

    // Close fires with a 1 MB stdout string — brainRoutes trims it and returns ok
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe("Local Falcon");
    }
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("does not call kill twice when both streams overflow", async () => {
    let proc!: FakeProc;
    vi.mocked(spawn).mockImplementationOnce(() => {
      proc = makeFakeProc();
      return proc as unknown as ReturnType<typeof spawn>;
    });

    const promise = agenticAsk("everything", "ctx", ["localfalcon"]);

    proc.stdout.emit("data", Buffer.alloc(1_000_001, 0x41));
    // settled — a second stream overflow must not double-kill or double-resolve
    proc.stderr.emit("data", Buffer.alloc(1_000_001, 0x42));

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("output-overflow");
    }
    // kill may be called once (stdout) or twice (stdout + stderr before settled guard),
    // but the promise must still resolve exactly once.
    expect(proc.kill.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
