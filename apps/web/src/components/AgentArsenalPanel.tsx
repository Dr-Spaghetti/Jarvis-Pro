import { useEffect, useState } from "react";

import type { DeckTentacleSummary, WorkspaceSetupSnapshot } from "@octogent/core";
import { apiFetch } from "../runtime/apiClient";
import {
  buildAgentLoopUrl,
  buildArsenalUrl,
  buildDeckTentaclePinnedUrl,
  buildDeckTentaclesUrl,
  buildDeployAgentUrl,
  buildWorkspaceSetupUrl,
} from "../runtime/runtimeEndpoints";
import { WorkspaceSetupCard } from "./WorkspaceSetupCard";
import { useToasts } from "./ui/ToastProvider";

type AgentArchetypeCard = {
  id: string;
  name: string;
  role: string;
  icon: string;
  category: string;
  skills: string[];
};

type CategoryFilter = "all" | "technical" | "strategy" | "creative" | "analysis" | "operations";

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: "All",
  technical: "Technical",
  strategy: "Strategy",
  creative: "Creative",
  analysis: "Analysis",
  operations: "Operations",
};

const CATEGORY_FILTERS: CategoryFilter[] = [
  "all",
  "technical",
  "strategy",
  "creative",
  "analysis",
  "operations",
];

type DeployState = {
  archetypeId: string;
  task: string;
  isDeploying: boolean;
  error?: string;
};

type LoopState = {
  archetypeId: string;
  task: string;
  isRunning: boolean;
  error?: string;
};

type AgentArsenalPanelProps = {
  onDeployed?: (terminalId: string, archetypeId: string) => void;
};

