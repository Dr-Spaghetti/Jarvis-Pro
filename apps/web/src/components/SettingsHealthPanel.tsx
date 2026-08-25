import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import { buildBrainHealthUrl } from "../runtime/runtimeEndpoints";
import { PanelState } from "./ui/PanelState";

type HealthItem = {
  id: string;
  title: string;
  status: "ok" | "not-configured" | "error";
  detail: string;
};

const STATUS_LABEL: Record<HealthItem["status"], string> = {
  ok: "Connected",
  "not-configured": "Not configured",
  error: "Error",
};

export const SettingsHealthPanel = () => {
  const [items, setItems] = useState<HealthItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(buildBrainHealthUrl());
      if (!res.ok) {
        setError("Could not load assistant health.");
        return;
      }
      const data = (await res.json()) as { items?: HealthItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError("Network error loading assistant health.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="settings-panel" aria-label="Assistant health">
      <header className="settings-panel-header">
        <h2>Assistant health</h2>
        <p>What Jarvis can see and do right now. Values of secrets are never shown.</p>
      </header>
      {loading && <PanelState state="loading" message="Checking integrations…" />}
      {!loading && error && (
        <PanelState state="error" message={error} onRetry={() => void load()} />
      )}
      {!loading && !error && (
        <ul className="settings-health-list">
          {items.map((item) => (
            <li key={item.id} className="settings-health-item" data-status={item.status}>
              <div className="settings-health-row">
                <span className="settings-health-title">{item.title}</span>
                <span className="settings-health-status">{STATUS_LABEL[item.status]}</span>
              </div>
              <p className="settings-health-detail">{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
