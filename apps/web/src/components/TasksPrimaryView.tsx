import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import { buildBrainCaptureUrl, buildBrainDigestUrl } from "../runtime/runtimeEndpoints";

type DigestResponse = {
  tasks?: { open?: string[]; openCount?: number };
};

const s = {
  panel: {
    display: "flex" as const,
    flexDirection: "column" as const,
    height: "100%",
    background: "#000",
    fontFamily: '"JetBrains Mono", "IBM Plex Mono", monospace',
    minHeight: 0,
    overflow: "hidden" as const,
  },
  hdr: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: "10px 14px",
    borderBottom: "1px solid rgba(57,255,20,0.14)",
    flexShrink: 0,
  },
  hdrTitle: {
    fontSize: 9,
    letterSpacing: "0.28em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.35)",
  },
  refreshBtn: {
    background: "none",
    border: "1px solid rgba(57,255,20,0.18)",
    color: "rgba(57,255,20,0.38)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "3px 8px",
    cursor: "pointer",
  },
  quickAddBar: {
    display: "flex" as const,
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid rgba(57,255,20,0.09)",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.22)",
    color: "#d0e8d0",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    padding: "6px 10px",
    outline: "none",
  },
  addBtn: (disabled: boolean) => ({
    background: "rgba(57,255,20,0.08)",
    border: "1px solid rgba(57,255,20,0.3)",
    color: "#39ff14",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "6px 12px",
    cursor: disabled ? ("not-allowed" as const) : ("pointer" as const),
    opacity: disabled ? 0.4 : 1,
    flexShrink: 0,
  }),
  list: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "10px 14px",
    minHeight: 0,
  },
  dim: {
    color: "rgba(57,255,20,0.25)",
    fontSize: 9,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
  },
  err: {
    color: "rgba(255,80,80,0.55)",
    fontSize: 10,
    margin: 0,
  },
  empty: {
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    height: "100%",
    gap: 8,
    color: "rgba(57,255,20,0.18)",
  },
  emptyIcon: { fontSize: 24 },
  emptyLabel: {
    fontSize: 9,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
  },
  taskList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 4,
  },
  taskItem: {
    display: "flex" as const,
    alignItems: "flex-start" as const,
    gap: 10,
    padding: "8px 10px",
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.1)",
    borderLeft: "2px solid rgba(57,255,20,0.28)",
  },
  taskBox: {
    width: 10,
    height: 10,
    border: "1px solid rgba(57,255,20,0.35)",
    flexShrink: 0,
    marginTop: 2,
    display: "inline-block" as const,
  },
  taskText: {
    fontSize: 11,
    color: "#c8dcc8",
    lineHeight: 1.55,
    wordBreak: "break-word" as const,
    margin: 0,
  },
  footer: {
    padding: "6px 14px",
    borderTop: "1px solid rgba(57,255,20,0.08)",
    fontSize: 8,
    letterSpacing: "0.15em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.2)",
    flexShrink: 0,
  },
};

const cleanTask = (raw: string) =>
  raw
    .replace(/^-?\s*\[\s*\]\s*/, "")
    .replace(/^#+ /, "")
    .trim();

export const TasksPrimaryView = () => {
  const [tasks, setTasks] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(buildBrainDigestUrl());
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as DigestResponse;
      setTasks(data.tasks?.open ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleAdd = useCallback(async () => {
    const text = quickAdd.trim();
    if (!text || isAdding) return;
    setIsAdding(true);
    try {
      const res = await apiFetch(buildBrainCaptureUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `- [ ] ${text}` }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setQuickAdd("");
      setAddFeedback("Captured");
      setTimeout(() => setAddFeedback(null), 1800);
      void fetchTasks();
    } catch {
      setAddFeedback("Error");
      setTimeout(() => setAddFeedback(null), 1800);
    } finally {
      setIsAdding(false);
    }
  }, [quickAdd, isAdding, fetchTasks]);

  const tasksWithIds = tasks.map((task, i) => ({ id: `t${i}`, text: task }));

  return (
    <section className="tasks-view" aria-label="Tasks primary view" style={s.panel}>
      <header style={s.hdr}>
        <span style={s.hdrTitle}>◈ Tasks / Today</span>
        <button
          type="button"
          style={s.refreshBtn}
          onClick={() => {
            void fetchTasks();
          }}
        >
          ↺ Refresh
        </button>
      </header>

      <div style={s.quickAddBar}>
        <input
          type="text"
          style={s.input}
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void handleAdd();
            }
          }}
          placeholder="Quick-add task — press Enter…"
          aria-label="Add a new task"
        />
        <button
          type="button"
          style={s.addBtn(isAdding || !quickAdd.trim())}
          disabled={isAdding || !quickAdd.trim()}
          onClick={() => {
            void handleAdd();
          }}
        >
          {addFeedback ?? "Add"}
        </button>
      </div>

      <div style={s.list}>
        {isLoading ? (
          <p style={s.dim}>Loading tasks…</p>
        ) : error ? (
          <p style={s.err}>⚠ {error} — Obsidian brain may not be connected</p>
        ) : tasks.length === 0 ? (
          <div style={s.empty}>
            <span style={s.emptyIcon}>◈</span>
            <span style={s.emptyLabel}>No open tasks</span>
          </div>
        ) : (
          <ol style={s.taskList}>
            {tasksWithIds.map(({ id, text }) => (
              <li key={id} style={s.taskItem}>
                <span style={s.taskBox} aria-hidden="true" />
                <p style={s.taskText}>{cleanTask(text)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {!isLoading && !error && (
        <footer style={s.footer}>
          {tasks.length} open task{tasks.length !== 1 ? "s" : ""}
        </footer>
      )}
    </section>
  );
};