export const AgentArsenalPanel = ({ onDeployed }: AgentArsenalPanelProps) => {
  const { showToast } = useToasts();
  const [archetypes, setArchetypes] = useState<AgentArchetypeCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(() => {
    const saved = localStorage.getItem("arsenal-category-filter");
    return (saved as CategoryFilter | null) ?? "all";
  });
  const [deployState, setDeployState] = useState<DeployState | null>(null);
  const [loopState, setLoopState] = useState<LoopState | null>(null);
  const [setup, setSetup] = useState<WorkspaceSetupSnapshot | null>(null);
  const [tentacles, setTentacles] = useState<DeckTentacleSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    void apiFetch(buildArsenalUrl(), { method: "GET" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(`Failed to load agents (${res.status})`);
          return;
        }
        const data = (await res.json()) as AgentArchetypeCard[];
        if (!cancelled) {
          setArchetypes(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load agents");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void apiFetch(buildWorkspaceSetupUrl(), { method: "GET" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as WorkspaceSetupSnapshot;
        setSetup(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void apiFetch(buildDeckTentaclesUrl(), { method: "GET" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as DeckTentacleSummary[];
        setTentacles(data);
      })
      .catch(() => {});
  }, []);

  const handlePinToggle = async (tentacle: DeckTentacleSummary) => {
    try {
      const res = await apiFetch(buildDeckTentaclePinnedUrl(tentacle.tentacleId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !tentacle.pinned }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as DeckTentacleSummary;
      setTentacles((prev) => prev.map((t) => (t.tentacleId === updated.tentacleId ? updated : t)));
    } catch {
      // pin toggle failed silently
    }
  };

  const handleCategoryFilter = (cat: CategoryFilter) => {
    setCategoryFilter(cat);
    localStorage.setItem("arsenal-category-filter", cat);
  };

  const filtered =
    categoryFilter === "all" ? archetypes : archetypes.filter((a) => a.category === categoryFilter);

  const handleDeployClick = (archetypeId: string) => {
    setDeployState({ archetypeId, task: "", isDeploying: false });
  };

  const handleCancelDeploy = () => {
    setDeployState(null);
  };

  const handleLoopClick = (archetypeId: string) => {
    setDeployState(null);
    setLoopState({ archetypeId, task: "", isRunning: false });
  };

  const handleCancelLoop = () => {
    setLoopState(null);
  };

  const handleRunLoop = async () => {
    if (!loopState) return;
    const archetype = archetypes.find((a) => a.id === loopState.archetypeId);
    if (!archetype) return;

    setLoopState((prev) => prev && { ...prev, isRunning: true });

    try {
      const res = await apiFetch(buildAgentLoopUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archetypeId: loopState.archetypeId,
          taskDescription: loopState.task || `Run ${archetype.name} agent loop`,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = body.error ?? `Loop failed (${res.status})`;
        showToast(msg, "error");
        setLoopState((prev) => prev && { ...prev, isRunning: false, error: msg });
        return;
      }

      const result = (await res.json()) as { succeeded?: boolean; metrics?: { totalIterations?: number; finalQuality?: number } };
      const iters = result.metrics?.totalIterations ?? "?";
      const quality = result.metrics?.finalQuality != null ? `${Math.round(result.metrics.finalQuality * 100)}%` : "?";
      showToast(`${archetype.name} loop complete — ${iters} iter · ${quality} quality`, result.succeeded ? "ok" : "error");
      setLoopState(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Loop failed";
      showToast(msg, "error");
      setLoopState((prev) => prev && { ...prev, isRunning: false, error: msg });
    }
  };

  const handleConfirmDeploy = async () => {
    if (!deployState) return;
    const archetype = archetypes.find((a) => a.id === deployState.archetypeId);
    if (!archetype) return;

    setDeployState((prev) => prev && { ...prev, isDeploying: true });

    try {
      const res = await apiFetch(buildDeployAgentUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archetypeId: deployState.archetypeId,
          task: deployState.task,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = body.error ?? `Deploy failed (${res.status})`;
        showToast(msg, "error");
        setDeployState((prev) => prev && { ...prev, isDeploying: false, error: msg });
        return;
      }

      const result = (await res.json()) as { terminalId: string; archetypeId: string };
      showToast(`${archetype.name} deployed`, "ok");
      setDeployState(null);
      onDeployed?.(result.terminalId, result.archetypeId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deploy failed";
      showToast(msg, "error");
      setDeployState((prev) => prev && { ...prev, isDeploying: false, error: msg });
    }
  };

  const recentAgentsSection =
    tentacles.length > 0 ? (
      <section className="arsenal-recent" aria-label="Recent Agents">
        <h3 className="arsenal-recent-title">Recent Agents</h3>
        <ul className="arsenal-recent-list">
          {tentacles.map((t) => (
            <li key={t.tentacleId} className="arsenal-recent-item">
              <span className="arsenal-recent-name">{t.displayName}</span>
              <button
                type="button"
                className="arsenal-recent-pin"
                aria-label={`${t.pinned ? "Unpin" : "Pin"} ${t.displayName}`}
                aria-pressed={t.pinned}
                onClick={() => void handlePinToggle(t)}
              >
                {t.pinned ? "Unpin" : "Pin"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (isLoading) {
    return (
      <section className="arsenal-panel" aria-label="Agent Arsenal">
        {setup?.shouldShowSetupCard && (
          <WorkspaceSetupCard setup={setup} onSetupChange={setSetup} />
        )}
        {recentAgentsSection}
        <p className="arsenal-loading">Loading agents...</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="arsenal-panel" aria-label="Agent Arsenal">
        {setup?.shouldShowSetupCard && (
          <WorkspaceSetupCard setup={setup} onSetupChange={setSetup} />
        )}
        {recentAgentsSection}
        <p className="arsenal-error">{loadError}</p>
      </section>
    );
  }

  return (
    <section className="arsenal-panel hud-hex-bg" aria-label="Agent Arsenal">
      {setup?.shouldShowSetupCard && <WorkspaceSetupCard setup={setup} onSetupChange={setSetup} />}
      {recentAgentsSection}

      <nav className="arsenal-filter-bar" aria-label="Filter agents by category">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            type="button"
            className="arsenal-filter-pill"
            data-active={categoryFilter === cat ? "true" : "false"}
            aria-pressed={categoryFilter === cat}
            onClick={() => handleCategoryFilter(cat)}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </nav>

      <div className="arsenal-grid" aria-label="Agent archetypes">
        {filtered.map((a) => {
          const isExpanded = deployState?.archetypeId === a.id;
          return (
            <article
              key={a.id}
              className="arsenal-card hud-panel"
              data-expanded={isExpanded ? "true" : "false"}
              data-category={a.category}
            >
              <div className="arsenal-card-header">
                <span className="arsenal-card-icon" aria-hidden="true">
                  {a.icon}
                </span>
                <div className="arsenal-card-meta">
                  <h3 className="arsenal-card-name">{a.name}</h3>
                  <p className="arsenal-card-role">{a.role}</p>
                </div>
                <span className="arsenal-card-category">{a.category}</span>
              </div>

              {a.skills.length > 0 && (
                <ul className="arsenal-card-skills" aria-label="Suggested skills">
                  {a.skills.map((skill) => (
                    <li key={skill} className="arsenal-skill-chip">
                      {skill}
                    </li>
                  ))}
                </ul>
              )}

              {isExpanded ? (
                <div className="arsenal-deploy-form">
                  <label htmlFor={`arsenal-task-${a.id}`} className="arsenal-deploy-label">
                    What should this agent do? (optional)
                  </label>
                  <textarea
                    id={`arsenal-task-${a.id}`}
                    className="arsenal-deploy-textarea"
                    rows={3}
                    placeholder="Describe the specific task..."
                    value={deployState?.task ?? ""}
                    onChange={(e) =>
                      setDeployState((prev) => prev && { ...prev, task: e.target.value })
                    }
                    disabled={deployState?.isDeploying}
                  />
                  {deployState?.error && (
                    <p className="arsenal-deploy-error">{deployState.error}</p>
                  )}
                  <div className="arsenal-deploy-actions">
                    <button
                      type="button"
                      className="arsenal-btn arsenal-btn--primary"
                      onClick={() => void handleConfirmDeploy()}
                      disabled={deployState?.isDeploying}
                    >
                      {deployState?.isDeploying ? "Deploying..." : "Deploy"}
                    </button>
                    <button
                      type="button"
                      className="arsenal-btn arsenal-btn--ghost"
                      onClick={handleCancelDeploy}
                      disabled={deployState?.isDeploying}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : loopState?.archetypeId === a.id ? (
                <div className="arsenal-deploy-form">
                  <label htmlFor={`arsenal-loop-${a.id}`} className="arsenal-deploy-label">
                    Task for agent loop (optional)
                  </label>
                  <textarea
                    id={`arsenal-loop-${a.id}`}
                    className="arsenal-deploy-textarea"
                    rows={3}
                    placeholder="Describe the task to iterate on..."
                    value={loopState.task}
                    onChange={(e) =>
                      setLoopState((prev) => prev && { ...prev, task: e.target.value })
                    }
                    disabled={loopState.isRunning}
                  />
                  {loopState.error && (
                    <p className="arsenal-deploy-error">{loopState.error}</p>
                  )}
                  <div className="arsenal-deploy-actions">
                    <button
                      type="button"
                      className="arsenal-btn arsenal-btn--primary"
                      onClick={() => void handleRunLoop()}
                      disabled={loopState.isRunning}
                    >
                      {loopState.isRunning ? "Running…" : "⟳ Run Loop"}
                    </button>
                    <button
                      type="button"
                      className="arsenal-btn arsenal-btn--ghost"
                      onClick={handleCancelLoop}
                      disabled={loopState.isRunning}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="arsenal-deploy-actions">
                  <button
                    type="button"
                    className="arsenal-btn arsenal-btn--deploy"
                    onClick={() => handleDeployClick(a.id)}
                    disabled={(deployState !== null && deployState.archetypeId !== a.id) || loopState !== null}
                  >
                    Deploy
                  </button>
                  <button
                    type="button"
                    className="arsenal-btn arsenal-btn--ghost"
                    onClick={() => handleLoopClick(a.id)}
                    disabled={(deployState !== null) || (loopState !== null && loopState.archetypeId !== a.id)}
                    title="Run iterative agent loop"
                  >
                    ⟳ Loop
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
