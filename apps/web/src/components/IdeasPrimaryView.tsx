import { useCallback, useEffect, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { apiFetch } from "../runtime/apiClient";
import {
  buildBrainAskUrl,
  buildBrainCaptureUrl,
  buildBrainstormExpandUrl,
  buildBrainstormIdeaUrl,
  buildBrainstormIdeasUrl,
  buildWorkflowsUrl,
} from "../runtime/runtimeEndpoints";

type Idea = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created: string;
};

const GREEN = "#39ff14";
const DIM = "rgba(57,255,20,0.25)";
const BORDER = "rgba(57,255,20,0.14)";
const BORDER_DIM = "rgba(57,255,20,0.09)";

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
    borderBottom: `1px solid ${BORDER}`,
    flexShrink: 0,
  },
  hdrTitle: {
    fontSize: 9,
    letterSpacing: "0.28em",
    textTransform: "uppercase" as const,
    color: DIM,
  },
  hdrActions: { display: "flex" as const, gap: 8, alignItems: "center" as const },
  smallBtn: (active = false) => ({
    background: active ? "rgba(57,255,20,0.1)" : "none",
    border: `1px solid ${active ? "rgba(57,255,20,0.35)" : "rgba(57,255,20,0.18)"}`,
    color: active ? GREEN : "rgba(57,255,20,0.45)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "3px 8px",
    cursor: "pointer",
  }),
  captureBar: {
    padding: "10px 14px",
    borderBottom: `1px solid ${BORDER_DIM}`,
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 6,
    flexShrink: 0,
  },
  input: {
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.22)",
    color: "#d0e8d0",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    padding: "6px 10px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  textarea: {
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.16)",
    color: "#c8dcc8",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    padding: "6px 10px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    resize: "vertical" as const,
    minHeight: 52,
  },
  captureRow: {
    display: "flex" as const,
    gap: 8,
    alignItems: "center" as const,
  },
  tagsInput: {
    flex: 1,
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.14)",
    color: "#8ab08a",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    padding: "4px 8px",
    outline: "none",
  },
  saveBtn: (disabled: boolean) => ({
    background: "rgba(57,255,20,0.08)",
    border: "1px solid rgba(57,255,20,0.3)",
    color: GREEN,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "6px 14px",
    cursor: disabled ? ("not-allowed" as const) : ("pointer" as const),
    opacity: disabled ? 0.4 : 1,
    flexShrink: 0,
  }),
  filterRow: {
    display: "flex" as const,
    gap: 6,
    padding: "8px 14px",
    borderBottom: `1px solid ${BORDER_DIM}`,
    flexShrink: 0,
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
  },
  filterLabel: {
    fontSize: 8,
    letterSpacing: "0.18em",
    color: DIM,
    textTransform: "uppercase" as const,
  },
  tagChip: (active: boolean) => ({
    padding: "2px 8px",
    border: `1px solid ${active ? "rgba(57,255,20,0.5)" : "rgba(57,255,20,0.18)"}`,
    background: active ? "rgba(57,255,20,0.1)" : "none",
    color: active ? GREEN : "rgba(57,255,20,0.45)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    cursor: "pointer",
    letterSpacing: "0.08em",
  }),
  list: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "10px 14px",
    minHeight: 0,
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 8,
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
  emptyLabel: { fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase" as const },
  cardToggleBtn: {
    all: "unset" as const,
    display: "block",
    width: "100%",
    cursor: "pointer",
    textAlign: "left" as const,
  },
  card: (expanded: boolean) => ({
    background: "#050705",
    border: `1px solid ${expanded ? "rgba(57,255,20,0.3)" : "rgba(57,255,20,0.1)"}`,
    borderLeft: `2px solid rgba(57,255,20,${expanded ? "0.55" : "0.25"})`,
    padding: "8px 12px",
    cursor: "pointer",
  }),
  cardHeader: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
  },
  cardTitle: {
    fontSize: 11,
    color: "#c8dcc8",
    fontWeight: "bold" as const,
    margin: 0,
    flex: 1,
    wordBreak: "break-word" as const,
  },
  cardMeta: {
    fontSize: 8,
    color: "rgba(57,255,20,0.3)",
    letterSpacing: "0.1em",
    flexShrink: 0,
  },
  cardTags: {
    display: "flex" as const,
    gap: 4,
    marginTop: 4,
    flexWrap: "wrap" as const,
  },
  tagBadge: {
    fontSize: 8,
    color: "rgba(57,255,20,0.5)",
    border: "1px solid rgba(57,255,20,0.2)",
    padding: "1px 5px",
  },
  cardBody: {
    marginTop: 8,
    fontSize: 10,
    color: "#8ab08a",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  cardActions: {
    display: "flex" as const,
    gap: 6,
    marginTop: 8,
    flexWrap: "wrap" as const,
  },
  actionBtn: (variant: "expand" | "edit" | "delete" | "save" | "cancel", disabled = false) => {
    const colors = {
      expand: GREEN,
      edit: "rgba(57,255,20,0.6)",
      delete: "rgba(255,80,80,0.55)",
      save: GREEN,
      cancel: "rgba(57,255,20,0.35)",
    };
    return {
      background: "none",
      border: `1px solid ${colors[variant]}`,
      color: colors[variant],
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 8,
      letterSpacing: "0.12em",
      textTransform: "uppercase" as const,
      padding: "3px 8px",
      cursor: disabled ? ("not-allowed" as const) : ("pointer" as const),
      opacity: disabled ? 0.5 : 1,
    };
  },
  editInput: {
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.25)",
    color: "#d0e8d0",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    padding: "4px 8px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    marginBottom: 6,
  },
  editTextarea: {
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.18)",
    color: "#c8dcc8",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    padding: "6px 8px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    resize: "vertical" as const,
    minHeight: 80,
    marginBottom: 6,
  },
  editTagsInput: {
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.14)",
    color: "#8ab08a",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    padding: "4px 8px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    marginBottom: 6,
  },
  err: { color: "rgba(255,80,80,0.55)", fontSize: 9, margin: 0 },
  status: { color: "rgba(57,255,20,0.45)", fontSize: 9 },
  footer: {
    padding: "5px 14px",
    borderTop: `1px solid ${BORDER_DIM}`,
    fontSize: 8,
    letterSpacing: "0.15em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.2)",
    flexShrink: 0,
  },
  actionRow2: {
    display: "flex" as const,
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap" as const,
    paddingTop: 8,
    borderTop: `1px solid rgba(57,255,20,0.08)`,
  },
  actionBtn2: (variant: "ask" | "workflow" | "brain" | "analyzer", busy = false) => {
    const color = {
      ask: "rgba(57,255,20,0.85)",
      workflow: "rgba(100,210,210,0.65)",
      brain: "rgba(57,255,20,0.5)",
      analyzer: "rgba(210,210,80,0.65)",
    }[variant];
    return {
      background: "none",
      border: `1px solid ${color}`,
      color,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 8,
      letterSpacing: "0.1em",
      textTransform: "uppercase" as const,
      padding: "4px 9px",
      cursor: busy ? ("not-allowed" as const) : ("pointer" as const),
      opacity: busy ? 0.55 : 1,
    };
  },
  ideaAnswer: {
    marginTop: 10,
    padding: "8px 10px",
    background: "rgba(57,255,20,0.04)",
    borderLeft: "2px solid rgba(57,255,20,0.3)",
  },
  ideaAnswerLabel: {
    fontSize: 7,
    letterSpacing: "0.22em",
    color: "rgba(57,255,20,0.38)",
    margin: "0 0 5px",
    textTransform: "uppercase" as const,
  },
  ideaAnswerText: {
    fontSize: 10,
    color: "rgba(57,255,20,0.72)",
    margin: 0,
    lineHeight: 1.65,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  inlineMsg: (ok: boolean) => ({
    fontSize: 9,
    color: ok ? "rgba(57,255,20,0.6)" : "rgba(255,80,80,0.55)",
    margin: "5px 0 0",
    letterSpacing: "0.06em",
  }),
};

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
};

