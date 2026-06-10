import { useCallback, useEffect, useState } from "react";

import { formatRelativeTime } from "../../app/formatRelativeTime";
import { buildBrainJournalUrl } from "../../runtime/runtimeEndpoints";
import { PanelState } from "../ui/PanelState";

import { apiFetch } from "../../runtime/apiClient";

type JournalStatus = "ok" | "warn" | "error";

type JournalEntry = {
  ts: string;
  status: JournalStatus;
  skill: string | null;
  action: string;
  detail: string | null;
};

type JournalResponse = {
  configured: boolean;
  entries: JournalEntry[];
};

type StatusFilter = "all" | JournalStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ok", label: "OK" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
];

const JOURNAL_FETCH_LIMIT = 200;

const downloadJson = (entries: JournalEntry[]) => {
  const blob = new Blob([JSON.stringify({ entries }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "activity-log.json";
  a.click();
  URL.revokeObjectURL(url);
};

export const JournalTimeline = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [configured, setConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const fetchJournal = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch(buildBrainJournalUrl(JOURNAL_FETCH_LIMIT), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setError("Failed to load activity log.");
        return;
      }
      const data = (await response.json()) as JournalResponse;
      setConfigured(data.configured);
      setEntries(data.entries);
      setNow(Date.now());
    } catch {
      setError("Network error loading activity log.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJournal();
  }, [fetchJournal]);

  const visibleEntries = entries.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      if (
        !e.action.toLowerCase().includes(q) &&
        !(e.skill ?? "").toLowerCase().includes(q) &&
        !(e.detail ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <section className="journal-timeline" aria-label="Activity timeline">
      <header className="journal-timeline-header">
        <h2 className="journal-timeline-title">Activity Log</h2>
        <div className="journal-timeline-controls">
          <fieldset className="journal-timeline-filter" aria-label="Status filter">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className="journal-filter-btn"
                data-active={statusFilter === f.value}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </fieldset>
          <input
            aria-label="Search activity log"
            className="journal-timeline-search"
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search…"
            type="search"
            value={searchText}
          />
          <button
            aria-label="Refresh activity log"
            className="journal-refresh-btn"
            onClick={() => void fetchJournal()}
            type="button"
          >
            ↻
          </button>
          {visibleEntries.length > 0 && (
            <button
              aria-label="Export activity log as JSON"
              className="journal-export-btn"
              onClick={() => downloadJson(visibleEntries)}
              type="button"
            >
              ↓ Export
            </button>
          )}
        </div>
      </header>

      {isLoading && <PanelState state="loading" message="Loading activity log…" />}

      {!isLoading && error && (
        <PanelState state="error" message={error} onRetry={() => void fetchJournal()} />
      )}

      {!isLoading && !error && !configured && (
        <PanelState
          state="empty"
          message="No vault configured. Set OBSIDIAN_VAULT_PATH to enable the activity log."
        />
      )}

      {!isLoading && !error && configured && visibleEntries.length === 0 && (
        <PanelState
          state="empty"
          message={
            searchText || statusFilter !== "all"
              ? "No entries match the current filter."
              : "No activity recorded yet."
          }
        />
      )}

      {!isLoading && !error && configured && visibleEntries.length > 0 && (
        <ol className="journal-entries" aria-label="Journal entries">
          {visibleEntries.map((entry, idx) => (
            <li key={`${entry.ts}-${idx}`} className="journal-entry" data-status={entry.status}>
              <span
                className={`journal-entry-dot journal-entry-dot--${entry.status}`}
                aria-hidden="true"
              />
              <time className="journal-entry-time" dateTime={entry.ts}>
                {formatRelativeTime(entry.ts, now)}
              </time>
              {entry.skill && <span className="journal-entry-skill">{entry.skill}</span>}
              <span className="journal-entry-action">{entry.action}</span>
              {entry.detail && <span className="journal-entry-detail">{entry.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
