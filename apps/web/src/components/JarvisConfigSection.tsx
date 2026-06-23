import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import {
  buildBrainAskUrl,
  buildBrainCaptureUrl,
  buildBrainJournalUrl,
  buildBrainMemoryUrl,
  buildBrainNoteUrl,
  buildBrainRecentUrl,
  buildBrainSemanticUrl,
  buildDeckSkillsUrl,
  buildDeckTentaclesUrl,
  buildVoiceConfigUrl,
} from "../runtime/runtimeEndpoints";

type BrainNote = { title: string; path: string; modified: string; snippet: string };
type JournalEntry = {
  ts: string;
  status: "ok" | "warn" | "error";
  skill: string | null;
  action: string;
  detail: string | null;
};
type VoiceConfig = {
  wake: { phrases: string[] };
  transcription: { configured: boolean; defaultModel: string; models: string[] };
  tts: { configured: boolean; providers?: string[] };
  brain?: { provider: string; webSearch: boolean };
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

const formatTimeAgo = (iso: string) => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const asNotes = (value: unknown): BrainNote[] => {
  if (!value || typeof value !== "object") return [];
  const notes = (value as { notes?: unknown }).notes;
  if (!Array.isArray(notes)) return [];
  return notes.filter(
    (n): n is BrainNote =>
      Boolean(n) &&
      typeof (n as BrainNote).title === "string" &&
      typeof (n as BrainNote).path === "string",
  );
};

export const JarvisConfigSection = () => {
  const [recent, setRecent] = useState<BrainNote[]>([]);
  const [results, setResults] = useState<BrainNote[] | null>(null);
  const [query, setQuery] = useState("");
  const [configured, setConfigured] = useState(true);
  const [skillCount, setSkillCount] = useState<number | null>(null);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [capture, setCapture] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<{ title: string; content: string } | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [memoryItems, setMemoryItems] = useState<string[]>([]);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);

  useEffect(() => {
    void apiFetch(buildBrainRecentUrl())
      .then((r) => r.json())
      .then((d) => {
        setRecent(asNotes(d));
        setConfigured((d as { configured?: boolean }).configured !== false);
      })
      .catch(() => setConfigured(false));

    void apiFetch(buildDeckSkillsUrl())
      .then((r) => r.json())
      .then((d) => setSkillCount((d as { skills?: unknown[] }).skills?.length ?? 0))
      .catch(() => {});

    void apiFetch(buildDeckTentaclesUrl())
      .then((r) => r.json())
      .then((d) => setAgentCount((d as { tentacles?: unknown[] }).tentacles?.length ?? 0))
      .catch(() => {});

    void apiFetch(buildBrainJournalUrl())
      .then((r) => r.json())
      .then((d) => setJournal((d as { entries?: JournalEntry[] }).entries ?? []))
      .catch(() => {});

    void apiFetch(buildBrainMemoryUrl())
      .then((r) => r.json())
      .then((d) => setMemoryItems((d as { items?: string[] }).items ?? []))
      .catch(() => {});

    void apiFetch(buildVoiceConfigUrl())
      .then((r) => r.json())
      .then((d) => setVoiceConfig(d as VoiceConfig))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const t = setTimeout(() => {
      void apiFetch(buildBrainSemanticUrl(query))
        .then((r) => r.json())
        .then((d) => setResults(asNotes(d)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const submitAsk = useCallback(async () => {
    if (!ask.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    setAskNote(null);
    try {
      const res = await apiFetch(buildBrainAskUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: ask }),
      });
      const data = (await res.json()) as { answer?: string; note?: string };
      setAnswer(data.answer ?? null);
      setAskNote(data.note ?? null);
      setAsk("");
    } catch {
      setAskNote("Error contacting Jarvis.");
    } finally {
      setAsking(false);
    }
  }, [ask, asking]);

  const submitCapture = useCallback(async () => {
    if (!capture.trim() || capturing) return;
    setCapturing(true);
    setCaptureMsg(null);
    try {
      await apiFetch(buildBrainCaptureUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: capture }),
      });
      setCapture("");
      setCaptureMsg("Captured.");
      setTimeout(() => setCaptureMsg(null), 2000);
    } catch {
      setCaptureMsg("Capture failed.");
    } finally {
      setCapturing(false);
    }
  }, [capture, capturing]);

  const openNoteByPath = useCallback(async (path: string) => {
    try {
      const res = await apiFetch(buildBrainNoteUrl(path));
      const data = (await res.json()) as { title?: string; content?: string };
      setOpenNote({ title: data.title ?? path, content: data.content ?? "" });
    } catch {
      /* ignore */
    }
  }, []);

  const shown = results ?? recent;

  return (
    <section className="settings-panel" aria-label="Jarvis interface">
      <header className="settings-panel-header">
        <h2>JARVIS INTERFACE</h2>
        <p>Brain, voice, memory, and activity panels — functional controls for Jarvis.</p>
      </header>

      {/* ── Status tiles ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Skills", value: skillCount ?? "—" },
          { label: "Agents", value: agentCount ?? "—" },
          { label: "Memories", value: memoryItems.length || "—" },
          { label: "Activity", value: journal.length || "—" },
        ].map(({ label, value }) => (
          <div key={label} className="jarvis-tile" style={{ cursor: "default" }}>
            <div className="jarvis-tile-label">{label}</div>
            <div className="jarvis-tile-value">{value}</div>
          </div>
        ))}
      </div>

      {/* ── Brain ── */}
      <details open>
        <summary style={{ color: "var(--gold)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, letterSpacing: ".1em", cursor: "pointer", userSelect: "none", marginBottom: 12 }}>
          🧠 THE BRAIN — OBSIDIAN
        </summary>

        {openNote ? (
          <>
            <button type="button" className="jarvis-btn" onClick={() => setOpenNote(null)} style={{ marginBottom: 12 }}>← Back</button>
            <h2 style={{ color: "var(--gold)", marginTop: 0 }}>{openNote.title}</h2>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-display)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{openNote.content}</pre>
          </>
        ) : (
          <>
            <div className="jarvis-ask">
              <div className="jarvis-ask-row">
                <input
                  className="jarvis-search"
                  type="text"
                  placeholder="Ask Jarvis anything about your brain…"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitAsk(); }}
                  aria-label="Ask Jarvis"
                />
                <button type="button" className="jarvis-btn" onClick={() => void submitAsk()} disabled={asking || ask.trim().length === 0}>
                  {asking ? "Thinking…" : "Ask"}
                </button>
              </div>
              {answer && <div className="jarvis-answer"><p className="jarvis-answer-text">{answer}</p></div>}
              {askNote && <p className="jarvis-empty">{askNote}</p>}
            </div>

            <div className="jarvis-search-row" style={{ marginTop: 12 }}>
              <input
                className="jarvis-search"
                type="text"
                placeholder="Search your brain…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search the vault"
              />
            </div>

            <div className="jarvis-notes" style={{ marginTop: 8 }}>
              {!configured && <p className="jarvis-empty">No vault connected. Set OBSIDIAN_VAULT_PATH in .env.</p>}
              {configured && shown.length === 0 && <p className="jarvis-empty">{results === null ? "No notes yet." : "No matches."}</p>}
              {shown.map((note) => (
                <button type="button" className="jarvis-note" key={note.path} onClick={() => void openNoteByPath(note.path)}>
                  <span className="jarvis-note-title">{note.title}</span>
                  <span className="jarvis-note-meta">{note.path}{note.modified ? ` · ${formatDate(note.modified)}` : ""}</span>
                  {note.snippet && <span className="jarvis-note-snippet">{note.snippet}</span>}
                </button>
              ))}
            </div>

            <div className="jarvis-capture" style={{ marginTop: 12 }}>
              <input
                type="text"
                placeholder="Quick capture to your brain…"
                value={capture}
                onChange={(e) => setCapture(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submitCapture(); }}
                aria-label="Quick capture"
              />
              <button type="button" className="jarvis-btn" onClick={() => void submitCapture()} disabled={capturing || capture.trim().length === 0}>
                Capture
              </button>
            </div>
            {captureMsg && <p className="jarvis-empty">{captureMsg}</p>}
          </>
        )}
      </details>

      {/* ── Memory ── */}
      <details style={{ marginTop: 20 }}>
        <summary style={{ color: "var(--gold)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, letterSpacing: ".1em", cursor: "pointer", userSelect: "none", marginBottom: 12 }}>
          🧠 WHAT JARVIS REMEMBERS
        </summary>
        {memoryItems.length === 0 ? (
          <p className="jarvis-empty">Nothing taught yet. Say "Jarvis, remember that…" to add a memory.</p>
        ) : (
          <ul className="jarvis-memory-list">
            {memoryItems.map((item) => <li className="jarvis-memory-item" key={item}>{item}</li>)}
          </ul>
        )}
      </details>

      {/* ── Voice config ── */}
      <details style={{ marginTop: 20 }}>
        <summary style={{ color: "var(--gold)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, letterSpacing: ".1em", cursor: "pointer", userSelect: "none", marginBottom: 12 }}>
          🎙 VOICE CONFIGURATION
        </summary>
        {voiceConfig ? (
          <div className="jarvis-voice-grid">
            <span>Wake phrases: {voiceConfig.wake.phrases.join(", ")}</span>
            <span>STT: {voiceConfig.transcription.configured ? `ready (${voiceConfig.transcription.defaultModel})` : "needs OPENAI_API_KEY"}</span>
            <span>TTS: {voiceConfig.tts.configured ? (voiceConfig.tts.providers ?? []).join(", ") : "browser fallback"}</span>
            <span>Brain: {voiceConfig.brain ? `${voiceConfig.brain.provider}${voiceConfig.brain.webSearch ? " · web" : ""}` : "—"}</span>
          </div>
        ) : (
          <p className="jarvis-empty">Loading voice config…</p>
        )}
      </details>

      {/* ── Activity ── */}
      <details style={{ marginTop: 20 }}>
        <summary style={{ color: "var(--gold)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, letterSpacing: ".1em", cursor: "pointer", userSelect: "none", marginBottom: 12 }}>
          ⚡ ACTIVITY LOG
        </summary>
        {journal.length === 0 ? (
          <p className="jarvis-empty">No activity logged yet. Skills and Jarvis actions appear here.</p>
        ) : (
          <ul className="jarvis-activity-list">
            {journal.map((entry) => (
              <li className="jarvis-activity-row" key={`${entry.ts}:${entry.skill ?? ""}:${entry.action}`}>
                <span className="jarvis-activity-dot" data-status={entry.status} />
                <span className="jarvis-activity-action">{entry.action}</span>
                {entry.skill && <span className="jarvis-activity-skill">{entry.skill}</span>}
                <span className="jarvis-activity-time">{formatTimeAgo(entry.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
};
