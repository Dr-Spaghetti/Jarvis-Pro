import { useCallback, useEffect, useState } from "react";

import { formatRelativeTime } from "../../app/formatRelativeTime";
import { apiFetch } from "../../runtime/apiClient";
import { buildDeckTentaclesUrl, buildTokenTelemetryUrl } from "../../runtime/runtimeEndpoints";
import { PanelState } from "../ui/PanelState";

type SessionTokenTelemetry = {
  sessionId: string;
  terminalId: string;
  tentacleId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  messageCount: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
};

type TelemetryResponse = { sessions: SessionTokenTelemetry[] };

type TentacleSummary = {
  tentacleId: string;
  displayName: string;
  status: string;
};

type AgentAnalyticsRow = {
  tentacleId: string;
  displayName: string;
  status: string | null;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  lastRecordedAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  active: "Active",
  blocked: "Blocked",
  "needs-review": "Needs review",
};

const formatTokens = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(value);
};

// Group raw per-session telemetry into per-agent rows, joining display names
// from the deck. Exported for unit testing.
export const deriveAgentAnalytics = (
  sessions: SessionTokenTelemetry[],
  tentacles: TentacleSummary[],
): AgentAnalyticsRow[] => {
  const nameById = new Map<string, TentacleSummary>();
  for (const tentacle of tentacles) {
    nameById.set(tentacle.tentacleId, tentacle);
  }

  const byTentacle = new Map<string, AgentAnalyticsRow>();
  for (const session of sessions) {
    const cacheTokens = session.cacheCreationTokens + session.cacheReadTokens;
    const existing = byTentacle.get(session.tentacleId);
    if (existing) {
      existing.sessionCount += 1;
      existing.inputTokens += session.inputTokens;
      existing.outputTokens += session.outputTokens;
      existing.cacheTokens += cacheTokens;
      existing.totalTokens += session.inputTokens + session.outputTokens + cacheTokens;
      if (session.lastRecordedAt > existing.lastRecordedAt) {
        existing.lastRecordedAt = session.lastRecordedAt;
      }
    } else {
      const tentacle = nameById.get(session.tentacleId);
      byTentacle.set(session.tentacleId, {
        tentacleId: session.tentacleId,
        displayName: tentacle?.displayName ?? session.tentacleId,
        status: tentacle?.status ?? null,
        sessionCount: 1,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheTokens,
        totalTokens: session.inputTokens + session.outputTokens + cacheTokens,
        lastRecordedAt: session.lastRecordedAt,
      });
    }
  }

  return [...byTentacle.values()].sort((a, b) => b.lastRecordedAt.localeCompare(a.lastRecordedAt));
};

export const AgentAnalyticsPanel = () => {
  const [rows, setRows] = useState<AgentAnalyticsRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const telemetryResponse = await apiFetch(buildTokenTelemetryUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!telemetryResponse.ok) {
        setError("Failed to load agent analytics.");
        return;
      }
      const telemetry = (await telemetryResponse.json()) as TelemetryResponse;

      // Name enrichment is best-effort — telemetry still renders (with raw
      // tentacle ids) if the deck list can't be loaded.
      let tentacles: TentacleSummary[] = [];
      try {
        const deckResponse = await apiFetch(buildDeckTentaclesUrl(), {
          headers: { Accept: "application/json" },
        });
        if (deckResponse.ok) {
          const parsed = (await deckResponse.json()) as TentacleSummary[];
          if (Array.isArray(parsed)) {
            tentacles = parsed;
          }
        }
      } catch {
        // Ignore — fall back to tentacle ids as names.
      }

      setRows(deriveAgentAnalytics(telemetry.sessions, tentacles));
      setNow(Date.now());
    } catch {
      setError("Network error loading agent analytics.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <section className="agent-analytics" aria-label="Agent token analytics">
      <header className="agent-analytics-header">
        <h2 className="agent-analytics-title">Agent Analytics</h2>
        <button
          aria-label="Refresh agent analytics"
          className="agent-analytics-refresh"
          onClick={() => void fetchAnalytics()}
          type="button"
        >
          ↻
        </button>
      </header>

      {isLoading && <PanelState state="loading" message="Loading agent analytics…" />}

      {!isLoading && error && (
        <PanelState state="error" message={error} onRetry={() => void fetchAnalytics()} />
      )}

      {!isLoading && !error && rows.length === 0 && (
        <PanelState
          state="empty"
          message="Telemetry starts collecting from now — run an agent to see token usage here."
        />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <table className="agent-analytics-table">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Sessions</th>
              <th scope="col">Input</th>
              <th scope="col">Output</th>
              <th scope="col">Total</th>
              <th scope="col">Last run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tentacleId} className="agent-analytics-row">
                <td className="agent-analytics-name">
                  {row.status && (
                    <span
                      className={`agent-analytics-dot agent-analytics-dot--${row.status}`}
                      aria-hidden="true"
                    />
                  )}
                  <span>{row.displayName}</span>
                  {row.status && (
                    <span className="agent-analytics-status">
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  )}
                </td>
                <td>{row.sessionCount}</td>
                <td title={`${row.inputTokens.toLocaleString()} input tokens`}>
                  {formatTokens(row.inputTokens)}
                </td>
                <td title={`${row.outputTokens.toLocaleString()} output tokens`}>
                  {formatTokens(row.outputTokens)}
                </td>
                <td
                  className="agent-analytics-total"
                  title={`${row.totalTokens.toLocaleString()} total tokens (incl. ${row.cacheTokens.toLocaleString()} cache)`}
                >
                  {formatTokens(row.totalTokens)}
                </td>
                <td>
                  <time dateTime={row.lastRecordedAt}>
                    {formatRelativeTime(row.lastRecordedAt, now)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
