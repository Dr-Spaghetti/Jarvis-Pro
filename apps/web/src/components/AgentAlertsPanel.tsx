import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, appendAuthTokenParam } from "../runtime/apiClient";
import {
  buildAgentAlertConfigUrl,
  buildAgentAlertsUrl,
  buildMonitorExportUrl,
} from "../runtime/runtimeEndpoints";
import { PanelState } from "./ui/PanelState";
import { useToasts } from "./ui/ToastProvider";

type AgentAlert = {
  id: string;
  type: string;
  severity: string;
  terminalId: string;
  tentacleId: string;
  label: string;
  message: string;
  since: string;
};

type AgentAlertConfig = { agentStuckMinutes: number | null };

type AlertsResponse = { config: AgentAlertConfig; alerts: AgentAlert[] };

const POLL_INTERVAL_MS = 30_000;

const STUCK_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: "Off" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
];

export const AgentAlertsPanel = () => {
  const { showToast } = useToasts();
  const [config, setConfig] = useState<AgentAlertConfig>({ agentStuckMinutes: null });
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Track alert ids already toasted so re-polls don't re-toast the same alert.
  const toastedIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedOnceRef = useRef(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await apiFetch(buildAgentAlertsUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setError("Failed to load alerts.");
        return;
      }
      const data = (await response.json()) as AlertsResponse;
      setConfig(data.config);
      setAlerts(data.alerts);
      setError(null);

      // Toast only alerts we haven't seen before, and not on the very first
      // load (so opening the tab doesn't replay a backlog of toasts).
      const nextIds = new Set(data.alerts.map((alert) => alert.id));
      if (hasLoadedOnceRef.current) {
        for (const alert of data.alerts) {
          if (!toastedIdsRef.current.has(alert.id)) {
            showToast(alert.message, "error");
          }
        }
      }
      toastedIdsRef.current = nextIds;
      hasLoadedOnceRef.current = true;
    } catch {
      setError("Network error loading alerts.");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void fetchAlerts();
    const timer = setInterval(() => void fetchAlerts(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchAlerts]);

  const updateStuckMinutes = async (value: number | null) => {
    setIsSaving(true);
    try {
      const response = await apiFetch(buildAgentAlertConfigUrl(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentStuckMinutes: value }),
      });
      if (!response.ok) {
        showToast("Could not save alert settings.", "error");
        return;
      }
      const saved = (await response.json()) as AgentAlertConfig;
      setConfig(saved);
      showToast("Alert settings saved.", "ok");
      void fetchAlerts();
    } catch {
      showToast("Network error saving alert settings.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="monitor-alerts" aria-label="Agent alerts">
      <section className="monitor-panel" aria-label="Alert rules">
        <h3>Alert rules</h3>
        <div className="monitor-alert-rule">
          <p className="monitor-section-label" id="alert-stuck-label">
            Notify when an agent waits for input longer than
          </p>
          <div className="monitor-timeframe-picker" aria-labelledby="alert-stuck-label">
            {STUCK_OPTIONS.map((option) => (
              <button
                aria-pressed={config.agentStuckMinutes === option.value}
                className="monitor-timeframe-option"
                data-active={config.agentStuckMinutes === option.value ? "true" : "false"}
                disabled={isSaving}
                key={option.label}
                onClick={() => void updateStuckMinutes(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="monitor-panel" aria-label="Active alerts">
        <header className="monitor-alerts-header">
          <h3>Active alerts</h3>
          <div className="monitor-alerts-actions">
            <a
              className="monitor-alerts-export"
              download="octogent-alerts.json"
              href={appendAuthTokenParam(buildMonitorExportUrl("json"))}
            >
              ↓ JSON
            </a>
            <a
              className="monitor-alerts-export"
              download="octogent-alerts.md"
              href={appendAuthTokenParam(buildMonitorExportUrl("md"))}
            >
              ↓ MD
            </a>
            <button
              aria-label="Refresh alerts"
              className="agent-analytics-refresh"
              onClick={() => void fetchAlerts()}
              type="button"
            >
              ↻
            </button>
          </div>
        </header>

        {isLoading && <PanelState state="loading" message="Loading alerts…" />}

        {!isLoading && error && (
          <PanelState state="error" message={error} onRetry={() => void fetchAlerts()} />
        )}

        {!isLoading && !error && alerts.length === 0 && (
          <PanelState
            state="empty"
            message={
              config.agentStuckMinutes === null
                ? "No alert rules enabled. Turn on a rule above to start monitoring."
                : "All clear — no agents are stuck right now."
            }
          />
        )}

        {!isLoading && !error && alerts.length > 0 && (
          <ul className="monitor-alerts-list" aria-label="Active alert list">
            {alerts.map((alert) => (
              <li className="monitor-alert" data-severity={alert.severity} key={alert.id}>
                <span className="monitor-alert-dot" aria-hidden="true" />
                <span className="monitor-alert-message">{alert.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};
