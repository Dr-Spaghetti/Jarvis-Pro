import { useEffect, useState } from "react";

import type { AgentRecord, AgentState } from "../app/agentStateStore";
import { cancelAgent } from "../app/agentWebSocketClient";
import { useAgentStates } from "../app/hooks/useAgentStates";

const STATE_LABELS: Record<AgentState, string> = {
  working: "WORKING",
  blocked: "BLOCKED",
  done: "DONE",
  cancelled: "CANCELLED",
  error: "ERROR",
};

const STATE_COLORS: Record<AgentState, string> = {
  working: "var(--nc-green, #39ff14)",
  blocked: "#ffb400",
  done: "rgba(57,255,20,0.4)",
  cancelled: "#ff4444",
  error: "#ff4444",
};

const TERMINAL_STATES: AgentState[] = ["done", "cancelled", "error"];

const useElapsed = (startedAt: number): string => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const s = Math.floor(elapsed / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const AgentCard = ({ record }: { record: AgentRecord }) => {
  const elapsed = useElapsed(record.startedAt);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (TERMINAL_STATES.includes(record.state)) {
      const id = setTimeout(() => setFading(true), 4_500);
      return () => clearTimeout(id);
    }
    setFading(false);
  }, [record.state]);

  const isTerminal = TERMINAL_STATES.includes(record.state);
  const canCancel = record.state === "working" || record.state === "blocked";

  return (
    <div
      className="agent-live-card"
      style={{
        opacity: fading ? 0 : 1,
        transition: fading ? "opacity 0.5s ease" : "none",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "8px 10px",
        background: "rgba(0,0,0,0.4)",
        border: "1px solid rgba(57,255,20,0.15)",
        borderRadius: "3px",
        fontFamily: "var(--font-display, monospace)",
        fontSize: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <span
          style={{
            color: STATE_COLORS[record.state],
            fontWeight: 700,
            letterSpacing: "0.12em",
            animation:
              record.state === "working" ? "agent-pulse 1.5s ease-in-out infinite" : "none",
          }}
        >
          ● {STATE_LABELS[record.state]}
        </span>
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "9px" }}>{elapsed}</span>
        {canCancel && (
          <button
            type="button"
            aria-label="Cancel agent"
            onClick={() => cancelAgent(record.agentId)}
            style={{
              background: "rgba(255,68,68,0.15)",
              border: "1px solid rgba(255,68,68,0.4)",
              borderRadius: "2px",
              color: "#ff4444",
              cursor: "pointer",
              fontSize: "9px",
              lineHeight: 1,
              padding: "2px 5px",
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div
        style={{
          color: "rgba(255,255,255,0.6)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
        title={record.task}
      >
        {record.task.slice(0, 80)}
      </div>

      {!isTerminal && (
        <div
          style={{
            display: "flex",
            gap: "10px",
            color: "rgba(255,255,255,0.35)",
            fontSize: "9px",
            letterSpacing: "0.08em",
          }}
        >
          {record.currentTool && <span style={{ color: "#ffb400" }}>⚙ {record.currentTool}</span>}
          {record.currentRound !== undefined && <span>round {record.currentRound + 1}/4</span>}
          <span style={{ color: "rgba(255,255,255,0.2)" }}>
            {record.model.split("-").slice(1, 3).join("-")}
          </span>
        </div>
      )}
    </div>
  );
};

export const AgentLivePanel = () => {
  const agents = useAgentStates();

  if (agents.size === 0) return null;

  return (
    <section
      aria-label="Live agent activity"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        marginTop: "12px",
        padding: "10px",
        borderTop: "1px solid rgba(57,255,20,0.1)",
      }}
    >
      <div
        style={{
          fontSize: "9px",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(57,255,20,0.5)",
          marginBottom: "2px",
        }}
      >
        ● Live Agents
      </div>
      {[...agents.values()].map((record) => (
        <AgentCard key={record.agentId} record={record} />
      ))}
      <style>{`
        @keyframes agent-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </section>
  );
};
