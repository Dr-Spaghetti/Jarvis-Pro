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

const MAX_SCREENS = 6;

export const SurveillancePanel = ({ onSelectAgent }: SurveillancePanelProps) => {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected">("connected");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);

  // Tick every second to update duration labels
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll every 3s for fresh output when a detail panel is open
  useEffect(() => {
    if (!selectedAgentId) return;
    const interval = setInterval(() => {
      void apiFetch(buildTerminalSnapshotsUrl(), { method: "GET" })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as TerminalSnapshot[];
          if (Array.isArray(data)) setAgents(data);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedAgentId]);

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

  // WebSocket subscription for live updates with exponential backoff reconnect
  useEffect(() => {
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;
      const ws = new WebSocket(appendAuthTokenParam(buildTerminalEventsSocketUrl()));
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        if (destroyed) return;
        setWsStatus("connected");
        reconnectDelayRef.current = 1000;
      });

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

      const scheduleReconnect = () => {
        if (destroyed) return;
        setWsStatus("disconnected");
        socketRef.current = null;
        const delay = Math.min(reconnectDelayRef.current, 30000);
        reconnectDelayRef.current = delay * 2;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.addEventListener("error", scheduleReconnect);
      ws.addEventListener("close", scheduleReconnect);
    };

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const active = agents.filter((a) => a.lifecycleState === "running");
  const history = agents.filter((a) => a.lifecycleState !== "running");
  const selectedAgent = selectedAgentId ? (agents.find((a) => a.terminalId === selectedAgentId) ?? null) : null;

  // Screens = active agents first, then empty slots up to MAX_SCREENS (or more if needed)
  const screenCount = Math.max(MAX_SCREENS, active.length);
  const emptySlotCount = screenCount - active.length;

  if (isLoading) {
    return (
      <section className="surveillance-panel" aria-label="Surveillance room">
        <div className="surv-room">
          <div className="surv-room-grid">
            {Array.from({ length: MAX_SCREENS }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder slots
              <div key={i} className="surv-screen surv-screen--empty">
                <div className="surv-corner tl" />
                <div className="surv-corner tr" />
                <div className="surv-corner bl" />
                <div className="surv-corner br" />
                <div className="surv-screen-num">SCREEN {String(i + 1).padStart(2, "0")}</div>
                <div className="surv-screen-idle">INIT</div>
              </div>
            ))}
          </div>
          <div className="surv-room-status">SURVEILLANCE ROOM · INITIALIZING</div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="surveillance-panel" aria-label="Surveillance room">
        <div className="surv-room">
          <div className="surv-room-status surv-room-status--error">{error}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="surveillance-panel" aria-label="Surveillance room">
      <div className="surv-room">
        <div className="surv-room-grid">
          {/* Active agent screens */}
          {active.map((agent) => (
            <button
              key={agent.terminalId}
              type="button"
              className={`surv-screen surv-screen--active${selectedAgentId === agent.terminalId ? " surv-screen--selected" : ""}`}
              onClick={() => {
                setSelectedAgentId((prev) => prev === agent.terminalId ? null : agent.terminalId);
                onSelectAgent?.(agent.terminalId);
              }}
              aria-label={`Open agent ${agent.tentacleName ?? agent.terminalId}`}
            >
              <div className="surv-screen-hd">
                <div className="surv-screen-dot surv-screen-dot--on" />
                <div className="surv-screen-name">{agent.tentacleName ?? agent.terminalId}</div>
                <div className="surv-screen-state">
                  {STATE_LABELS[agent.state] ?? agent.state.toUpperCase()}
                </div>
              </div>
              <div className="surv-screen-feed">
                {agent.toolName && <div className="surv-action">&gt; {agent.toolName}</div>}
                {agent.agentRuntimeState && (
                  <div className="surv-thought">{agent.agentRuntimeState}</div>
                )}
                {agent.recentOutput && <pre className="surv-output">{agent.recentOutput}</pre>}
              </div>
              <div className="surv-screen-foot">
                <span>{agent.state}</span>
                {/* tick reference keeps duration labels live */}
                <span>{tick > -1 && formatDuration(agent.startedAt)}</span>
              </div>
            </button>
          ))}

          {/* Empty screen slots */}
          {Array.from({ length: emptySlotCount }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder slots
            <div key={`slot-${i}`} className="surv-screen surv-screen--empty">
              <div className="surv-corner tl" />
              <div className="surv-corner tr" />
              <div className="surv-corner bl" />
              <div className="surv-corner br" />
              <div className="surv-screen-num">
                SCREEN {String(active.length + i + 1).padStart(2, "0")}
              </div>
              <div className="surv-screen-idle">NO FEED</div>
            </div>
          ))}
        </div>

        <div className="surv-room-status">
          {active.length === 0
            ? "SURVEILLANCE ROOM · ALL CLEAR · 0 AGENTS ACTIVE"
            : `SURVEILLANCE ROOM · ${active.length} AGENT${active.length !== 1 ? "S" : ""} ACTIVE`}
          {wsStatus === "disconnected" && (
            <span className="surv-ws-badge">● DISCONNECTED</span>
          )}
        </div>

        {history.length > 0 && (
          <div className="surv-history">
            <div className="surv-history-title">SESSION HISTORY</div>
            <div className="surv-history-list">
              {history.map((agent) => (
                <button
                  key={agent.terminalId}
                  type="button"
                  className={`surv-history-item${selectedAgentId === agent.terminalId ? " surv-history-item--selected" : ""}`}
                  onClick={() => {
                    setSelectedAgentId((prev) => prev === agent.terminalId ? null : agent.terminalId);
                    onSelectAgent?.(agent.terminalId);
                  }}
                  aria-label={`Open session ${agent.tentacleName ?? agent.terminalId}`}
                >
                  <span className="surv-history-name">
                    {agent.tentacleName ?? agent.terminalId}
                  </span>
                  <span className="surv-history-state">
                    {STATE_LABELS[agent.state] ?? agent.state.toUpperCase()}
                  </span>
                  <span className="surv-history-dur">
                    {tick > -1 && formatDuration(agent.startedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {selectedAgent && (
          <div
            className="surv-detail"
            role="dialog"
            aria-label={`Agent output: ${selectedAgent.tentacleName ?? selectedAgent.terminalId}`}
          >
            <div className="surv-detail-header">
              <div className="surv-detail-header-left">
                <div
                  className={`surv-screen-dot surv-screen-dot--${selectedAgent.lifecycleState === "running" ? "on" : "off"}`}
                />
                <span className="surv-detail-name">
                  {selectedAgent.tentacleName ?? selectedAgent.terminalId}
                </span>
                <span className="surv-detail-state">
                  {STATE_LABELS[selectedAgent.state] ?? selectedAgent.state.toUpperCase()}
                </span>
                <span className="surv-detail-dur">
                  {tick > -1 && formatDuration(selectedAgent.startedAt)}
                </span>
              </div>
              <button
                type="button"
                className="surv-detail-close"
                onClick={() => setSelectedAgentId(null)}
              >
                ✕ CLOSE
              </button>
            </div>

            {(selectedAgent.toolName || selectedAgent.agentRuntimeState) && (
              <div className="surv-detail-meta">
                {selectedAgent.toolName && (
                  <span className="surv-detail-tool">&gt; {selectedAgent.toolName}</span>
                )}
                {selectedAgent.agentRuntimeState && (
                  <span className="surv-detail-thought">{selectedAgent.agentRuntimeState}</span>
                )}
              </div>
            )}

            <div className="surv-detail-output-wrap">
              <pre className="surv-detail-output">
                {selectedAgent.recentOutput ?? "No output captured yet."}
              </pre>
            </div>

            <div className="surv-detail-footer">
              <span>LIVE OUTPUT · REFRESH 3s</span>
              <span>{selectedAgent.lifecycleState?.toUpperCase() ?? ""}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