const parseTags = (raw: string): string[] =>
  raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

export const IdeasPrimaryView = ({ onNavigate }: { onNavigate: (index: PrimaryNavIndex) => void }) => {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTags, setNewTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Action pipeline state
  const [askingIdeaId, setAskingIdeaId] = useState<string | null>(null);
  const [ideaAnswers, setIdeaAnswers] = useState<Record<string, string>>({});
  const [brainSavingId, setBrainSavingId] = useState<string | null>(null);
  const [brainSaveMsg, setBrainSaveMsg] = useState<Record<string, string>>({});
  const [workflowCreatingId, setWorkflowCreatingId] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  const fetchIdeas = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(buildBrainstormIdeasUrl());
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { configured: boolean; ideas: Idea[] };
      setConfigured(data.configured);
      setIdeas(data.ideas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchIdeas();
  }, [fetchIdeas]);

  const handleSave = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || isSaving) return;
    setIsSaving(true);
    try {
      const res = await apiFetch(buildBrainstormIdeasUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body: newBody.trim(), tags: parseTags(newTags) }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setNewTitle("");
      setNewBody("");
      setNewTags("");
      setSaveFeedback("Saved");
      setTimeout(() => setSaveFeedback(null), 1800);
      void fetchIdeas();
    } catch {
      setSaveFeedback("Error");
      setTimeout(() => setSaveFeedback(null), 1800);
    } finally {
      setIsSaving(false);
    }
  }, [newTitle, newBody, newTags, isSaving, fetchIdeas]);

  const startEdit = useCallback((idea: Idea) => {
    setEditingId(idea.id);
    setEditTitle(idea.title);
    setEditBody(idea.body.replace(/\n\n## AI Expansion[\s\S]*$/, "").trim());
    setEditTags(idea.tags.join(", "));
  }, []);

  const handleUpdate = useCallback(
    async (id: string) => {
      const title = editTitle.trim();
      if (!title || isUpdating) return;
      setIsUpdating(true);
      try {
        const res = await apiFetch(buildBrainstormIdeaUrl(id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body: editBody.trim(), tags: parseTags(editTags) }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        setEditingId(null);
        void fetchIdeas();
      } catch {
        // stay in edit mode on error
      } finally {
        setIsUpdating(false);
      }
    },
    [editTitle, editBody, editTags, isUpdating, fetchIdeas],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await apiFetch(buildBrainstormIdeaUrl(id), { method: "DELETE" });
        if (expandedId === id) setExpandedId(null);
        void fetchIdeas();
      } catch {
        // ignore
      } finally {
        setDeletingId(null);
      }
    },
    [expandedId, fetchIdeas],
  );

  const handleExpand = useCallback(
    async (id: string) => {
      setExpandingId(id);
      setExpandError(null);
      try {
        const res = await apiFetch(buildBrainstormExpandUrl(id), { method: "POST" });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error ?? `HTTP ${res.status}`);
        }
        void fetchIdeas();
      } catch (e) {
        setExpandError(e instanceof Error ? e.message : "Expansion failed");
        setTimeout(() => setExpandError(null), 5000);
      } finally {
        setExpandingId(null);
      }
    },
    [fetchIdeas],
  );

  const handleAskJarvis = useCallback(async (idea: Idea) => {
    if (askingIdeaId === idea.id) return;
    setAskingIdeaId(idea.id);
    try {
      const question = idea.body
        ? `Regarding this idea: "${idea.title}"\n\n${idea.body}\n\nWhat are the most important next steps and considerations?`
        : `What are the most important next steps and considerations for this idea: "${idea.title}"?`;
      const res = await apiFetch(buildBrainAskUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        setIdeaAnswers((prev) => ({ ...prev, [idea.id]: "Ask failed — check that a brain model is configured." }));
        return;
      }
      const data = (await res.json()) as { answer?: string; available?: boolean; hint?: string };
      if (data.available && typeof data.answer === "string") {
        setIdeaAnswers((prev) => ({ ...prev, [idea.id]: data.answer as string }));
      } else {
        setIdeaAnswers((prev) => ({ ...prev, [idea.id]: data.hint ?? "No answer model available." }));
      }
    } catch {
      setIdeaAnswers((prev) => ({ ...prev, [idea.id]: "Error reaching Jarvis." }));
    } finally {
      setAskingIdeaId(null);
    }
  }, [askingIdeaId]);

  const handleCreateWorkflow = useCallback(async (idea: Idea) => {
    if (workflowCreatingId === idea.id) return;
    setWorkflowCreatingId(idea.id);
    try {
      await apiFetch(buildWorkflowsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: idea.title,
          description: idea.body || "",
          steps: [
            `Research and validate: ${idea.title}`,
            "Identify the key risks and obstacles",
            "Outline 3–5 concrete next steps",
          ].join("\n"),
        }),
      });
    } catch {
      // swallow — navigate anyway
    } finally {
      setWorkflowCreatingId(null);
      onNavigate(3);
    }
  }, [workflowCreatingId, onNavigate]);

  const handleSaveToBrain = useCallback(async (idea: Idea) => {
    if (brainSavingId === idea.id) return;
    setBrainSavingId(idea.id);
    const text = idea.body ? `${idea.title}\n\n${idea.body}` : idea.title;
    try {
      const res = await apiFetch(buildBrainCaptureUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const msg = res.ok ? "✓ Saved to brain inbox" : "⚠ Save failed";
      setBrainSaveMsg((prev) => ({ ...prev, [idea.id]: msg }));
    } catch {
      setBrainSaveMsg((prev) => ({ ...prev, [idea.id]: "⚠ Error" }));
    } finally {
      setBrainSavingId(null);
      setTimeout(() => setBrainSaveMsg((prev) => { const n = { ...prev }; delete n[idea.id]; return n; }), 2500);
    }
  }, [brainSavingId]);

  const handleOpenInAnalyzer = useCallback((idea: Idea) => {
    const text = idea.body ? `${idea.title}\n\n${idea.body}` : idea.title;
    try { void navigator.clipboard.writeText(text); } catch { /* ignore */ }
    onNavigate(5);
  }, [onNavigate]);

  const allTags = Array.from(new Set(ideas.flatMap((i) => i.tags))).sort();
  const filtered = activeTag ? ideas.filter((i) => i.tags.includes(activeTag)) : ideas;

  return (
    <section className="ideas-view" aria-label="Ideas primary view" style={s.panel}>
      <header style={s.hdr}>
        <span style={s.hdrTitle}>⬢ Ideas / Brainstorm</span>
        <div style={s.hdrActions}>
          <button type="button" style={s.smallBtn()} onClick={() => void fetchIdeas()}>
            ↺ Refresh
          </button>
        </div>
      </header>

      <div style={s.captureBar}>
        <input
          ref={titleRef}
          type="text"
          style={s.input}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) void handleSave();
          }}
          placeholder="Idea title…"
          aria-label="New idea title"
        />
        <textarea
          style={s.textarea}
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Describe the idea (optional)…"
          aria-label="New idea body"
          rows={2}
        />
        <div style={s.captureRow}>
          <input
            type="text"
            style={s.tagsInput}
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            placeholder="Tags: comma-separated…"
            aria-label="New idea tags"
          />
          <button
            type="button"
            style={s.saveBtn(isSaving || !newTitle.trim())}
            disabled={isSaving || !newTitle.trim()}
            onClick={() => void handleSave()}
          >
            {saveFeedback ?? "Save Idea"}
          </button>
        </div>
      </div>

      {allTags.length > 0 && (
        <div style={s.filterRow}>
          <span style={s.filterLabel}>Filter:</span>
          <button
            type="button"
            style={s.tagChip(activeTag === null)}
            onClick={() => setActiveTag(null)}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              style={s.tagChip(activeTag === tag)}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div style={s.list}>
        {isLoading ? (
          <p style={s.status}>Loading ideas…</p>
        ) : error ? (
          <p style={s.err}>⚠ {error}</p>
        ) : !configured ? (
          <div style={s.empty}>
            <span style={s.emptyIcon}>⬢</span>
            <span style={s.emptyLabel}>Set OBSIDIAN_VAULT_PATH to enable Ideas</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            <span style={s.emptyIcon}>⬢</span>
            <span style={s.emptyLabel}>
              {activeTag ? "No ideas with this tag" : "No ideas yet"}
            </span>
          </div>
        ) : (
          filtered.map((idea) => {
            const isExpanded = expandedId === idea.id;
            const isEditing = editingId === idea.id;
            const isExpandingThis = expandingId === idea.id;
            const isDeletingThis = deletingId === idea.id;

            return (
              <article key={idea.id} style={s.card(isExpanded || isEditing)}>
                <button
                  type="button"
                  style={s.cardToggleBtn}
                  aria-expanded={isExpanded}
                  onClick={() => {
                    if (!isEditing) setExpandedId(isExpanded ? null : idea.id);
                  }}
                >
                  <div style={s.cardHeader}>
                    <p style={s.cardTitle}>{idea.title}</p>
                    <span style={s.cardMeta}>{fmtDate(idea.created)}</span>
                  </div>

                  {idea.tags.length > 0 && (
                    <div style={s.cardTags}>
                      {idea.tags.map((tag) => (
                        <span key={tag} style={s.tagBadge}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>

                {(isExpanded || isEditing) && (
                  <section aria-label="Idea detail">
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          style={s.editInput}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          aria-label="Edit idea title"
                        />
                        <textarea
                          style={s.editTextarea}
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          aria-label="Edit idea body"
                        />
                        <input
                          type="text"
                          style={s.editTagsInput}
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="Tags: comma-separated"
                          aria-label="Edit idea tags"
                        />
                        <div style={s.cardActions}>
                          <button
                            type="button"
                            style={s.actionBtn("save", isUpdating)}
                            disabled={isUpdating || !editTitle.trim()}
                            onClick={() => void handleUpdate(idea.id)}
                          >
                            {isUpdating ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            style={s.actionBtn("cancel")}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p style={s.cardBody}>{idea.body}</p>
                        <div style={s.cardActions}>
                          <button
                            type="button"
                            style={s.actionBtn("expand", isExpandingThis)}
                            disabled={isExpandingThis}
                            onClick={() => void handleExpand(idea.id)}
                          >
                            {isExpandingThis ? "Expanding…" : "Expand with AI"}
                          </button>
                          <button
                            type="button"
                            style={s.actionBtn("edit")}
                            onClick={() => startEdit(idea)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            style={s.actionBtn("delete", isDeletingThis)}
                            disabled={isDeletingThis}
                            onClick={() => void handleDelete(idea.id)}
                          >
                            {isDeletingThis ? "Deleting…" : "Delete"}
                          </button>
                        </div>

                        {/* Action pipeline */}
                        <div style={s.actionRow2}>
                          <button
                            type="button"
                            style={s.actionBtn2("ask", askingIdeaId === idea.id)}
                            disabled={askingIdeaId === idea.id}
                            onClick={() => void handleAskJarvis(idea)}
                          >
                            {askingIdeaId === idea.id ? "Asking…" : "◆ Ask Jarvis"}
                          </button>
                          <button
                            type="button"
                            style={s.actionBtn2("workflow", workflowCreatingId === idea.id)}
                            disabled={workflowCreatingId === idea.id}
                            onClick={() => void handleCreateWorkflow(idea)}
                          >
                            {workflowCreatingId === idea.id ? "Creating…" : "⟐ → Workflow"}
                          </button>
                          <button
                            type="button"
                            style={s.actionBtn2("brain", brainSavingId === idea.id)}
                            disabled={brainSavingId === idea.id}
                            onClick={() => void handleSaveToBrain(idea)}
                          >
                            {brainSavingId === idea.id ? "Saving…" : "◈ → Brain"}
                          </button>
                          <button
                            type="button"
                            style={s.actionBtn2("analyzer")}
                            onClick={() => handleOpenInAnalyzer(idea)}
                          >
                            ⊞ → Analyzer
                          </button>
                        </div>

                        {brainSaveMsg[idea.id] != null && (
                          <p style={s.inlineMsg((brainSaveMsg[idea.id] ?? "").startsWith("✓"))}>
                            {brainSaveMsg[idea.id]}
                          </p>
                        )}

                        {ideaAnswers[idea.id] && (
                          <div style={s.ideaAnswer}>
                            <p style={s.ideaAnswerLabel}>◆ Jarvis says</p>
                            <p style={s.ideaAnswerText}>{ideaAnswers[idea.id]}</p>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}
              </article>
            );
          })
        )}
      </div>

      {expandError && <p style={s.err}>⚠ Expand failed: {expandError}</p>}

      <footer style={s.footer}>
        {!isLoading && !error && configured
          ? `${filtered.length} idea${filtered.length !== 1 ? "s" : ""}${activeTag ? ` — ${activeTag}` : ""}`
          : "ideas / brainstorm"}
      </footer>
    </section>
  );
};
