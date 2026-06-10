import { useState } from "react";

import type { DeckTentacleSummary } from "@octogent/core";
import { formatRelativeTime } from "../../app/formatRelativeTime";
import { PanelState } from "../ui/PanelState";
import { STATUS_LABELS } from "./TentaclePod";

// ─── Sort logic (exported for unit tests) ────────────────────────────────────

export type SortMode = "recent" | "active-first" | "pinned-first" | "needs-review-first";

export const deriveRecentAgents = (
  tentacles: DeckTentacleSummary[],
  sortMode: SortMode,
  maxRecent = 5,
): DeckTentacleSummary[] => {
  const pinned = tentacles.filter((t) => t.pinned);
  const recentCandidates = tentacles
    .filter((t) => !t.pinned && t.lastOpenedAt != null)
    .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""))
    .slice(0, maxRecent);

  const combined = [...pinned, ...recentCandidates];

  return combined.sort((a, b) => {
    if (sortMode === "pinned-first") {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
    } else if (sortMode === "active-first") {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
    } else if (sortMode === "needs-review-first") {
      if (a.status === "needs-review" && b.status !== "needs-review") return -1;
      if (b.status === "needs-review" && a.status !== "needs-review") return 1;
    }
    const aDate = a.lastOpenedAt ?? "";
    const bDate = b.lastOpenedAt ?? "";
    return bDate.localeCompare(aDate);
  });
};

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "active-first", label: "Active first" },
  { value: "pinned-first", label: "Pinned first" },
  { value: "needs-review-first", label: "Review first" },
];

// ─── Component ────────────────────────────────────────────────────────────────

type RecentAgentsPanelProps = {
  tentacles: DeckTentacleSummary[];
  onOpenTentacle: (tentacleId: string) => void;
  onPinToggle: (tentacleId: string, newPinned: boolean) => void;
  now?: number;
};

export const RecentAgentsPanel = ({
  tentacles,
  onOpenTentacle,
  onPinToggle,
  now = Date.now(),
}: RecentAgentsPanelProps) => {
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  const agents = deriveRecentAgents(tentacles, sortMode);

  if (agents.length === 0) {
    return (
      <section className="recent-agents-panel" aria-label="Recent Agents">
        <PanelState state="empty" message="No recently opened agents yet." />
      </section>
    );
  }

  return (
    <section className="recent-agents-panel" aria-label="Recent Agents">
      <header className="recent-agents-header">
        <span className="recent-agents-title">Recent Agents</span>
        <fieldset className="recent-agents-sort" aria-label="Sort order">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="recent-agents-sort-btn"
              data-active={sortMode === opt.value}
              onClick={() => setSortMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </fieldset>
      </header>

      <ul className="recent-agents-list">
        {agents.map((t) => (
          <li key={t.tentacleId} className="recent-agents-row">
            <button
              type="button"
              className="recent-agents-row-main"
              onClick={() => onOpenTentacle(t.tentacleId)}
            >
              <span
                className={`recent-agents-dot recent-agents-dot--${t.status}`}
                aria-hidden="true"
              />
              <span className="recent-agents-name">{t.displayName}</span>
              <span className={`recent-agents-badge recent-agents-badge--${t.status}`}>
                {STATUS_LABELS[t.status]}
              </span>
              {t.lastOpenedAt && (
                <span className="recent-agents-time">
                  {formatRelativeTime(t.lastOpenedAt, now)}
                </span>
              )}
              {(t.openCount ?? 0) > 0 && (
                <span className="recent-agents-count" aria-label={`Opened ${t.openCount} times`}>
                  ×{t.openCount}
                </span>
              )}
            </button>

            <button
              type="button"
              className="recent-agents-pin"
              aria-label={t.pinned ? `Unpin ${t.displayName}` : `Pin ${t.displayName}`}
              aria-pressed={t.pinned === true}
              data-pinned={t.pinned === true}
              onClick={() => onPinToggle(t.tentacleId, !t.pinned)}
            >
              ★
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
