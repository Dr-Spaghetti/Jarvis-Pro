import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AgentEvent, agentEventBus } from "../src/createApiServer/agentEventBus";

describe("agentEventBus", () => {
  let received: AgentEvent[] = [];
  let listener: (e: AgentEvent) => void;

  beforeEach(() => {
    received = [];
    listener = (e) => received.push(e);
    agentEventBus.on(listener);
  });

  afterEach(() => {
    agentEventBus.off(listener);
  });

  it("delivers emitted events to registered listeners", () => {
    const event: AgentEvent = {
      type: "agent_registered",
      agentId: "a1",
      task: "do something",
      model: "claude-haiku",
      ts: 1000,
    };
    agentEventBus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it("delivers multiple event types in order", () => {
    agentEventBus.emit({ type: "round_started", agentId: "a2", round: 0, maxRounds: 4, ts: 1 });
    agentEventBus.emit({ type: "tool_start", agentId: "a2", tool: "web_search", round: 0, ts: 2 });
    agentEventBus.emit({
      type: "tool_done",
      agentId: "a2",
      tool: "web_search",
      durationMs: 300,
      ts: 3,
    });

    expect(received).toHaveLength(3);
    expect(received[0]?.type).toBe("round_started");
    expect(received[1]?.type).toBe("tool_start");
    expect(received[2]?.type).toBe("tool_done");
  });

  it("stops delivering events after off() is called", () => {
    agentEventBus.off(listener);
    agentEventBus.emit({ type: "agent_done", agentId: "a3", durationMs: 500, ts: 4 });

    expect(received).toHaveLength(0);
  });

  it("notifies multiple independent listeners", () => {
    const received2: AgentEvent[] = [];
    const listener2 = (e: AgentEvent) => received2.push(e);
    agentEventBus.on(listener2);

    agentEventBus.emit({ type: "agent_cancelled", agentId: "a4", ts: 5 });

    expect(received).toHaveLength(1);
    expect(received2).toHaveLength(1);

    agentEventBus.off(listener2);
  });

  it("delivers error events with correct shape", () => {
    agentEventBus.emit({ type: "agent_error", agentId: "a5", error: "timeout", ts: 6 });

    expect(received[0]).toMatchObject({
      type: "agent_error",
      agentId: "a5",
      error: "timeout",
    });
  });
});
