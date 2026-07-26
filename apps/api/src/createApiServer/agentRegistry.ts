import { type AgentState, agentEventBus } from "./agentEventBus";

export type AgentRecord = {
  agentId: string;
  task: string;
  model: string;
  state: AgentState;
  startedAt: number;
  currentTool?: string;
  currentRound?: number;
};

type RegistryEntry = {
  record: AgentRecord;
  abortController: AbortController;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

const registry = new Map<string, RegistryEntry>();

export const agentRegistry = {
  register(agentId: string, task: string, model: string): AbortSignal {
    const abortController = new AbortController();
    const record: AgentRecord = {
      agentId,
      task,
      model,
      state: "working",
      startedAt: Date.now(),
    };
    registry.set(agentId, { record, abortController });
    agentEventBus.emit({ type: "agent_registered", agentId, task, model, ts: Date.now() });
    agentEventBus.emit({ type: "state_changed", agentId, state: "working", ts: Date.now() });
    return abortController.signal;
  },

  setState(agentId: string, state: AgentState): void {
    const entry = registry.get(agentId);
    if (!entry) return;
    entry.record.state = state;
    agentEventBus.emit({ type: "state_changed", agentId, state, ts: Date.now() });
  },

  setTool(agentId: string, tool: string | undefined): void {
    const entry = registry.get(agentId);
    if (!entry) return;
    const { currentTool: _old, ...rest } = entry.record;
    entry.record = tool !== undefined ? { ...rest, currentTool: tool } : rest;
  },

  setRound(agentId: string, round: number): void {
    const entry = registry.get(agentId);
    if (!entry) return;
    entry.record.currentRound = round;
  },

  cancel(agentId: string): void {
    const entry = registry.get(agentId);
    if (!entry) return;
    const { state } = entry.record;
    if (state === "done" || state === "cancelled" || state === "error") return;
    entry.abortController.abort();
    entry.record.state = "cancelled";
    agentEventBus.emit({ type: "agent_cancelled", agentId, ts: Date.now() });
    agentEventBus.emit({ type: "state_changed", agentId, state: "cancelled", ts: Date.now() });
    agentRegistry.scheduleCleanup(agentId, 5_000);
  },

  scheduleCleanup(agentId: string, delayMs = 30_000): void {
    const entry = registry.get(agentId);
    if (!entry) return;
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = setTimeout(() => registry.delete(agentId), delayMs);
  },

  get(agentId: string): AgentRecord | undefined {
    return registry.get(agentId)?.record;
  },

  getAll(): AgentRecord[] {
    return [...registry.values()].map((e) => e.record);
  },
};
