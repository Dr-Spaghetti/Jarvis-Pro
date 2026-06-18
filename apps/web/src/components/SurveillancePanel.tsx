import { useEffect, useRef, useState } from "react";

import type { TerminalSnapshot } from "@octogent/core";
import { apiFetch, appendAuthTokenParam } from "../runtime/apiClient";
import {
  buildTerminalEventsSocketUrl,
  buildTerminalSnapshotsUrl,
} from "../runtime/runtimeEndpoints";

type AgentCard = TerminalSnapshot & {
  toolName?: string;
};

const STATE_LABELS: Record<string, string> = {
  live: "ACTIVE",
  idle: "IDLE",
  queued: "QUEUED",
  blocked: "BLOCKED",
  stopped: "STOPPED",
  exited: "EXITED",
  stale: "STALE",
};

const formatDuration = (startedAt: string | undefined): string => {
  if (!startedAt) return "—";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "—";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

const isAgentRuntimeState = (val: unknown): val is string =>
  typeof val === "string" && val.length > 0;

type SurveillancePanelProps = {
  onSelectAgent?: (terminalId: string) => void;
};

export const SurveillancePanel = ({ onSelectAgent }: SurveillancePanelProps) => {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  // Tick every second to update duration labels
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void apiFetch(buildTerminalSnapshotsUrl(), { method: "GET" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(`Failed to load agents (${res.status})`);
          return;
        }
        const data = (await res.json()) as TerminalSnapshot[];
        if (!cancelled) {
          setAgents(Array.isArray(data) ? data : []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load agents");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // WebSocket subscription for live updates
  useEffect(() => {
    const ws = new WebSocket(appendAuthTokenParam(buildTerminalEventsSocketUrl()));
    socketRef.current = ws;

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof payload.type === "string" ? payload.type : null;
      if (!type) return;

      if (type === "terminal-created" || type === "terminal-updated") {
        const snapshot = payload.snapshot as TerminalSnapshot | undefined;
        if (!snapshot) return;
        setAgents((current) => {
          const without = current.filter((a) => a.terminalId !== snapshot.terminalId);
          const prevTool = current.find((a) => a.terminalId === snapshot.terminalId)?.toolName;
          const card: AgentCard = { ...snapshot };
          if (prevTool !== undefined) card.toolName = prevTool;
          return [...without, card];
        });
        return;
      }

      if (type === "terminal-state-changed") {
        const terminalId = typeof payload.terminalId === "string" ? payload.terminalId : null;
        if (!terminalId) return;
        const newTool = typeof payload.toolName === "string" ? payload.toolName : undefined;
        const runtimeState = isAgentRuntimeState(payload.agentRuntimeState)
          ? (payload.agentRuntimeState as AgentCard["agentRuntimeState"])
          : undefined;
        setAgents((current) =>
          current.map((a): AgentCard => {
            if (a.terminalId !== terminalId) return a;
            const stripped: Omit<AgentCard, "toolName"> & { toolName?: string } = { ...a };
            if (runtimeState !== undefined) stripped.agentRuntimeState = runtimeState;
            if (newTool !== undefined) stripped.toolName = newTool;
            return stripped as AgentCard;
          }),
        );
        return;
      }

      if (type === "terminal-deleted") {
        const terminalId = typeof payload.terminalId === "string" ? payload.terminalId : null;
        if (!terminalId) return;
        setAgents((current) => current.filter((a) => a.terminalId !== terminalId));
        return;
      }

      if (type === "terminal-list-changed") {
        void apiFetch(buildTerminalSnapshotsUrl(), { method: "GET" })
          .then(async (res) => {
            if (!res.ok) return;
            const data = (await res.json()) as TerminalSnapshot[];
            if (Array.isArray(data)) setAgents(data);
          })
          .catch(() => {});
      }
    });

    ws.addEventListener("error", () => {
      // Silent reconnect will be handled by the server; don't surface WS errors as UI errors
    });

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, []);

  if (isLoading) {
    return (
      <section className="surveillance-panel" aria-label="Surveillance room">
        <p className="surveillance-loading">Loading agents...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="surveillance-panel" aria-label="Surveillance room">
        <p className="surveillance-error">{error}</p>
      </section>
    );
  }

  const active = agents.filter((a) => a.lifecycleState === "running");
  const inactive = agents.filter((a) => a.lifecycleState !== "running");

  if (agents.length === 0) {
    return (
      <section className="surveillance-panel" aria-label="Surveillance room">
        <div className="surveillance-empty">
          <span className="surveillance-empty-icon">📡</span>
          <p>No agents running — deploy one from the Arsenal above.</p>
        </div>
      </section>
    );
  }

  const renderCard = (agent: AgentCard) => (
    <div key={agent.terminalId} className="surveillance-card-wrapper">
      <button
        type="button"
        className="surveillance-card"
        data-state={agent.state}
        data-lifecycle={agent.lifecycleState ?? "registered"}
        onClick={() => onSelectAgent?.(agent.terminalId)}
        aria-label={`Open agent ${agent.tentacleName ?? agent.terminalId}`}
      >
        <header className="surveillance-card-header">
          <span className="surveillance-card-name">{agent.tentacleName ?? agent.terminalId}</span>
          <span className="surveillance-state-badge" data-state={agent.state}>
            {STATE_LABELS[agent.state] ?? agent.state.toUpperCase()}
          </span>
        </header>

        <div className="surveillance-card-meta">
          {agent.toolName && (
            <span className="surveillance-tool-badge" title="Current tool">
              🔧 {agent.toolName}
            </span>
          )}
          {agent.agentRuntimeState && (
            <span className="surveillance-runtime-state">{agent.agentRuntimeState}</span>
          )}
          <span className="surveillance-duration">
            {/* tick is used to force a re-render so duration stays live */}
            {tick > -1 && formatDuration(agent.startedAt)}
          </span>
        </div>

        {agent.recentOutput && (
          <pre className="surveillance-output" aria-label="Recent output">
            {agent.recentOutput}
          </pre>
        )}
      </button>
    </div>
  );

  return (
    <section className="surveillance-panel" aria-label="Surveillance room">
      {active.length > 0 && (
        <div className="surveillance-group">
          <h3 className="surveillance-group-title">
            Active <span className="surveillance-count">{active.length}</span>
          </h3>
          <div className="surveillance-grid">{active.map(renderCard)}</div>
        </div>
      )}
      {inactive.length > 0 && (
        <div className="surveillance-group surveillance-group--inactive">
          <h3 className="surveillance-group-title">
            Inactive <span className="surveillance-count">{inactive.length}</span>
          </h3>
          <div className="surveillance-grid">{inactive.map(renderCard)}</div>
        </div>
      )}
    </section>
  );
};
