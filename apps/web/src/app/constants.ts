export const CODEX_USAGE_SCAN_INTERVAL_MS = 600_000;
export const GITHUB_SUMMARY_SCAN_INTERVAL_MS = 60_000;
export const MONITOR_SCAN_INTERVAL_MS = 60_000;
export const BACKEND_LIVENESS_SCAN_INTERVAL_MS = 120_000;
export const UI_STATE_SAVE_DEBOUNCE_MS = 250;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;

export const PRIMARY_NAV_ITEMS = [
  { index: 9, label: "Jarvis HQ",       icon: "◆" },
  { index: 1, label: "Agent Arsenal",   icon: "⬡" },
  { index: 2, label: "Surveillance",    icon: "◉" },
  { index: 3, label: "Workflows",       icon: "⟐" },
  { index: 4, label: "Recent Convos",   icon: "≋" },
  { index: 5, label: "Content Analyzer",icon: "⊞" },
  { index: 6, label: "Ideas",           icon: "◈" },
  { index: 7, label: "Settings",        icon: "⚙" },
] as const;

export const GITHUB_COMMIT_SERIES_LENGTH = 30;
export const GITHUB_SPARKLINE_WIDTH = 148;
export const GITHUB_SPARKLINE_HEIGHT = 36;
export const GITHUB_OVERVIEW_GRAPH_WIDTH = 640;
export const GITHUB_OVERVIEW_GRAPH_HEIGHT = 180;

export const PRIMARY_NAV_MAX = PRIMARY_NAV_ITEMS.length;

export type PrimaryNavIndex = (typeof PRIMARY_NAV_ITEMS)[number]["index"];
