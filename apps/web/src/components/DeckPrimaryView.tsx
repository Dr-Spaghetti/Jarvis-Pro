import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DeckAvailableSkill,
  DeckSortMode,
  DeckTentacleSummary,
  WorkspaceSetupSnapshot,
  WorkspaceSetupStepId,
} from "@octogent/core";
import { useClickOutside } from "../app/hooks/useClickOutside";
import type { TerminalAgentProvider } from "../app/types";
import {
  buildDeckSkillsUrl,
  buildDeckTentacleOpenedUrl,
  buildDeckTentaclePinnedUrl,
  buildDeckTentacleSkillsUrl,
  buildDeckTentacleUrl,
  buildDeckTentaclesUrl,
  buildDeckTodoToggleUrl,
  buildDeckVaultFileUrl,
  buildTerminalsUrl,
} from "../runtime/runtimeEndpoints";
import { OctopusGlyph } from "./EmptyOctopus";
import { Terminal } from "./Terminal";
import { ActionCards } from "./deck/ActionCards";
import { AddTentacleForm } from "./deck/AddTentacleForm";
import type { OctopusAppearancePayload } from "./deck/AddTentacleForm";
import { DeckBottomActions } from "./deck/DeckBottomActions";
import { RecentAgentsPanel } from "./deck/RecentAgentsPanel";
import { TentaclePod } from "./deck/TentaclePod";
import { WorkspaceSetupCard } from "./deck/WorkspaceSetupCard";
import { type OctopusVisuals, deriveOctopusVisuals } from "./deck/octopusVisuals";
import { MarkdownContent } from "./ui/MarkdownContent";
import { PanelState } from "./ui/PanelState";
import { useToasts } from "./ui/ToastProvider";

import { apiFetch } from "../runtime/apiClient";

export type { OctopusAppearancePayload } from "./deck/AddTentacleForm";

const normalizeStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;

const normalizeDeckAvailableSkill = (value: unknown): DeckAvailableSkill | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") return null;

  const source =
    record.source === "project" ? "project" : record.source === "bundled" ? "bundled" : "user";
  const requiredEnv = normalizeStringArray(record.requiredEnv);
  const missingEnv = normalizeStringArray(record.missingEnv);

  return {
    name: record.name,
    description: typeof record.description === "string" ? record.description : "",
    source,
    ...(requiredEnv ? { requiredEnv } : {}),
    ...(missingEnv ? { missingEnv } : {}),
  };
};

// ─── Main view ───────────────────────────────────────────────────────────────

type FocusState =
  | { type: "vault-browser"; tentacleId: string }
  | { type: "vault"; tentacleId: string; fileName: string }
  | { type: "terminal"; agentId: string; terminalLabel: string };

type EmptyViewMode = "idle" | "adding";

type DeckPrimaryViewProps = {
  onSidebarContent?: ((content: ReactNode) => void) | undefined;
  workspaceSetup: WorkspaceSetupSnapshot | null;
  isWorkspaceSetupLoading: boolean;
  workspaceSetupError: string | null;
  onRefreshWorkspaceSetup: () => Promise<WorkspaceSetupSnapshot | null>;
  onRunWorkspaceSetupStep: (stepId: WorkspaceSetupStepId) => Promise<WorkspaceSetupSnapshot | null>;
  suppressWorkspaceSetupCard?: boolean;
  deckSortMode?: DeckSortMode;
  onDeckSortModeChange?: (mode: DeckSortMode) => void;
};

