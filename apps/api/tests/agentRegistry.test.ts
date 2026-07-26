import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AgentEvent, agentEventBus } from "../src/createApiServer/agentEventBus";
import { agentRegistry } from "../src/createApiServer/agentRegistry";

describe("agentRegistry", () => {
  let events: AgentEvent[] = [];
  let listener: (e: AgentEvent) => void;

  beforeEach(() => {
    events = [];
    listener = (e) => events.push(e);
    agentEventBus.on(listener);
    vi.useFakeTimers();
  });

  afterEach(() => {
    agentEventBus.off(listener);
    vi.useRealTimers();
  });

  const uid = () => `test-${Math.random().toString(36).slice(2, 9)}`;

  it("register returns an AbortSignal that is not yet aborted", () => {
    const id = uid();
    const signal = agentRegistry.register(id, "task", "model");

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("register creates a working-state record", () => {
    const id = uid();
    agentRegistry.register(id, "my task", "claude-haiku");

    const record = agentRegistry.get(id);
    expect(record).toBeDefined();
    expect(record?.state).toBe("working");
    expect(record?.task).toBe("my task");
    expect(record?.model).toBe("claude-haiku");
  });

  it("register emits agent_registered and state_changed events", () => {
    const id = uid();
    agentRegistry.register(id, "t", "m");

    expect(events.some((e) => e.type === "agent_registered" && e.agentId === id)).toBe(true);
    expect(
      events.some((e) => e.type === "state_changed" && e.agentId === id && e.state === "working"),
    ).toBe(true);
  });

  it("setState updates the record state and emits state_changed", () => {
    const id = uid();
    agentRegistry.register(id, "t", "m");
    events = [];

    agentRegistry.setState(id, "blocked");

    expect(agentRegistry.get(id)?.state).toBe("blocked");
    expect(events[0]).toMatchObject({ type: "state_changed", agentId: id, state: "blocked" });
  });

  it("setTool updates currentTool on the record", () => {
    const id = uid();
    agentRegistry.register(id, "t", "m");
    agentRegistry.setTool(id, "web_search");

    expect(agentRegistry.get(id)?.currentTool).toBe("web_search");
  });

  it("setRound updates currentRound on the record", () => {
    const id = uid();
    agentRegistry.register(id, "t", "m");
    agentRegistry.setRound(id, 2);

    expect(agentRegistry.get(id)?.currentRound).toBe(2);
  });

  it("cancel aborts the signal and transitions state to cancelled", () => {
    const id = uid();
    const signal = agentRegistry.register(id, "t", "m");
    events = [];

    agentRegistry.cancel(id);

    expect(signal.aborted).toBe(true);
    expect(agentRegistry.get(id)?.state).toBe("cancelled");
    expect(events.some((e) => e.type === "agent_cancelled" && e.agentId === id)).toBe(true);
    expect(
      events.some((e) => e.type === "state_changed" && e.agentId === id && e.state === "cancelled"),
    ).toBe(true);
  });

  it("cancel is a no-op for already-terminal states", () => {
    const id = uid();
    const signal = agentRegistry.register(id, "t", "m");
    agentRegistry.cancel(id);
    events = [];

    agentRegistry.cancel(id);

    expect(signal.aborted).toBe(true);
    expect(events).toHaveLength(0);
  });

  it("scheduleCleanup removes the record after the delay", () => {
    const id = uid();
    agentRegistry.register(id, "t", "m");
    agentRegistry.scheduleCleanup(id, 1_000);

    expect(agentRegistry.get(id)).toBeDefined();

    vi.advanceTimersByTime(1_001);

    expect(agentRegistry.get(id)).toBeUndefined();
  });

  it("getAll returns all current records", () => {
    const id1 = uid();
    const id2 = uid();
    agentRegistry.register(id1, "task1", "m");
    agentRegistry.register(id2, "task2", "m");

    const all = agentRegistry.getAll();
    const ids = all.map((r) => r.agentId);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("setState is a no-op for unknown agentId", () => {
    expect(() => agentRegistry.setState("unknown-id", "done")).not.toThrow();
    expect(events.filter((e) => e.agentId === "unknown-id")).toHaveLength(0);
  });
});
