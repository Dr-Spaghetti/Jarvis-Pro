export type AgentState = "working" | "blocked" | "done" | "cancelled" | "error";

export type AgentRecord = {
  agentId: string;
  task: string;
  model: string;
  state: AgentState;
  startedAt: number;
  currentTool?: string;
  currentRound?: number;
};

type AgentEvent =
  | { type: "agent_registered"; agentId: string; task: string; model: string; ts: number }
  | { type: "state_changed"; agentId: string; state: AgentState; ts: number }
  | { type: "tool_start"; agentId: string; tool: string; round: number; ts: number }
  | { type: "tool_done"; agentId: string; tool: string; durationMs: number; ts: number }
  | { type: "round_started"; agentId: string; round: number; maxRounds: number; ts: number }
  | { type: "agent_done"; agentId: string; durationMs: number; ts: number }
  | { type: "agent_cancelled"; agentId: string; ts: number }
  | { type: "agent_error"; agentId: string; error: string; ts: number };

export type { AgentEvent };

type ServerMessage =
  | { type: "snapshot"; agents: AgentRecord[] }
  | { type: "event"; event: AgentEvent };

type Listener = () => void;

const createAgentStateStore = () => {
  let agentsById = new Map<string, AgentRecord>();
  const listeners = new Set<Listener>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const applyEvent = (event: AgentEvent) => {
    switch (event.type) {
      case "agent_registered": {
        const record: AgentRecord = {
          agentId: event.agentId,
          task: event.task,
          model: event.model,
          state: "working",
          startedAt: event.ts,
        };
        agentsById = new Map(agentsById).set(event.agentId, record);
        notify();
        break;
      }
      case "state_changed": {
        const existing = agentsById.get(event.agentId);
        if (!existing) break;
        agentsById = new Map(agentsById).set(event.agentId, { ...existing, state: event.state });
        notify();
        break;
      }
      case "tool_start": {
        const existing = agentsById.get(event.agentId);
        if (!existing) break;
        agentsById = new Map(agentsById).set(event.agentId, {
          ...existing,
          currentTool: event.tool,
          currentRound: event.round,
        });
        notify();
        break;
      }
      case "tool_done": {
        const existing = agentsById.get(event.agentId);
        if (!existing) break;
        const { currentTool: _ct, ...rest } = existing;
        agentsById = new Map(agentsById).set(event.agentId, rest);
        notify();
        break;
      }
      case "round_started": {
        const existing = agentsById.get(event.agentId);
        if (!existing) break;
        agentsById = new Map(agentsById).set(event.agentId, {
          ...existing,
          currentRound: event.round,
        });
        notify();
        break;
      }
      case "agent_done":
      case "agent_cancelled":
      case "agent_error":
        // state_changed events handle the visual update; these are informational
        break;
    }
  };

  const applySnapshot = (agents: AgentRecord[]) => {
    agentsById = new Map(agents.map((a) => [a.agentId, a]));
    notify();
  };

  const applyServerMessage = (message: ServerMessage) => {
    if (message.type === "snapshot") {
      applySnapshot(message.agents);
    } else if (message.type === "event") {
      applyEvent(message.event);
    }
  };

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): Map<string, AgentRecord> {
      return agentsById;
    },
    applyServerMessage,
  };
};

export const agentStateStore = createAgentStateStore();
export type AgentStateStore = ReturnType<typeof createAgentStateStore>;
