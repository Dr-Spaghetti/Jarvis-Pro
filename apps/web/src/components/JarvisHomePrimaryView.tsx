import { useCallback, useEffect, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import {
  buildBrainCaptureUrl,
  buildBrainNoteUrl,
  buildBrainRecentUrl,
  buildBrainSearchUrl,
  buildDeckSkillsUrl,
  buildDeckTentaclesUrl,
} from "../runtime/runtimeEndpoints";

type BrainNote = { title: string; path: string; modified: string; snippet: string };

type JarvisHomePrimaryViewProps = {
  onNavigate: (index: PrimaryNavIndex) => void;
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
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

export const JarvisHomePrimaryView = ({ onNavigate }: JarvisHomePrimaryViewProps) => {
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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch(buildBrainRecentUrl(12), { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const data = (await res.json()) as { configured?: boolean };
      setConfigured(data.configured !== false);
      setRecent(asNotes(data));
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    (async () => {
      try {
        const res = await fetch(buildDeckSkillsUrl(), { headers: { Accept: "application/json" } });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          if (Array.isArray(data)) setSkillCount(data.length);
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch(buildDeckTentaclesUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          if (Array.isArray(data)) setAgentCount(data.length);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [loadRecent]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length === 0) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(buildBrainSearchUrl(q), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        setResults(asNotes(await res.json()));
      } catch {
        /* ignore */
      }
    }, 220);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const submitCapture = useCallback(async () => {
    const text = capture.trim();
    if (text.length === 0) return;
    setCapturing(true);
    setCaptureMsg(null);
    try {
      const res = await fetch(buildBrainCaptureUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setCapture("");
        setCaptureMsg("Captured to Inbox ✓");
        void loadRecent();
      } else {
        setCaptureMsg("Capture failed");
      }
    } catch {
      setCaptureMsg("Capture failed");
    } finally {
      setCapturing(false);
    }
  }, [capture, loadRecent]);

  const openNoteByPath = useCallback(async (path: string) => {
    try {
      const res = await fetch(buildBrainNoteUrl(path), { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const data = (await res.json()) as { title?: string; content?: string };
      setOpenNote({ title: data.title ?? path, content: data.content ?? "" });
    } catch {
      /* ignore */
    }
  }, []);

  const shown = results ?? recent;

  return (
    <section className="jarvis" aria-label="Jarvis home view">
      <div className="jarvis-inner">
        <header className="jarvis-header">
          <h1 className="jarvis-wordmark">
            JARVIS<span>{" // command center"}</span>
          </h1>
          <div className="jarvis-status">
            <b>● online</b> · {skillCount ?? "—"} skills ready
          </div>
        </header>

        <section className="jarvis-panel jarvis-brain" aria-label="The Brain">
          <p className="jarvis-panel-title">🧠 The Brain — Obsidian</p>

          {openNote ? (
            <>
              <button
                type="button"
                className="jarvis-btn"
                onClick={() => setOpenNote(null)}
                style={{ marginBottom: 12 }}
              >
                ← Back
              </button>
              <h2 style={{ color: "var(--gold)", marginTop: 0 }}>{openNote.title}</h2>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-display)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {openNote.content}
              </pre>
            </>
          ) : (
            <>
              <div className="jarvis-search-row">
                <input
                  className="jarvis-search"
                  type="text"
                  placeholder="Search your brain…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search the vault"
                />
              </div>

              <div className="jarvis-notes">
                {!configured && (
                  <p className="jarvis-empty">
                    No vault connected. Set OBSIDIAN_VAULT_PATH in .env to light up your brain.
                  </p>
                )}
                {configured && shown.length === 0 && (
                  <p className="jarvis-empty">
                    {results === null ? "No notes yet." : "No matches."}
                  </p>
                )}
                {shown.map((note) => (
                  <button
                    type="button"
                    className="jarvis-note"
                    key={note.path}
                    onClick={() => void openNoteByPath(note.path)}
                  >
                    <span className="jarvis-note-title">{note.title}</span>
                    <span className="jarvis-note-meta">
                      {note.path}
                      {note.modified ? ` · ${formatDate(note.modified)}` : ""}
                    </span>
                    {note.snippet && <span className="jarvis-note-snippet">{note.snippet}</span>}
                  </button>
                ))}
              </div>

              <div className="jarvis-capture">
                <input
                  type="text"
                  placeholder="Quick capture to your brain…"
                  value={capture}
                  onChange={(e) => setCapture(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitCapture();
                  }}
                  aria-label="Quick capture"
                />
                <button
                  type="button"
                  className="jarvis-btn"
                  onClick={() => void submitCapture()}
                  disabled={capturing || capture.trim().length === 0}
                >
                  Capture
                </button>
              </div>
              {captureMsg && <p className="jarvis-empty">{captureMsg}</p>}
            </>
          )}
        </section>

        <section className="jarvis-tiles" aria-label="Command tiles">
          <button type="button" className="jarvis-tile" onClick={() => onNavigate(2)}>
            <div className="jarvis-tile-label">Skills</div>
            <div className="jarvis-tile-value">{skillCount ?? "—"}</div>
            <div className="jarvis-tile-sub">Open the deck →</div>
          </button>
          <button type="button" className="jarvis-tile" onClick={() => onNavigate(1)}>
            <div className="jarvis-tile-label">Agents</div>
            <div className="jarvis-tile-value">{agentCount ?? "—"}</div>
            <div className="jarvis-tile-sub">Open the canvas →</div>
          </button>
          <button type="button" className="jarvis-tile" onClick={() => onNavigate(2)}>
            <div className="jarvis-tile-label">Daily Brief</div>
            <div className="jarvis-tile-value">▸</div>
            <div className="jarvis-tile-sub">Run today's brief</div>
          </button>
          <button type="button" className="jarvis-tile" onClick={() => onNavigate(3)}>
            <div className="jarvis-tile-label">Activity</div>
            <div className="jarvis-tile-value">⟳</div>
            <div className="jarvis-tile-sub">Recent activity →</div>
          </button>
        </section>
      </div>
    </section>
  );
};