export const DeckPrimaryView = ({
  onSidebarContent,
  workspaceSetup,
  isWorkspaceSetupLoading,
  workspaceSetupError,
  onRefreshWorkspaceSetup,
  onRunWorkspaceSetupStep,
  suppressWorkspaceSetupCard = false,
  deckSortMode = "recent",
  onDeckSortModeChange,
}: DeckPrimaryViewProps) => {
  const { showToast } = useToasts();
  const [tentacles, setTentacles] = useState<DeckTentacleSummary[]>([]);
  const [isLoadingTentacles, setIsLoadingTentacles] = useState(true);
  const [tentaclesError, setTentaclesError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [vaultContent, setVaultContent] = useState<string | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [emptyViewMode, setEmptyViewMode] = useState<EmptyViewMode>("idle");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<DeckAvailableSkill[]>([]);
  const [savingTentacleSkillsId, setSavingTentacleSkillsId] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<TerminalAgentProvider>("claude-code");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const [isLaunchingAgent, setIsLaunchingAgent] = useState(false);
  const [runningSetupStepId, setRunningSetupStepId] = useState<
    | "initialize-workspace"
    | "ensure-gitignore"
    | "check-claude"
    | "check-git"
    | "check-curl"
    | "create-tentacles"
    | null
  >(null);

  // Fetch tentacle list
  const fetchTentacles = useCallback(async () => {
    setIsLoadingTentacles(true);
    setTentaclesError(null);
    try {
      const response = await apiFetch(buildDeckTentaclesUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setTentaclesError("Failed to load agents");
        return;
      }
      const data = await response.json();
      setTentacles(data);
      await onRefreshWorkspaceSetup();
    } catch {
      setTentaclesError("Network error");
    } finally {
      setIsLoadingTentacles(false);
    }
  }, [onRefreshWorkspaceSetup]);

  // Record tentacle opened + optimistic merge (guard ref prevents double-fire)
  const recordedOpenRef = useRef<string | null>(null);
  useEffect(() => {
    const tentacleId =
      focus?.type === "vault" || focus?.type === "vault-browser" ? focus.tentacleId : null;
    if (!tentacleId) {
      recordedOpenRef.current = null;
      return;
    }
    if (recordedOpenRef.current === tentacleId) return;
    recordedOpenRef.current = tentacleId;
    const record = async () => {
      try {
        const response = await apiFetch(buildDeckTentacleOpenedUrl(tentacleId), { method: "POST" });
        if (!response.ok) return;
        const updated = (await response.json()) as DeckTentacleSummary;
        setTentacles((prev) => prev.map((t) => (t.tentacleId === tentacleId ? updated : t)));
      } catch {
        // ignore
      }
    };
    void record();
  }, [focus]);

  useEffect(() => {
    void fetchTentacles();
  }, [fetchTentacles]);

  useEffect(() => {
    let cancelled = false;

    const fetchSkills = async () => {
      try {
        const response = await apiFetch(buildDeckSkillsUrl(), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as unknown;
        if (!Array.isArray(payload) || cancelled) return;
        const skills = payload
          .map((entry) => normalizeDeckAvailableSkill(entry))
          .filter((entry): entry is DeckAvailableSkill => entry !== null);
        if (!cancelled) {
          setAvailableSkills(skills);
        }
      } catch {
        // silently ignore
      }
    };

    void fetchSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  // Precompute visuals for all tentacles
  const visualsMap = useMemo(() => {
    const map = new Map<string, OctopusVisuals>();
    for (const t of tentacles) {
      map.set(t.tentacleId, deriveOctopusVisuals(t));
    }
    return map;
  }, [tentacles]);

  // Fetch vault file content when focus changes
  useEffect(() => {
    if (!focus || focus.type !== "vault") {
      setVaultContent(null);
      return;
    }

    let cancelled = false;
    setLoadingVault(true);
    const fetchVault = async () => {
      try {
        const response = await apiFetch(buildDeckVaultFileUrl(focus.tentacleId, focus.fileName), {
          headers: { Accept: "text/markdown" },
        });
        if (cancelled) return;
        if (!response.ok) {
          setVaultContent(null);
          setLoadingVault(false);
          return;
        }
        const text = await response.text();
        if (!cancelled) {
          setVaultContent(text);
          setLoadingVault(false);
        }
      } catch {
        if (!cancelled) {
          setVaultContent(null);
          setLoadingVault(false);
        }
      }
    };
    void fetchVault();
    return () => {
      cancelled = true;
    };
  }, [focus]);

  // Agent menu click-outside/escape
  const handleDismissAgentMenu = useCallback(() => setAgentMenuOpen(false), []);
  useClickOutside(agentMenuRef, agentMenuOpen, handleDismissAgentMenu);

  const handleVaultFileClick = useCallback((tentacleId: string, fileName: string) => {
    setFocus({ type: "vault", tentacleId, fileName });
  }, []);

  const handleClose = useCallback(() => {
    setFocus(null);
  }, []);

  const handleLaunchAgent = useCallback(async () => {
    setIsLaunchingAgent(true);
    try {
      const response = await apiFetch(buildTerminalsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: "tentacle-planner",
          workspaceMode: "shared",
          agentProvider: selectedAgent,
          promptTemplate: "tentacle-planner",
        }),
      });
      if (!response.ok) return;
      const data = await response.json();
      const agentId = (data.terminalId ?? data.tentacleId) as string;
      setFocus({ type: "terminal", agentId, terminalLabel: "Agent Planner" });
      await fetchTentacles();
    } catch {
      showToast("Failed to launch agent", "error");
    } finally {
      setIsLaunchingAgent(false);
    }
  }, [selectedAgent, fetchTentacles, showToast]);

  const handleRunSetupStep = useCallback(
    async (
      stepId:
        | "initialize-workspace"
        | "ensure-gitignore"
        | "check-claude"
        | "check-git"
        | "check-curl"
        | "create-tentacles",
    ) => {
      setRunningSetupStepId(stepId);
      try {
        await onRunWorkspaceSetupStep(stepId);
        if (stepId === "initialize-workspace" || stepId === "ensure-gitignore") {
          await fetchTentacles();
        }
      } finally {
        setRunningSetupStepId(null);
      }
    },
    [fetchTentacles, onRunWorkspaceSetupStep],
  );

  const handleCreateTentacle = useCallback(
    async (
      name: string,
      description: string,
      color: string,
      octopus: OctopusAppearancePayload,
      suggestedSkills: string[],
    ) => {
      setIsCreating(true);
      setCreateError(null);
      try {
        const response = await apiFetch(buildDeckTentaclesUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ name, description, color, octopus, suggestedSkills }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const msg =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : "Failed to create agent";
          setCreateError(msg);
          return;
        }
        setEmptyViewMode("idle");
        await fetchTentacles();
        await onRefreshWorkspaceSetup();
      } catch {
        setCreateError("Network error");
      } finally {
        setIsCreating(false);
      }
    },
    [fetchTentacles, onRefreshWorkspaceSetup],
  );

  const handleTentacleSkillsSave = useCallback(
    async (tentacleId: string, suggestedSkills: string[]) => {
      setSavingTentacleSkillsId(tentacleId);
      try {
        const response = await apiFetch(buildDeckTentacleSkillsUrl(tentacleId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ suggestedSkills }),
        });
        if (!response.ok) {
          showToast("Failed to save skills", "error");
          return false;
        }
        await fetchTentacles();
        showToast("Skills saved", "ok");
        return true;
      } catch {
        showToast("Failed to save skills", "error");
        return false;
      } finally {
        setSavingTentacleSkillsId((current) => (current === tentacleId ? null : current));
      }
    },
    [fetchTentacles, showToast],
  );

  const [deletingTentacleId, setDeletingTentacleId] = useState<string | null>(null);

  const handleDeleteTentacle = useCallback(
    async (tentacleId: string) => {
      setDeletingTentacleId(tentacleId);
      try {
        const response = await apiFetch(buildDeckTentacleUrl(tentacleId), { method: "DELETE" });
        if (!response.ok) {
          showToast("Failed to delete agent", "error");
          return;
        }
        await fetchTentacles();
      } catch {
        showToast("Failed to delete agent", "error");
      } finally {
        setDeletingTentacleId(null);
      }
    },
    [fetchTentacles, showToast],
  );

  const handleTodoToggle = useCallback(
    async (tentacleId: string, itemIndex: number, done: boolean) => {
      try {
        const response = await apiFetch(buildDeckTodoToggleUrl(tentacleId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIndex, done }),
        });
        if (!response.ok) {
          showToast("Failed to update todo", "error");
          return;
        }
        await fetchTentacles();
      } catch {
        showToast("Failed to update todo", "error");
      }
    },
    [fetchTentacles, showToast],
  );

  const handleTogglePin = useCallback(
    async (tentacleId: string, newPinned: boolean) => {
      try {
        const response = await apiFetch(buildDeckTentaclePinnedUrl(tentacleId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: newPinned }),
        });
        if (!response.ok) {
          showToast("Failed to update pin", "error");
          return;
        }
        const updated = (await response.json()) as DeckTentacleSummary;
        setTentacles((prev) => prev.map((t) => (t.tentacleId === tentacleId ? updated : t)));
      } catch {
        showToast("Failed to update pin", "error");
      }
    },
    [showToast],
  );

  const focusedTentacle =
    focus?.type === "vault" || focus?.type === "vault-browser"
      ? tentacles.find((t) => t.tentacleId === focus.tentacleId)
      : null;
  const mode = focus ? "detail" : "grid";
  const shouldShowWorkspaceSetup =
    !suppressWorkspaceSetupCard && tentacles.length === 0 && workspaceSetup?.shouldShowSetupCard;

  // Push sidebar content to the shared sidebar
  const sidebarContent = useMemo(
    () =>
      tentacles.length > 0 || focus?.type === "terminal" || shouldShowWorkspaceSetup ? (
        <div className="deck-sidebar-content">
          <div className="deck-sidebar-content-top">
            {shouldShowWorkspaceSetup ? (
              <WorkspaceSetupCard
                compact
                workspaceSetup={workspaceSetup}
                isLoading={isWorkspaceSetupLoading}
                error={workspaceSetupError}
                onRunStep={handleRunSetupStep}
                onLaunchClaudeCode={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
                isRunningStepId={runningSetupStepId}
              />
            ) : (
              <ActionCards
                compact
                selectedAgent={selectedAgent}
                setSelectedAgent={setSelectedAgent}
                agentMenuOpen={agentMenuOpen}
                setAgentMenuOpen={setAgentMenuOpen}
                agentMenuRef={agentMenuRef}
                onAddManually={() => {
                  setEmptyViewMode("adding");
                  setCreateError(null);
                }}
                onLaunchAgent={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
              />
            )}
          </div>
          {tentacles.length > 0 && (
            <div className="deck-sidebar-content-bottom">
              <DeckBottomActions
                onClearAll={async () => {
                  for (const t of tentacles) {
                    await apiFetch(buildDeckTentacleUrl(t.tentacleId), { method: "DELETE" });
                  }
                  await fetchTentacles();
                }}
              />
            </div>
          )}
        </div>
      ) : null,
    [
      agentMenuOpen,
      fetchTentacles,
      focus?.type,
      handleLaunchAgent,
      handleRunSetupStep,
      isLaunchingAgent,
      isWorkspaceSetupLoading,
      runningSetupStepId,
      selectedAgent,
      shouldShowWorkspaceSetup,
      tentacles,
      workspaceSetup,
      workspaceSetupError,
    ],
  );

  useEffect(() => {
    onSidebarContent?.(sidebarContent);
    return () => onSidebarContent?.(null);
  }, [onSidebarContent, sidebarContent]);

  // ─── Loading / error state ───────────────────────────────────────────────────

  if (isLoadingTentacles) {
    return (
      <section className="deck-view" data-mode="grid" aria-label="Deck">
        <div className="deck-empty-state">
          <PanelState state="loading" message="Loading agents…" />
        </div>
      </section>
    );
  }

  if (tentaclesError && tentacles.length === 0) {
    return (
      <section className="deck-view" data-mode="grid" aria-label="Deck">
        <div className="deck-empty-state">
          <PanelState
            state="error"
            message={tentaclesError}
            onRetry={() => {
              void fetchTentacles();
            }}
          />
        </div>
      </section>
    );
  }

  // ─── Empty state (no tentacles) ─────────────────────────────────────────────

  if (tentacles.length === 0 && focus?.type !== "terminal") {
    return (
      <section
        className="deck-view"
        data-mode="grid"
        data-empty-mode={emptyViewMode}
        aria-label="Deck"
      >
        <div className="deck-empty-state">
          <div className="deck-empty-left">
            <div className="deck-empty-octopus">
              <OctopusGlyph
                color="#d4a017"
                animation="walk"
                expression="happy"
                accessory="none"
                scale={20}
              />
            </div>
            {shouldShowWorkspaceSetup ? (
              <WorkspaceSetupCard
                workspaceSetup={workspaceSetup}
                isLoading={isWorkspaceSetupLoading}
                error={workspaceSetupError}
                onRunStep={handleRunSetupStep}
                onLaunchClaudeCode={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
                isRunningStepId={runningSetupStepId}
              />
            ) : (
              <ActionCards
                selectedAgent={selectedAgent}
                setSelectedAgent={setSelectedAgent}
                agentMenuOpen={agentMenuOpen}
                setAgentMenuOpen={setAgentMenuOpen}
                agentMenuRef={agentMenuRef}
                onAddManually={() => {
                  setEmptyViewMode("adding");
                  setCreateError(null);
                }}
                onLaunchAgent={handleLaunchAgent}
                isLaunchingAgent={isLaunchingAgent}
              />
            )}
          </div>
          {emptyViewMode === "adding" && (
            <div className="deck-empty-right">
              <AddTentacleForm
                onSubmit={handleCreateTentacle}
                onCancel={() => setEmptyViewMode("idle")}
                isSubmitting={isCreating}
                error={createError}
                availableSkills={availableSkills}
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  // ─── Populated state ────────────────────────────────────────────────────────

  return (
    <section
      className="deck-view"
      data-mode={mode}
      data-has-pods={tentacles.length > 0}
      aria-label="Deck"
    >
      <RecentAgentsPanel
        tentacles={tentacles}
        onOpenTentacle={(tentacleId) => setFocus({ type: "vault-browser", tentacleId })}
        onPinToggle={handleTogglePin}
        sortMode={deckSortMode}
        onSortModeChange={onDeckSortModeChange ?? (() => {})}
      />

      <div className="deck-pods-container">
        {tentacles.map((t) => {
          const isThis =
            (focus?.type === "vault" || focus?.type === "vault-browser") &&
            focus.tentacleId === t.tentacleId;
          return (
            <div
              key={t.tentacleId}
              className="deck-pod-slot"
              data-pod-role={isThis ? "focused" : focus ? "other" : "idle"}
            >
              <TentaclePod
                tentacle={t}
                visuals={visualsMap.get(t.tentacleId) as OctopusVisuals}
                isFocused={isThis}
                activeFileName={focus?.type === "vault" && isThis ? focus.fileName : undefined}
                onVaultFileClick={(fileName) =>
                  setFocus({ type: "vault", tentacleId: t.tentacleId, fileName })
                }
                onVaultBrowse={() => setFocus({ type: "vault-browser", tentacleId: t.tentacleId })}
                onClose={handleClose}
                onDelete={() => handleDeleteTentacle(t.tentacleId)}
                isDeleting={deletingTentacleId === t.tentacleId}
                onTodoToggle={handleTodoToggle}
                availableSkills={availableSkills}
                isSavingSkills={savingTentacleSkillsId === t.tentacleId}
                onSaveSuggestedSkills={handleTentacleSkillsSave}
              />
            </div>
          );
        })}
      </div>

      <div className="deck-detail-main">
        {focus?.type === "vault-browser" && focusedTentacle && (
          <>
            <header className="deck-detail-main-header">
              <button type="button" className="deck-add-form-back" onClick={handleClose}>
                ← Back
              </button>
              <span className="deck-detail-main-path">
                <strong>{focusedTentacle.displayName}</strong> / vault
              </span>
            </header>
            <div className="deck-detail-main-content deck-vault-browser">
              <pre className="deck-vault-tree">
                <span className="deck-vault-tree-dir">
                  .octogent/tentacles/{focusedTentacle.tentacleId}/
                </span>
                {(() => {
                  const files = [...focusedTentacle.vaultFiles, "CONTEXT.md"];
                  return files.map((file, i) => {
                    const isLast = i === files.length - 1;
                    const prefix = isLast ? "└── " : "├── ";
                    return (
                      <span key={file} className="deck-vault-tree-row">
                        <span className="deck-vault-tree-branch">{prefix}</span>
                        <button
                          type="button"
                          className="deck-vault-tree-file"
                          onClick={() =>
                            setFocus({
                              type: "vault",
                              tentacleId: focus.tentacleId,
                              fileName: file,
                            })
                          }
                        >
                          {file}
                        </button>
                      </span>
                    );
                  });
                })()}
              </pre>
            </div>
          </>
        )}
        {focus?.type === "vault" && focusedTentacle && (
          <>
            <header className="deck-detail-main-header">
              <button
                type="button"
                className="deck-add-form-back"
                onClick={() => setFocus({ type: "vault-browser", tentacleId: focus.tentacleId })}
              >
                ← Back
              </button>
              <span className="deck-detail-main-path">
                {focusedTentacle.displayName} / <strong>{focus.fileName}</strong>
              </span>
            </header>
            <div className="deck-detail-main-content" key={`${focus.tentacleId}/${focus.fileName}`}>
              {loadingVault ? (
                <span className="deck-detail-loading">Loading…</span>
              ) : vaultContent !== null ? (
                <MarkdownContent content={vaultContent} className="deck-detail-markdown" />
              ) : (
                <span className="deck-detail-loading">File not found.</span>
              )}
            </div>
          </>
        )}
        {focus?.type === "terminal" && (
          <div className="deck-detail-terminal" key={focus.agentId}>
            <header className="deck-detail-main-header">
              <button type="button" className="deck-add-form-back" onClick={handleClose}>
                ← Back
              </button>
              <span className="deck-detail-main-path">
                <strong>{focus.terminalLabel}</strong>
              </span>
            </header>
            <Terminal terminalId={focus.agentId} terminalLabel={focus.terminalLabel} />
          </div>
        )}
      </div>
    </section>
  );
};
