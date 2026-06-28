import { useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import { buildArsenalUrl, buildDeployAgentUrl } from "../runtime/runtimeEndpoints";
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

type AgentArsenalPanelProps = {
  onDeployed?: (terminalId: string, archetypeId: string) => void;
};

export const AgentArsenalPanel = ({ onDeployed }: AgentArsenalPanelProps) => {
  const { showToast } = useToasts();
  const [archetypes, setArchetypes] = useState<AgentArchetypeCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [deployState, setDeployState] = useState<DeployState | null>(null);

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

  const filtered =
    categoryFilter === "all" ? archetypes : archetypes.filter((a) => a.category === categoryFilter);

  const handleDeployClick = (archetypeId: string) => {
    setDeployState({ archetypeId, task: "", isDeploying: false });
  };

  const handleCancelDeploy = () => {
    setDeployState(null);
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

  if (isLoading) {
    return (
      <section className="arsenal-panel" aria-label="Agent Arsenal">
        <p className="arsenal-loading">Loading agents...</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="arsenal-panel" aria-label="Agent Arsenal">
        <p className="arsenal-error">{loadError}</p>
      </section>
    );
  }

  return (
    <section className="arsenal-panel" aria-label="Agent Arsenal">
      <nav className="arsenal-filter-bar" aria-label="Filter agents by category">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            type="button"
            className="arsenal-filter-pill"
            data-active={categoryFilter === cat ? "true" : "false"}
            aria-pressed={categoryFilter === cat}
            onClick={() => setCategoryFilter(cat)}
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
              className="arsenal-card"
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
              ) : (
                <button
                  type="button"
                  className="arsenal-btn arsenal-btn--deploy"
                  onClick={() => handleDeployClick(a.id)}
                  disabled={deployState !== null && deployState.archetypeId !== a.id}
                >
                  Deploy
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
