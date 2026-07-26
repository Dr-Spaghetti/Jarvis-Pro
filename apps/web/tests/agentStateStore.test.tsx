import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AgentRecord, agentStateStore } from "../src/app/agentStateStore";

const makeRecord = (overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  agentId: "agent-1",
  task: "do something",
  model: "claude-haiku",
  state: "working",
  startedAt: 1000,
  ...overrides,
});

beforeEach(() => {
  agentStateStore.applyServerMessage({ type: "snapshot", agents: [] });
});

describe("agentStateStore", () => {
  it("starts with an empty snapshot", () => {
    expect(agentStateStore.getSnapshot().size).toBe(0);
  });

  it("snapshot message populates the map", () => {
    const record = makeRecord();
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [record] });

    const snap = agentStateStore.getSnapshot();
    expect(snap.size).toBe(1);
    expect(snap.get("agent-1")).toMatchObject({ task: "do something", state: "working" });
  });

  it("snapshot message replaces existing state entirely", () => {
    agentStateStore.applyServerMessage({
      type: "snapshot",
      agents: [makeRecord({ agentId: "old" })],
    });
    agentStateStore.applyServerMessage({
      type: "snapshot",
      agents: [makeRecord({ agentId: "new" })],
    });

    const snap = agentStateStore.getSnapshot();
    expect(snap.has("old")).toBe(false);
    expect(snap.has("new")).toBe(true);
  });

  it("agent_registered event creates a new record", () => {
    agentStateStore.applyServerMessage({
      type: "event",
      event: { type: "agent_registered", agentId: "a2", task: "t", model: "m", ts: 999 },
    });

    const rec = agentStateStore.getSnapshot().get("a2");
    expect(rec).toBeDefined();
    expect(rec?.state).toBe("working");
    expect(rec?.startedAt).toBe(999);
  });

  it("state_changed event updates existing record state", () => {
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord()] });
    agentStateStore.applyServerMessage({
      type: "event",
      event: { type: "state_changed", agentId: "agent-1", state: "blocked", ts: 1001 },
    });

    expect(agentStateStore.getSnapshot().get("agent-1")?.state).toBe("blocked");
  });

  it("tool_start event updates currentTool and currentRound", () => {
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord()] });
    agentStateStore.applyServerMessage({
      type: "event",
      event: { type: "tool_start", agentId: "agent-1", tool: "web_search", round: 1, ts: 2 },
    });

    const rec = agentStateStore.getSnapshot().get("agent-1");
    expect(rec?.currentTool).toBe("web_search");
    expect(rec?.currentRound).toBe(1);
  });

  it("tool_done event clears currentTool", () => {
    agentStateStore.applyServerMessage({
      type: "snapshot",
      agents: [makeRecord({ currentTool: "web_search" })],
    });
    agentStateStore.applyServerMessage({
      type: "event",
      event: { type: "tool_done", agentId: "agent-1", tool: "web_search", durationMs: 300, ts: 3 },
    });

    const rec = agentStateStore.getSnapshot().get("agent-1");
    expect(rec?.currentTool).toBeUndefined();
  });

  it("round_started event updates currentRound", () => {
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord()] });
    agentStateStore.applyServerMessage({
      type: "event",
      event: { type: "round_started", agentId: "agent-1", round: 2, maxRounds: 4, ts: 4 },
    });

    expect(agentStateStore.getSnapshot().get("agent-1")?.currentRound).toBe(2);
  });

  it("notifies subscribers on mutation", () => {
    const notify = vi.fn();
    const unsub = agentStateStore.subscribe(notify);

    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord()] });
    expect(notify).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("unsubscribe stops notifications", () => {
    const notify = vi.fn();
    const unsub = agentStateStore.subscribe(notify);
    unsub();

    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord()] });
    expect(notify).not.toHaveBeenCalled();
  });

  it("getSnapshot returns a stable reference until mutation", () => {
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord()] });
    const snap1 = agentStateStore.getSnapshot();
    const snap2 = agentStateStore.getSnapshot();

    expect(snap1).toBe(snap2);
  });

  it("getSnapshot reference changes after mutation", () => {
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord()] });
    const snap1 = agentStateStore.getSnapshot();

    agentStateStore.applyServerMessage({
      type: "event",
      event: { type: "state_changed", agentId: "agent-1", state: "done", ts: 5 },
    });
    const snap2 = agentStateStore.getSnapshot();

    expect(snap1).not.toBe(snap2);
  });

  it("ignores state_changed for unknown agentId", () => {
    agentStateStore.applyServerMessage({
      type: "event",
      event: { type: "state_changed", agentId: "unknown", state: "done", ts: 6 },
    });

    expect(agentStateStore.getSnapshot().has("unknown")).toBe(false);
  });
});
