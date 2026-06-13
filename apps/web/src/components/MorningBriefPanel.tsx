import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import { buildBriefConfigUrl } from "../runtime/runtimeEndpoints";
import { PanelState } from "./ui/PanelState";
import { SettingsToggle } from "./ui/SettingsToggle";
import { useToasts } from "./ui/ToastProvider";

type BriefConfig = {
  enabled: boolean;
  time: string;
  lastBriefDate: string | null;
  lastBriefAt: string | null;
};

const formatLastBrief = (config: BriefConfig): string => {
  if (!config.lastBriefAt) {
    return "never";
  }
  const parsed = new Date(config.lastBriefAt);
  if (Number.isNaN(parsed.getTime())) {
    return config.lastBriefDate ?? "unknown";
  }
  return parsed.toLocaleString();
};

export const MorningBriefPanel = () => {
  const { showToast } = useToasts();
  const [config, setConfig] = useState<BriefConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch(buildBriefConfigUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setError("Failed to load morning brief settings.");
        return;
      }
      setConfig((await response.json()) as BriefConfig);
    } catch {
      setError("Network error loading morning brief settings.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const patchConfig = async (patch: Partial<Pick<BriefConfig, "enabled" | "time">>) => {
    setIsSaving(true);
    try {
      const response = await apiFetch(buildBriefConfigUrl(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        showToast("Could not save morning brief settings.", "error");
        return;
      }
      setConfig((await response.json()) as BriefConfig);
      showToast("Morning brief settings saved.", "ok");
    } catch {
      showToast("Network error saving morning brief settings.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="settings-panel" aria-label="Morning brief settings">
      <header className="settings-panel-header">
        <h2>Morning brief</h2>
        <p>
          Write a "Daily Brief" note (open tasks, recent notes, activity) into your vault each
          morning. This is a deterministic digest — it never spawns a Claude agent, so it costs
          nothing to run.
        </p>
      </header>

      {isLoading && <PanelState state="loading" message="Loading morning brief settings…" />}

      {!isLoading && error && (
        <PanelState state="error" message={error} onRetry={() => void fetchConfig()} />
      )}

      {!isLoading && !error && config && (
        <>
          <div className="settings-toggle-grid">
            <SettingsToggle
              label="Daily brief"
              description="Write the brief automatically at the time below"
              ariaLabel="Enable daily morning brief"
              checked={config.enabled}
              onChange={(checked) => void patchConfig({ enabled: checked })}
            />
          </div>
          <div className="settings-brief-row">
            <label className="settings-brief-time-label" htmlFor="brief-time">
              Brief time
            </label>
            <input
              className="settings-brief-time"
              disabled={isSaving}
              id="brief-time"
              onChange={(event) => void patchConfig({ time: event.target.value })}
              type="time"
              value={config.time}
            />
          </div>
          <p className="settings-brief-status" aria-live="polite">
            {`Last brief: ${formatLastBrief(config)} · Next: ${
              config.enabled ? `${config.time} daily` : "disabled"
            }`}
          </p>
        </>
      )}
    </section>
  );
};
