import { useState } from "react";

import { AgentAlertsPanel } from "./AgentAlertsPanel";
import { SurveillancePanel } from "./SurveillancePanel";

type MonitorSubtabId = "surveillance" | "alerts";

const MONITOR_SUBTABS: Array<{ id: MonitorSubtabId; label: string }> = [
  { id: "surveillance", label: "Surveillance" },
  { id: "alerts", label: "Alerts" },
];

// monitorRuntime kept as an optional prop so callers don't need to change their types
type MonitorPrimaryViewProps = {
  monitorRuntime?: unknown;
  onNavigateToDeck?: (terminalId: string) => void;
};

export const MonitorPrimaryView = ({ onNavigateToDeck }: MonitorPrimaryViewProps) => {
  const [activeSubtab, setActiveSubtab] = useState<MonitorSubtabId>("surveillance");

  return (
    <section className="monitor-view" aria-label="Monitor primary view">
      <header className="monitor-header">
        <div className="monitor-header-top">
          <div className="monitor-header-main">
            <nav className="monitor-subtabs" aria-label="Monitor subtabs">
              {MONITOR_SUBTABS.map((subtab) => (
                <button
                  key={subtab.id}
                  aria-current={activeSubtab === subtab.id ? "page" : undefined}
                  className="monitor-subtab"
                  data-active={activeSubtab === subtab.id ? "true" : "false"}
                  onClick={() => setActiveSubtab(subtab.id)}
                  type="button"
                >
                  {subtab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {activeSubtab === "surveillance" && (
        <SurveillancePanel onSelectAgent={(terminalId) => onNavigateToDeck?.(terminalId)} />
      )}

      {activeSubtab === "alerts" && <AgentAlertsPanel />}
    </section>
  );
};
