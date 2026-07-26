import { EventEmitter } from "node:events";

export type AgentState = "working" | "blocked" | "done" | "cancelled" | "error";

export type AgentEvent =
  | { type: "agent_registered"; agentId: string; task: string; model: string; ts: number }
  | { type: "state_changed"; agentId: string; state: AgentState; ts: number }
  | { type: "tool_start"; agentId: string; tool: string; round: number; ts: number }
  | { type: "tool_done"; agentId: string; tool: string; durationMs: number; ts: number }
  | { type: "round_started"; agentId: string; round: number; maxRounds: number; ts: number }
  | { type: "agent_done"; agentId: string; durationMs: number; ts: number }
  | { type: "agent_cancelled"; agentId: string; ts: number }
  | { type: "agent_error"; agentId: string; error: string; ts: number };

const bus = new EventEmitter();
bus.setMaxListeners(50);

export const agentEventBus = {
  emit(event: AgentEvent): void {
    bus.emit("event", event);
  },
  on(listener: (event: AgentEvent) => void): void {
    bus.on("event", listener);
  },
  off(listener: (event: AgentEvent) => void): void {
    bus.off("event", listener);
  },
};
