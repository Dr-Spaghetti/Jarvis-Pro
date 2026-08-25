import { useCallback, useEffect, useState } from "react";

import type { PrimaryNavIndex } from "../../app/constants";
import { apiFetch } from "../../runtime/apiClient";
import {
  buildBrainCaptureUrl,
  buildBrainMemoryUrl,
  buildBrainTasksUrl,
  buildBriefConfigUrl,
} from "../../runtime/runtimeEndpoints";
import { HomeTilesPanel } from "../HomeTilesPanel";

type CaptureKind = "note" | "remember" | "task";

type VaultTask = {
  text: string;
  done: boolean;
  path: string;
  line: number;
  stale: boolean;
  source: "inbox" | "vault";
};

type MemoryPayload = {
  configured: boolean;
  items: string[];
  sections?: { Me?: string[]; Commitments?: string[] };
};

type BriefConfig = {
  enabled: boolean;
  time: string;
  lastBriefDate: string | null;
};

const KIND_LABEL: Record<CaptureKind, string> = {
  note: "Note",
  remember: "Remember",
  task: "Task",
};

type JarvisTodayPanelProps = {
  onNavigate: (index: PrimaryNavIndex) => void;
};

export const JarvisTodayPanel = ({ onNavigate }: JarvisTodayPanelProps) => {
  const [kind, setKind] = useState<CaptureKind>("note");
  const [draft, setDraft] = useState("");
  const [filed, setFiled] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [tasksConfigured, setTasksConfigured] = useState(true);
  const [memoryPreview, setMemoryPreview] = useState<string[]>([]);
  const [brief, setBrief] = useState<BriefConfig | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainTasksUrl());
      if (!res.ok) return;
      const data = (await res.json()) as { configured?: boolean; tasks?: VaultTask[] };
      setTasksConfigured(data.configured !== false);
      setTasks(Array.isArray(data.tasks) ? data.tasks.filter((t) => !t.done).slice(0, 7) : []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadMemory = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainMemoryUrl());
      if (!res.ok) return;
      const data = (await res.json()) as MemoryPayload;
      const me = data.sections?.Me ?? [];
      const commitments = data.sections?.Commitments ?? [];
      const rest = (data.items ?? []).filter(
        (item) => !me.includes(item) && !commitments.includes(item),
      );
      setMemoryPreview([...me, ...commitments, ...rest].slice(0, 3));
    } catch {
      /* ignore */
    }
  }, []);

  const loadBrief = useCallback(async () => {
    try {
      const res = await apiFetch(buildBriefConfigUrl());
      if (!res.ok) return;
      const data = (await res.json()) as Partial<BriefConfig>;
      setBrief({
        enabled: data.enabled === true,
        time: typeof data.time === "string" ? data.time : "08:00",
        lastBriefDate: typeof data.lastBriefDate === "string" ? data.lastBriefDate : null,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    void loadMemory();
    void loadBrief();
  }, [loadTasks, loadMemory, loadBrief]);

  const submitCapture = async () => {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    setCaptureError(null);
    setFiled(null);
    try {
      const res = await apiFetch(buildBrainCaptureUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, kind }),
      });
      const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok) {
        setCaptureError(data.error ?? "Capture failed");
        return;
      }
      setDraft("");
      setFiled(typeof data.path === "string" ? data.path : "vault");
      if (kind === "task") void loadTasks();
      if (kind === "remember") void loadMemory();
    } catch {
      setCaptureError("Capture failed — is Jarvis running?");
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (task: VaultTask) => {
    try {
      const res = await apiFetch(buildBrainTasksUrl(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: task.path, line: task.line, done: true, text: task.text }),
      });
      if (res.ok) void loadTasks();
    } catch {
      /* ignore */
    }
  };

  const onTileActivate = (tileId: string) => {
    if (tileId === "gmail-unread") onNavigate(7);
    if (tileId === "journal-week") onNavigate(6);
  };

  return (
    <section className="jarvis-today" aria-label="Today">
      <header className="jarvis-today-header">
        <p className="jarvis-panel-title">Today</p>
      </header>

      <form
        className="jarvis-capture"
        aria-label="Capture"
        onSubmit={(event) => {
          event.preventDefault();
          void submitCapture();
        }}
      >
        <fieldset className="jarvis-capture-kinds" aria-label="Capture kind">
          {(Object.keys(KIND_LABEL) as CaptureKind[]).map((item) => (
            <button
              key={item}
              type="button"
              className="jarvis-capture-kind"
              data-active={kind === item ? "true" : "false"}
              aria-pressed={kind === item}
              onClick={() => setKind(item)}
            >
              {KIND_LABEL[item]}
            </button>
          ))}
        </fieldset>
        <div className="jarvis-capture-row">
          <input
            className="jarvis-capture-input"
            aria-label="Capture text"
            placeholder={
              kind === "task"
                ? "Add a task…"
                : kind === "remember"
                  ? "Remember that…"
                  : "Capture a note…"
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="jarvis-capture-submit"
            type="submit"
            disabled={saving || !draft.trim()}
          >
            Save
          </button>
        </div>
        {filed ? <output className="jarvis-capture-filed">Saved to {filed}</output> : null}
        {captureError ? (
          <p className="jarvis-capture-error" role="alert">
            {captureError}
          </p>
        ) : null}
      </form>

      <div className="jarvis-today-block">
        <p className="jarvis-today-label">Open tasks</p>
        {!tasksConfigured ? (
          <p className="jarvis-today-empty">Set OBSIDIAN_VAULT_PATH to track tasks.</p>
        ) : tasks.length === 0 ? (
          <p className="jarvis-today-empty">Inbox is clear.</p>
        ) : (
          <ul className="jarvis-today-tasks">
            {tasks.map((task) => (
              <li key={`${task.path}:${task.line}`}>
                <label className="jarvis-today-task">
                  <input
                    type="checkbox"
                    checked={false}
                    aria-label={`Complete ${task.text}`}
                    onChange={() => void toggleTask(task)}
                  />
                  <span data-stale={task.stale ? "true" : "false"} data-source={task.source}>
                    {task.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="jarvis-today-block">
        <p className="jarvis-today-label">Memory</p>
        {memoryPreview.length === 0 ? (
          <p className="jarvis-today-empty">Nothing saved yet. Use Remember after a chat.</p>
        ) : (
          <ul className="jarvis-today-memory">
            {memoryPreview.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}
      </div>

      {brief ? (
        <div className="jarvis-today-block">
          <p className="jarvis-today-label">Brief</p>
          <p className="jarvis-today-empty">
            {brief.enabled
              ? `Scheduled ${brief.time}${brief.lastBriefDate ? ` · last ${brief.lastBriefDate}` : ""}`
              : "Off — enable in Settings."}
          </p>
        </div>
      ) : null}

      <HomeTilesPanel onTileActivate={onTileActivate} />
    </section>
  );
};
