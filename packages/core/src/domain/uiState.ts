import type { TerminalCompletionSoundId } from "./completionSound";

export type DeckSortMode = "recent" | "active-first" | "pinned-first" | "needs-review-first";

const DECK_SORT_MODES: readonly DeckSortMode[] = [
  "recent",
  "active-first",
  "pinned-first",
  "needs-review-first",
];

export const isDeckSortMode = (value: unknown): value is DeckSortMode =>
  typeof value === "string" && (DECK_SORT_MODES as readonly string[]).includes(value);

export type PersistedUiState = {
  activePrimaryNav?: number;
  isAgentsSidebarVisible?: boolean;
  sidebarWidth?: number;
  isActiveAgentsSectionExpanded?: boolean;
  isRuntimeStatusStripVisible?: boolean;
  isMonitorVisible?: boolean;
  isBottomTelemetryVisible?: boolean;
  isCodexUsageVisible?: boolean;
  isClaudeUsageVisible?: boolean;
  isClaudeUsageSectionExpanded?: boolean;
  isCodexUsageSectionExpanded?: boolean;
  terminalCompletionSound?: TerminalCompletionSoundId;
  minimizedTerminalIds?: string[];
  terminalWidths?: Record<string, number>;
  canvasOpenTerminalIds?: string[];
  canvasOpenTentacleIds?: string[];
  canvasTerminalsPanelWidth?: number;
  terminalInactivityThresholdMs?: number;
  deckSortMode?: DeckSortMode;
};
