import { type TerminalSnapshot, buildTerminalList, isAgentRuntimeState } from "@octogent/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useBackendLivenessPolling } from "./app/hooks/useBackendLivenessPolling";
import { useClaudeUsagePolling } from "./app/hooks/useClaudeUsagePolling";
import { useCodexUsagePolling } from "./app/hooks/useCodexUsagePolling";
import { useConsoleKeyboardShortcuts } from "./app/hooks/useConsoleKeyboardShortcuts";
import { useGitHubSparkline } from "./app/hooks/useGitHubSparkline";
import { useGithubSummaryPolling } from "./app/hooks/useGithubSummaryPolling";
import { useGmailStatus } from "./app/hooks/useGmailStatus";
import { useInitialColumnsHydration } from "./app/hooks/useInitialColumnsHydration";
import { useMonitorRuntime } from "./app/hooks/useMonitorRuntime";
import { usePersistedUiState } from "./app/hooks/usePersistedUiState";
import { useTentacleGitLifecycle } from "./app/hooks/useTentacleGitLifecycle";
import { useTerminalCompletionNotification } from "./app/hooks/useTerminalCompletionNotification";
import { useTerminalMutations } from "./app/hooks/useTerminalMutations";
import { useTerminalStateReconciliation } from "./app/hooks/useTerminalStateReconciliation";
import { useUsageHeatmapPolling } from "./app/hooks/useUsageHeatmapPolling";
import {
  createTerminalRuntimeStateStore,
  getTerminalRuntimeStateInfo,
  stripTerminalRuntimeState,
  stripTerminalRuntimeStates,
} from "./app/terminalRuntimeStateStore";
import type { TerminalView } from "./app/types";
import { clampSidebarWidth } from "./app/uiStateNormalizers";
import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import { ConsolePrimaryNav } from "./components/ConsolePrimaryNav";
import { GlobalSearch } from "./components/GlobalSearch";
import { NotificationPanel } from "./components/NotificationPanel";
import { PrimaryViewRouter } from "./components/PrimaryViewRouter";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { SidebarActionPanel } from "./components/SidebarActionPanel";
import { TelemetryTape } from "./components/TelemetryTape";
import { ShortcutsOverlay } from "./components/ui/ShortcutsOverlay";
import { ToastProvider } from "./components/ui/ToastProvider";
import { HttpTerminalSnapshotReader } from "./runtime/HttpTerminalSnapshotReader";
import { apiFetch, getWsAuthProtocols } from "./runtime/apiClient";

import {
  buildDeckTentacleSwarmUrl,
  buildNotificationsUrl,
  buildTerminalEventsSocketUrl,
  buildTerminalSnapshotsUrl,
} from "./runtime/runtimeEndpoints";

