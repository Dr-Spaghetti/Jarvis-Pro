import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { type AgentRecord, agentStateStore } from "../src/app/agentStateStore";
import { useAgentStates } from "../src/app/hooks/useAgentStates";

const makeRecord = (agentId: string): AgentRecord => ({
  agentId,
  task: "test task",
  model: "claude-haiku",
  state: "working",
  startedAt: 1000,
});

beforeEach(() => {
  agentStateStore.applyServerMessage({ type: "snapshot", agents: [] });
});

describe("useAgentStates", () => {
  it("returns an empty map initially", () => {
    const { result } = renderHook(() => useAgentStates());
    expect(result.current.size).toBe(0);
  });

  it("reflects store snapshot immediately on mount", () => {
    const record = makeRecord("a1");
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [record] });

    const { result } = renderHook(() => useAgentStates());
    expect(result.current.size).toBe(1);
    expect(result.current.get("a1")?.task).toBe("test task");
  });

  it("re-renders when the store emits a new agent", () => {
    const { result } = renderHook(() => useAgentStates());
    expect(result.current.size).toBe(0);

    act(() => {
      agentStateStore.applyServerMessage({
        type: "event",
        event: { type: "agent_registered", agentId: "a2", task: "new task", model: "m", ts: 1 },
      });
    });

    expect(result.current.size).toBe(1);
    expect(result.current.get("a2")).toBeDefined();
  });

  it("reflects state transitions when the store updates", () => {
    agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord("a3")] });
    const { result } = renderHook(() => useAgentStates());

    expect(result.current.get("a3")?.state).toBe("working");

    act(() => {
      agentStateStore.applyServerMessage({
        type: "event",
        event: { type: "state_changed", agentId: "a3", state: "done", ts: 2 },
      });
    });

    expect(result.current.get("a3")?.state).toBe("done");
  });

  it("does not update after unmount", () => {
    const { result, unmount } = renderHook(() => useAgentStates());
    unmount();

    act(() => {
      agentStateStore.applyServerMessage({ type: "snapshot", agents: [makeRecord("a4")] });
    });

    expect(result.current.size).toBe(0);
  });
});
