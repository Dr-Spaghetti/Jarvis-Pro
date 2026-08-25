import { useCallback, useEffect, useState } from "react";

import type { PrimaryNavIndex } from "../../app/constants";
import { apiFetch } from "../../runtime/apiClient";
import {
  buildApprovalActionUrl,
  buildBrainCaptureUrl,
  buildBrainMemoryUrl,
  buildBrainTasksUrl,
  buildBriefConfigUrl,
  buildGmailArchiveUrl,
  buildGmailReplyUrl,
  buildTodayUrl,
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

type MailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  unread: boolean;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
};

type Approval = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  status: string;
};

type LiveList<T> = {
  status: string;
  items: T[];
  unread?: number;
  detail?: string;
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
  const [mail, setMail] = useState<LiveList<MailMessage>>({ status: "ok", items: [] });
  const [agenda, setAgenda] = useState<LiveList<CalendarEvent>>({ status: "ok", items: [] });
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [replyFor, setReplyFor] = useState<MailMessage | null>(null);
  const [replyBody, setReplyBody] = useState("");

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

  const loadLive = useCallback(async () => {
    try {
      const res = await apiFetch(buildTodayUrl());
      if (!res.ok) return;
      const data = (await res.json()) as {
        mail?: LiveList<MailMessage>;
        agenda?: LiveList<CalendarEvent>;
        approvals?: Approval[];
      };
      if (data.mail) setMail({ ...data.mail, items: data.mail.items ?? [] });
      if (data.agenda) setAgenda({ ...data.agenda, items: data.agenda.items ?? [] });
      if (Array.isArray(data.approvals)) setApprovals(data.approvals);
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
    void loadLive();
  }, [loadTasks, loadMemory, loadBrief, loadLive]);

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

  const queueArchive = async (message: MailMessage) => {
    try {
      await apiFetch(buildGmailArchiveUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, subject: message.subject }),
      });
      void loadLive();
    } catch {
      /* ignore */
    }
  };

  const queueReply = async () => {
    if (!replyFor || !replyBody.trim()) return;
    const toMatch = replyFor.from.match(/<([^>]+)>/);
    const to = toMatch?.[1] ?? replyFor.from;
    try {
      await apiFetch(buildGmailReplyUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: replyFor.subject.startsWith("Re:")
            ? replyFor.subject
            : `Re: ${replyFor.subject}`,
          body: replyBody.trim(),
          threadId: replyFor.threadId,
        }),
      });
      setReplyFor(null);
      setReplyBody("");
      void loadLive();
    } catch {
      /* ignore */
    }
  };

  const actOnApproval = async (id: string, action: "approve" | "dismiss") => {
    try {
      await apiFetch(buildApprovalActionUrl(id, action), { method: "POST" });
      void loadLive();
    } catch {
      /* ignore */
    }
  };

  const formatWhen = (value: string): string => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
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

      {approvals.length > 0 ? (
        <div className="jarvis-today-block" aria-label="Pending approvals">
          <p className="jarvis-today-label">Needs approval</p>
          <ul className="jarvis-today-approvals">
            {approvals.map((item) => (
              <li key={item.id} className="jarvis-today-approval">
                <span>
                  {item.title}
                  {item.summary ? ` — ${item.summary}` : ""}
                </span>
                <span className="jarvis-today-approval-actions">
                  <button type="button" onClick={() => void actOnApproval(item.id, "approve")}>
                    Approve
                  </button>
                  <button type="button" onClick={() => void actOnApproval(item.id, "dismiss")}>
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="jarvis-today-block" aria-label="Mail">
        <p className="jarvis-today-label">
          Mail{typeof mail.unread === "number" ? ` · ${mail.unread} unread` : ""}
        </p>
        {mail.status !== "ok" ? (
          <p className="jarvis-today-empty">{mail.detail ?? "Mail unavailable."}</p>
        ) : mail.items.length === 0 ? (
          <p className="jarvis-today-empty">Inbox is quiet.</p>
        ) : (
          <ul className="jarvis-today-mail">
            {mail.items.slice(0, 5).map((message) => (
              <li key={message.id} className="jarvis-today-mail-item" data-unread={message.unread}>
                <span className="jarvis-today-mail-from">{message.from}</span>
                <span className="jarvis-today-mail-subject">{message.subject}</span>
                <span className="jarvis-today-mail-actions">
                  <button type="button" onClick={() => setReplyFor(message)}>
                    Draft
                  </button>
                  <button type="button" onClick={() => void queueArchive(message)}>
                    Archive
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {replyFor ? (
          <form
            className="jarvis-today-reply"
            aria-label="Draft reply"
            onSubmit={(event) => {
              event.preventDefault();
              void queueReply();
            }}
          >
            <p className="jarvis-today-empty">Draft to {replyFor.from}</p>
            <textarea
              aria-label="Reply body"
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              rows={3}
            />
            <span className="jarvis-today-approval-actions">
              <button type="submit" disabled={!replyBody.trim()}>
                Queue send
              </button>
              <button type="button" onClick={() => setReplyFor(null)}>
                Cancel
              </button>
            </span>
          </form>
        ) : null}
      </div>

      <div className="jarvis-today-block" aria-label="Agenda">
        <p className="jarvis-today-label">Next 48 hours</p>
        {agenda.status !== "ok" ? (
          <p className="jarvis-today-empty">{agenda.detail ?? "Calendar unavailable."}</p>
        ) : agenda.items.length === 0 ? (
          <p className="jarvis-today-empty">Nothing scheduled.</p>
        ) : (
          <ul className="jarvis-today-agenda">
            {agenda.items.slice(0, 5).map((event) => (
              <li key={event.id}>
                <span className="jarvis-today-event-when">{formatWhen(event.start)}</span>
                <span>{event.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