export const App = () => {
  const [terminals, setTerminals] = useState<TerminalView>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isShortcutsOverlayOpen, setIsShortcutsOverlayOpen] = useState(false);
  const [conversationsSidebarContent, setConversationsSidebarContent] = useState<ReactNode>(null);
  const [conversationsActionPanel, setConversationsActionPanel] = useState<ReactNode>(null);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const terminalEventsRefreshTimerRef = useRef<number | null>(null);
  const runtimeStateStoreRef = useRef(createTerminalRuntimeStateStore());
  const runtimeStateStore = runtimeStateStoreRef.current;

  const sortTerminalSnapshots = useCallback(
    (snapshots: TerminalView) =>
      [...snapshots].sort((left, right) => {
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }),
    [],
  );

  const {
    activePrimaryNav,
    setActivePrimaryNav,
    applyHydratedUiState,
    isActiveAgentsSectionExpanded,
    isAgentsSidebarVisible,
    isBottomTelemetryVisible,
    isClaudeUsageSectionExpanded,
    isCodexUsageSectionExpanded,
    isMonitorVisible,
    isRuntimeStatusStripVisible,
    isUiStateHydrated,
    minimizedTerminalIds,
    readUiState,
    setIsActiveAgentsSectionExpanded,
    setIsAgentsSidebarVisible,
    setIsBottomTelemetryVisible,
    setIsClaudeUsageSectionExpanded,
    setIsCodexUsageSectionExpanded,
    setIsMonitorVisible,
    setIsRuntimeStatusStripVisible,
    setIsUiStateHydrated,
    setMinimizedTerminalIds,
    setSidebarWidth,
    setTerminalCompletionSound,
    sidebarWidth,
    terminalCompletionSound,
  } = usePersistedUiState({ columns: terminals });
  const readColumns = useCallback(
    async (signal?: AbortSignal) => {
      const readerOptions: { endpoint: string; signal?: AbortSignal } = {
        endpoint: buildTerminalSnapshotsUrl(),
      };
      if (signal) {
        readerOptions.signal = signal;
      }
      const reader = new HttpTerminalSnapshotReader(readerOptions);
      const nextColumns = await buildTerminalList(reader);
      runtimeStateStore.syncFromTerminals(nextColumns);
      return stripTerminalRuntimeStates(nextColumns);
    },
    [runtimeStateStore],
  );

  const refreshColumns = useCallback(async () => {
    const nextColumns = await readColumns();
    setTerminals(nextColumns);
    return nextColumns;
  }, [readColumns]);

  const {
    clearPendingDeleteTerminal,
    confirmDeleteTerminal,
    createTerminal,
    isCreatingTerminal,
    isDeletingTerminalId,
    pendingDeleteTerminal,
    requestDeleteTerminal,
  } = useTerminalMutations({
    readColumns: async () => readColumns(),
    setColumns: setTerminals,
    setLoadError,
    setMinimizedTerminalIds,
  });

  const {
    gitStatusByTentacleId,
    gitStatusLoadingByTentacleId,
    pullRequestByTentacleId,
    pullRequestLoadingByTentacleId,
    openGitTentacleId,
    openGitTentacleStatus,
    openGitTentaclePullRequest,
    gitCommitMessageDraft,
    gitDialogError,
    isGitDialogLoading,
    isGitDialogMutating,
    setGitCommitMessageDraft,
    openTentacleGitActions,
    closeTentacleGitActions,
    commitTentacleChanges,
    commitAndPushTentacleBranch,
    pushTentacleBranch,
    syncTentacleBranch,
    mergeTentaclePullRequest,
  } = useTentacleGitLifecycle({
    columns: terminals,
  });

  useInitialColumnsHydration({
    readColumns,
    readUiState,
    applyHydratedUiState,
    setColumns: setTerminals,
    setLoadError,
    setIsLoading,
    setIsUiStateHydrated,
  });

  useEffect(() => {
    return () => {
      if (terminalEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(terminalEventsRefreshTimerRef.current);
        terminalEventsRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let destroyed = false;
    let reconnectDelay = 1000;
    let reconnectTimer: number | null = null;
    let activeSocket: WebSocket | null = null;

    const connect = () => {
      if (destroyed) return;
      const socket = new WebSocket(buildTerminalEventsSocketUrl(), getWsAuthProtocols());
      activeSocket = socket;

      socket.addEventListener("open", () => {
        reconnectDelay = 1000;
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as
            | {
                type?: unknown;
                snapshot?: TerminalSnapshot;
                terminalId?: string;
                agentRuntimeState?: string;
                toolName?: string;
              }
            | undefined;
          if (!payload || typeof payload.type !== "string") {
            return;
          }

          if (payload.type === "terminal-created" || payload.type === "terminal-updated") {
            if (!payload.snapshot) {
              return;
            }
            const runtimeState = getTerminalRuntimeStateInfo(payload.snapshot);
            runtimeStateStore.setRuntimeState(payload.snapshot.terminalId, runtimeState);
            const structuralSnapshot = stripTerminalRuntimeState(payload.snapshot);
            setTerminals((current) =>
              sortTerminalSnapshots([
                ...current.filter(
                  (terminal) => terminal.terminalId !== structuralSnapshot.terminalId,
                ),
                structuralSnapshot,
              ]),
            );
            return;
          }

          if (payload.type === "terminal-state-changed") {
            if (!payload.terminalId || !isAgentRuntimeState(payload.agentRuntimeState)) {
              return;
            }
            runtimeStateStore.setRuntimeState(payload.terminalId, {
              state: payload.agentRuntimeState,
              ...(payload.toolName ? { toolName: payload.toolName } : {}),
            });
            return;
          }

          if (payload.type === "terminal-deleted") {
            if (!payload.terminalId) {
              return;
            }
            runtimeStateStore.removeTerminal(payload.terminalId);
            setTerminals((current) =>
              current.filter((terminal) => terminal.terminalId !== payload.terminalId),
            );
            return;
          }

          if (payload.type !== "terminal-list-changed") {
            return;
          }
        } catch {
          return;
        }

        if (terminalEventsRefreshTimerRef.current !== null) {
          window.clearTimeout(terminalEventsRefreshTimerRef.current);
        }
        terminalEventsRefreshTimerRef.current = window.setTimeout(() => {
          terminalEventsRefreshTimerRef.current = null;
          void refreshColumns();
        }, 100);
      });

      const scheduleReconnect = () => {
        if (destroyed) return;
        const delay = Math.min(reconnectDelay, 30000);
        reconnectDelay = Math.min(delay * 2, 30000);
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.addEventListener("close", scheduleReconnect);
      socket.addEventListener("error", scheduleReconnect);
    };

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (terminalEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(terminalEventsRefreshTimerRef.current);
        terminalEventsRefreshTimerRef.current = null;
      }
      activeSocket?.close();
    };
  }, [refreshColumns, runtimeStateStore, sortTerminalSnapshots]);

  const { codexUsageSnapshot, refreshCodexUsage } = useCodexUsagePolling();
  const { claudeUsageSnapshot, isRefreshingClaudeUsage, refreshClaudeUsage } =
    useClaudeUsagePolling();
  const backendLivenessStatus = useBackendLivenessPolling();
  const { gmailStatus, isConnectingGmail, connectGmail, disconnectGmail } = useGmailStatus();
  const { githubRepoSummary } = useGithubSummaryPolling();
  const handleMaximizeTerminal = useCallback(
    (terminalId: string) => {
      setMinimizedTerminalIds((current) =>
        current.filter((currentTerminalId) => currentTerminalId !== terminalId),
      );
    },
    [setMinimizedTerminalIds],
  );
  const handleActiveTerminalIdsChange = useCallback(
    (activeTerminalIds: ReadonlySet<string>) => {
      runtimeStateStore.retainTerminalIds(activeTerminalIds);
    },
    [runtimeStateStore],
  );

  useTerminalStateReconciliation({
    columns: terminals,
    setMinimizedTerminalIds,
    onActiveTerminalIdsChange: handleActiveTerminalIdsChange,
  });
  const { playCompletionSoundPreview } = useTerminalCompletionNotification(
    runtimeStateStore,
    terminalCompletionSound,
  );
  const { heatmapData, isLoadingHeatmap, refreshHeatmap } = useUsageHeatmapPolling({
    enabled: isUiStateHydrated && (activePrimaryNav === 2 || isRuntimeStatusStripVisible),
  });

  const handleSpawnSwarm = useCallback(
    async (tentacleId: string, workspaceMode: "shared" | "worktree") => {
      await apiFetch(buildDeckTentacleSwarmUrl(tentacleId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceMode }),
      });
    },
    [],
  );

  const toggleShortcutsOverlay = useCallback(() => setIsShortcutsOverlayOpen((open) => !open), []);
  useConsoleKeyboardShortcuts({
    setActivePrimaryNav,
    onToggleShortcutsOverlay: toggleShortcutsOverlay,
  });

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);
  const monitorRuntime = useMonitorRuntime({
    enabled: isUiStateHydrated && isMonitorVisible,
  });

  const sparklinePoints = useGitHubSparkline(githubRepoSummary);
  const hasSidebarActionPanel =
    conversationsActionPanel !== null ||
    pendingDeleteTerminal !== null ||
    (openGitTentacleId !== null &&
      terminals.find((terminal) => terminal.tentacleId === openGitTentacleId)?.workspaceMode ===
        "worktree");

  const sidebarActionPanel = hasSidebarActionPanel ? (
    conversationsActionPanel ? (
      <>{conversationsActionPanel}</>
    ) : (
      <SidebarActionPanel
        pendingDeleteTerminal={pendingDeleteTerminal}
        isDeletingTerminalId={isDeletingTerminalId}
        clearPendingDeleteTerminal={clearPendingDeleteTerminal}
        confirmDeleteTerminal={confirmDeleteTerminal}
        openGitTentacleId={openGitTentacleId}
        columns={terminals}
        openGitTentacleStatus={openGitTentacleStatus}
        openGitTentaclePullRequest={openGitTentaclePullRequest}
        gitCommitMessageDraft={gitCommitMessageDraft}
        gitDialogError={gitDialogError}
        isGitDialogLoading={isGitDialogLoading}
        isGitDialogMutating={isGitDialogMutating}
        setGitCommitMessageDraft={setGitCommitMessageDraft}
        closeTentacleGitActions={closeTentacleGitActions}
        commitTentacleChanges={commitTentacleChanges}
        commitAndPushTentacleBranch={commitAndPushTentacleBranch}
        pushTentacleBranch={pushTentacleBranch}
        syncTentacleBranch={syncTentacleBranch}
        mergeTentaclePullRequest={mergeTentaclePullRequest}
        requestDeleteTerminal={requestDeleteTerminal}
      />
    )
  ) : null;

  useEffect(() => {
    if (!hasSidebarActionPanel || isAgentsSidebarVisible) {
      return;
    }
    setIsAgentsSidebarVisible(true);
  }, [isAgentsSidebarVisible, setIsAgentsSidebarVisible, hasSidebarActionPanel]);

  // Load initial unread notification count and refresh when a new one arrives.
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await apiFetch(buildNotificationsUrl(), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { unreadCount?: number };
        if (typeof data.unreadCount === "number") setUnreadNotificationCount(data.unreadCount);
      } catch {
        // ignore
      }
    };
    void fetchUnread();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jarvis.lastNotificationAt") void fetchUnread();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ToastProvider>
      <div className="page console-shell">
        {isRuntimeStatusStripVisible && (
          <RuntimeStatusStrip
            sparklinePoints={sparklinePoints}
            usageData={heatmapData}
            claudeUsage={claudeUsageSnapshot}
            isRefreshingClaudeUsage={isRefreshingClaudeUsage}
            onRefreshClaudeUsage={refreshClaudeUsage}
          />
        )}

        <ConsolePrimaryNav
          activePrimaryNav={activePrimaryNav}
          onPrimaryNavChange={setActivePrimaryNav}
          unreadNotificationCount={unreadNotificationCount}
          onBellClick={() => setIsNotificationPanelOpen((v) => !v)}
        />
        {isNotificationPanelOpen && (
          <NotificationPanel
            onClose={() => setIsNotificationPanelOpen(false)}
            onUnreadChange={setUnreadNotificationCount}
          />
        )}

        <section className="console-main-canvas" aria-label="Main content canvas">
          <div
            className={`workspace-shell${isAgentsSidebarVisible && activePrimaryNav !== 1 && activePrimaryNav !== 3 && activePrimaryNav !== 5 && activePrimaryNav !== 7 && activePrimaryNav !== 9 ? "" : " workspace-shell--full"}`}
          >
            {isAgentsSidebarVisible &&
              activePrimaryNav !== 1 &&
              activePrimaryNav !== 3 &&
              activePrimaryNav !== 5 &&
              activePrimaryNav !== 7 &&
              activePrimaryNav !== 9 && (
                <ActiveAgentsSidebar
                  sidebarWidth={sidebarWidth}
                  onSidebarWidthChange={(width) => {
                    setSidebarWidth(clampSidebarWidth(width));
                  }}
                  actionPanel={sidebarActionPanel}
                  bodyContent={
                    activePrimaryNav === 4
                      ? (conversationsSidebarContent ?? undefined)
                      : undefined
                  }
                />
              )}

            <PrimaryViewRouter
              activePrimaryNav={activePrimaryNav}
              onPrimaryNavChange={setActivePrimaryNav}
              isMonitorEnabled={isMonitorVisible}
              canvasPrimaryViewProps={{ onSpawnSwarm: handleSpawnSwarm }}
              settingsPrimaryViewProps={{
                isMonitorVisible,
                isRuntimeStatusStripVisible,
                onMonitorVisibilityChange: setIsMonitorVisible,
                onRuntimeStatusStripVisibilityChange: setIsRuntimeStatusStripVisible,
                onPreviewTerminalCompletionSound: playCompletionSoundPreview,
                onTerminalCompletionSoundChange: setTerminalCompletionSound,
                terminalCompletionSound,
                gmailStatus,
                isConnectingGmail,
                onConnectGmail: connectGmail,
                onDisconnectGmail: disconnectGmail,
              }}
              conversationsEnabled={isUiStateHydrated && activePrimaryNav === 4}
              onConversationsSidebarContent={setConversationsSidebarContent}
              onConversationsActionPanel={setConversationsActionPanel}
            />
          </div>
        </section>

        {isUiStateHydrated && isMonitorVisible && isBottomTelemetryVisible && (
          <TelemetryTape monitorFeed={monitorRuntime.monitorFeed} />
        )}

        {isSearchOpen && (
          <GlobalSearch
            onClose={() => setIsSearchOpen(false)}
            onNavigate={(index) => {
              setActivePrimaryNav(index);
              setIsSearchOpen(false);
            }}
          />
        )}

        {isShortcutsOverlayOpen && (
          <ShortcutsOverlay onClose={() => setIsShortcutsOverlayOpen(false)} />
        )}
      </div>
    </ToastProvider>
  );
};
