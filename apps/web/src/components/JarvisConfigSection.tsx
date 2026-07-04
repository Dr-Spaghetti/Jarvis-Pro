import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import {
  buildBrainAskUrl,
  buildBrainCaptureUrl,
  buildBrainJournalUrl,
  buildBrainMemoryUrl,
  buildBrainModelsUrl,
  buildBrainNoteUrl,
  buildBrainRecentUrl,
  buildBrainSemanticUrl,
  buildCreditsStatusUrl,
  buildDeckSkillsUrl,
  buildDeckTentaclesUrl,
  buildVoiceConfigUrl,
  buildVoiceSpeakUrl,
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
  tts: { configured: boolean; providers?: string[]; configuredProviders?: string[] };
  brain?: { provider: string; webSearch: boolean };
};

const LS_KEYS = {
  ttsProvider: "jarvis.ttsProvider",
  deepgramVoice: "jarvis.deepgramVoice",
  chatModel: "jarvis.chatModel",
  voiceModel: "jarvis.voiceModel",
  openaiVoice: "jarvis.openaiVoice",
  elevenlabsVoiceId: "jarvis.elevenlabsVoiceId",
} as const;

const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
const OPENAI_TTS_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"] as const;


const ELEVENLABS_PRESET_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel — Calm American female" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi — Warm American female" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella — Soft British female" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni — Deep American male" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold — Confident American male" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam — Neutral American male" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam — Raspy American male" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh — Deep American male" },
  { id: "2EiwWnXFnvU5JabPnv8n", name: "Clyde — War veteran male" },
  { id: "GBv7mTt0atIp3Br8iCZE", name: "Thomas — Calm British male" },
] as const;

const lsGet = (key: string) => {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const lsSet = (key: string, val: string) => {
  try {
    window.localStorage.setItem(key, val);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: val }));
  } catch {
    /* ignore */
  }
};

type VoiceSettingsPanelProps = { voiceConfig: VoiceConfig };

const VoiceSettingsPanel = ({ voiceConfig }: VoiceSettingsPanelProps) => {
  const [ttsProvider, setTtsProvider] = useState(() => lsGet(LS_KEYS.ttsProvider) || "elevenlabs");
  const [voiceModel, setVoiceModel] = useState(
    () => lsGet(LS_KEYS.voiceModel) || voiceConfig.transcription.defaultModel,
  );
  const [chatModel, setChatModel] = useState(() => lsGet(LS_KEYS.chatModel) || "claude-sonnet-4-6");
  const [openaiVoice, setOpenaiVoice] = useState(() => lsGet(LS_KEYS.openaiVoice) || "alloy");
  const [openaiTtsModel, setOpenaiTtsModel] = useState<string>("gpt-4o-mini-tts");
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState(() =>
    lsGet(LS_KEYS.elevenlabsVoiceId),
  );
  const [elevenlabsPreset, setElevenlabsPreset] = useState(
    () => lsGet(LS_KEYS.elevenlabsVoiceId) || ELEVENLABS_PRESET_VOICES[0].id,
  );
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [claudeModelsList, setClaudeModelsList] = useState<string[]>([]);
  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    void apiFetch(buildBrainModelsUrl())
      .then((r) => r.json())
      .then((d: { models?: string[]; claudeModels?: string[]; ollamaRunning?: boolean }) => {
        setAvailableModels(d.models ?? []);
        setClaudeModelsList(d.claudeModels ?? []);
        setOllamaRunning(d.ollamaRunning ?? false);
      })
      .catch(() => {});
  }, []);

  const SHOWN_PROVIDERS = ["elevenlabs", "openai", "browser"];
  const allProviders = (voiceConfig.tts.providers ?? ["elevenlabs", "openai", "browser"]).filter(
    (p) => SHOWN_PROVIDERS.includes(p),
  );
  const configuredProviders = voiceConfig.tts.configuredProviders ?? [];
  const isProviderConfigured = (p: string) => configuredProviders.includes(p);
  const effectiveProvider =
    ttsProvider || configuredProviders.find((p) => p !== "browser") || "elevenlabs";

  const save = () => {
    lsSet(LS_KEYS.ttsProvider, ttsProvider);
    lsSet(LS_KEYS.voiceModel, voiceModel);
    lsSet(LS_KEYS.chatModel, chatModel);
    lsSet(LS_KEYS.openaiVoice, openaiVoice);
    lsSet(LS_KEYS.elevenlabsVoiceId, elevenlabsVoiceId || elevenlabsPreset);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const previewVoice = async () => {
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const body: Record<string, string> = {
        text: "Jarvis online. Voice systems ready.",
        provider: effectiveProvider,
      };
      if (effectiveProvider === "openai") { body.voice = openaiVoice; body.model = openaiTtsModel; }
      if (effectiveProvider === "elevenlabs") body.voiceId = elevenlabsVoiceId || elevenlabsPreset;
      const res = await apiFetch(buildVoiceSpeakUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string; detail?: string };
        const detail = err.detail ? ` — ${err.detail.slice(0, 120)}` : "";
        throw new Error((err.error ?? "Preview failed") + detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const rowStyle = { display: "flex", flexDirection: "column" as const, gap: 4, marginBottom: 14 };
  const labelStyle = {
    fontSize: 9,
    letterSpacing: ".14em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.38)",
    fontFamily: "var(--font-display)",
  };
  const selectStyle = {
    fontFamily: "var(--font-display)",
    fontSize: 11,
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.25)",
    color: "#c8dcc8",
    padding: "5px 8px",
    cursor: "pointer" as const,
  };
  const statusDot = (ok: boolean) => (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: ok ? "#39ff14" : "rgba(255,80,80,0.7)",
        boxShadow: ok ? "0 0 6px #39ff14" : "none",
        marginRight: 6,
      }}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Status pills */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-display)",
            color: voiceConfig.transcription.configured ? "#39ff14" : "rgba(255,80,80,0.7)",
          }}
        >
          {statusDot(voiceConfig.transcription.configured)}STT:{" "}
          {voiceConfig.transcription.configured
            ? voiceConfig.transcription.defaultModel
            : "needs DEEPGRAM_API_KEY or OPENAI_API_KEY"}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-display)",
            color: voiceConfig.tts.configured ? "#39ff14" : "rgba(57,255,20,0.4)",
          }}
        >
          {statusDot(voiceConfig.tts.configured)}TTS:{" "}
          {voiceConfig.tts.configured ? configuredProviders.filter((p) => p !== "browser").join(", ") : "browser fallback"}
        </span>
        <span
          style={{ fontSize: 10, fontFamily: "var(--font-display)", color: "rgba(57,255,20,0.5)" }}
        >
          {statusDot(true)}Wake: {voiceConfig.wake.phrases.slice(0, 2).join(", ")}
        </span>
      </div>

      {/* TTS Provider — always shown with all providers */}
      <div style={rowStyle}>
        <label htmlFor="voice-tts-provider" style={labelStyle}>
          TTS Provider
        </label>
        <select
          id="voice-tts-provider"
          style={selectStyle}
          value={effectiveProvider}
          onChange={(e) => setTtsProvider(e.target.value)}
        >
          {allProviders.map((p) => (
            <option key={p} value={p}>
              {p === "browser"
                ? "browser (built-in, no key needed)"
                : isProviderConfigured(p)
                  ? `${p} ✓`
                  : `${p} — needs key`}
            </option>
          ))}
        </select>
      </div>

      {/* OpenAI TTS — voice + model dropdowns */}
      {effectiveProvider === "openai" && (
        <>
          <div style={rowStyle}>
            <label htmlFor="voice-openai-voice" style={labelStyle}>
              OpenAI TTS Voice
            </label>
            <select
              id="voice-openai-voice"
              style={selectStyle}
              value={openaiVoice}
              onChange={(e) => setOpenaiVoice(e.target.value)}
            >
              {OPENAI_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div style={rowStyle}>
            <label htmlFor="voice-openai-tts-model" style={labelStyle}>
              OpenAI TTS Model
            </label>
            <select
              id="voice-openai-tts-model"
              style={selectStyle}
              value={openaiTtsModel}
              onChange={(e) => setOpenaiTtsModel(e.target.value)}
            >
              {OPENAI_TTS_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* ElevenLabs — preset dropdown + optional custom ID */}
      {effectiveProvider === "elevenlabs" && (
        <>
          <div style={rowStyle}>
            <label htmlFor="voice-elevenlabs-preset" style={labelStyle}>
              ElevenLabs Voice
            </label>
            <select
              id="voice-elevenlabs-preset"
              style={selectStyle}
              value={elevenlabsPreset}
              onChange={(e) => {
                setElevenlabsPreset(e.target.value);
                if (!elevenlabsVoiceId) setElevenlabsVoiceId("");
              }}
            >
              {ELEVENLABS_PRESET_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div style={rowStyle}>
            <label htmlFor="voice-elevenlabs-id" style={labelStyle}>
              Custom Voice ID (overrides preset)
            </label>
            <input
              id="voice-elevenlabs-id"
              type="text"
              style={{ ...selectStyle, border: "1px solid rgba(57,255,20,0.25)" }}
              value={elevenlabsVoiceId}
              placeholder="e.g. EXAVITQu4vr4xnSDxMaL"
              onChange={(e) => setElevenlabsVoiceId(e.target.value)}
            />
            <span
              style={{ fontSize: 9, color: "rgba(57,255,20,0.28)", fontFamily: "var(--font-display)" }}
            >
              Leave blank to use the preset above
            </span>
          </div>
        </>
      )}


      {/* Preview button */}
      {effectiveProvider !== "browser" && (
        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            className="jarvis-btn"
            onClick={() => { void previewVoice(); }}
            disabled={previewLoading}
            style={{ fontSize: 10, padding: "4px 12px" }}
          >
            {previewLoading ? "▶ playing…" : "▶ Preview voice"}
          </button>
          {previewError && (
            <span style={{ fontSize: 10, color: "rgba(255,80,80,0.8)", fontFamily: "var(--font-display)", marginLeft: 10 }}>
              {previewError}
            </span>
          )}
        </div>
      )}

      {/* Transcription model — always shown */}
      {voiceConfig.transcription.models.length > 1 && (
        <div style={rowStyle}>
          <label htmlFor="voice-transcription-model" style={labelStyle}>
            Transcription Model
          </label>
          <select
            id="voice-transcription-model"
            style={selectStyle}
            value={voiceModel}
            onChange={(e) => setVoiceModel(e.target.value)}
          >
            {voiceConfig.transcription.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      {!voiceConfig.transcription.configured && (
        <p
          style={{
            fontSize: 11,
            color: "rgba(255,80,80,0.65)",
            fontFamily: "var(--font-display)",
            margin: "0 0 14px",
          }}
        >
          ⚠ Set{" "}
          <code style={{ background: "rgba(255,80,80,0.08)", padding: "0 4px" }}>
            DEEPGRAM_API_KEY
          </code>{" "}
          or{" "}
          <code style={{ background: "rgba(255,80,80,0.08)", padding: "0 4px" }}>
            OPENAI_API_KEY
          </code>{" "}
          in <code style={{ background: "rgba(255,80,80,0.08)", padding: "0 4px" }}>.env</code> to
          enable voice transcription. The tap-to-talk button uses the browser mic as a fallback.
        </p>
      )}

      {/* Chat / Answer model */}
      <div style={rowStyle}>
        <label htmlFor="voice-chat-model" style={labelStyle}>
          Chat / Answer Model
        </label>
        {ollamaRunning === false && (
          <span style={{ fontSize: 9, color: "var(--term-red, #ff4444)", letterSpacing: ".1em", fontFamily: "var(--font-display)" }}>
            OLLAMA OFFLINE — run <code style={{ background: "rgba(255,80,80,0.08)", padding: "0 3px" }}>ollama serve</code> in a terminal to use local models
          </span>
        )}
        <select
          id="voice-chat-model"
          style={selectStyle}
          value={chatModel}
          onChange={(e) => setChatModel(e.target.value)}
        >
          <option value="">Auto (server default)</option>
          {claudeModelsList.length > 0 && (
            <optgroup label="── Claude (cloud) ──">
              {claudeModelsList.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </optgroup>
          )}
          {availableModels.length > 0 && (
            <optgroup label="── Ollama (local) ──">
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </optgroup>
          )}
        </select>
        <span
          style={{ fontSize: 9, color: "rgba(57,255,20,0.28)", fontFamily: "var(--font-display)" }}
        >
          Model Jarvis uses when answering questions and in voice mode
        </span>
      </div>

      <button
        type="button"
        className="jarvis-btn"
        onClick={save}
        style={{ alignSelf: "flex-start", marginTop: 4 }}
      >
        {saved ? "✓ Saved" : "Save voice settings"}
      </button>
      <p
        style={{
          fontSize: 9,
          color: "rgba(57,255,20,0.25)",
          fontFamily: "var(--font-display)",
          marginTop: 8,
        }}
      >
        Changes apply immediately — no reload needed.
      </p>
    </div>
  );
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
  type CreditStatus = { status: "ok" | "out-of-credits" | "invalid-key" | "not-configured" | "error"; note?: string };
  type CreditsData = { elevenlabs?: CreditStatus; openai?: CreditStatus; anthropic?: CreditStatus; perplexity?: CreditStatus; deepgram?: CreditStatus };
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);

  const refreshCredits = useCallback(() => {
    setCreditsLoading(true);
    void apiFetch(buildCreditsStatusUrl())
      .then((r) => r.json())
      .then((d) => { setCredits(d as CreditsData); setCreditsLoading(false); })
      .catch(() => setCreditsLoading(false));
  }, []);

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
    if (!query.trim()) {
      setResults(null);
      return;
    }
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
      {/* ── Sphere ── */}
      <div style={{ position: "relative", height: 220, overflow: "hidden", marginBottom: 20 }}>
        <div
          className="nc-core"
          style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
          aria-hidden="true"
        >
          <div className="nc-core-ring" />
          <div className="nc-core-ring nc-core-ring--mid" />
          <div className="nc-core-ring nc-core-ring--inner" />
          <div className="nc-core-orb">
            <div className="nc-core-center-dot" />
          </div>
        </div>
      </div>

      {/* ── Brain ── */}
      <details>
        <summary
          style={{
            color: "var(--gold)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: ".1em",
            cursor: "pointer",
            userSelect: "none",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          🧠 THE BRAIN — OBSIDIAN
          <span
            style={{
              fontSize: 9,
              fontWeight: 400,
              letterSpacing: ".12em",
              padding: "2px 7px",
              border: `1px solid ${configured ? "rgba(57,255,20,0.4)" : "rgba(255,80,80,0.4)"}`,
              color: configured ? "#39ff14" : "rgba(255,80,80,0.7)",
              background: configured ? "rgba(57,255,20,0.06)" : "rgba(255,80,80,0.06)",
              fontFamily: "var(--font-display)",
            }}
          >
            {configured ? "CONNECTED" : "NOT CONNECTED"}
          </span>
        </summary>

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
            <div className="jarvis-ask">
              <div className="jarvis-ask-row">
                <input
                  className="jarvis-search"
                  type="text"
                  placeholder="Ask Jarvis anything about your brain…"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitAsk();
                  }}
                  aria-label="Ask Jarvis"
                />
                <button
                  type="button"
                  className="jarvis-btn"
                  onClick={() => void submitAsk()}
                  disabled={asking || ask.trim().length === 0}
                >
                  {asking ? "Thinking…" : "Ask"}
                </button>
              </div>
              {answer && (
                <div className="jarvis-answer">
                  <p className="jarvis-answer-text">{answer}</p>
                </div>
              )}
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
              {!configured && (
                <p className="jarvis-empty">No vault connected. Set OBSIDIAN_VAULT_PATH in .env.</p>
              )}
              {configured && shown.length === 0 && (
                <p className="jarvis-empty">{results === null ? "No notes yet." : "No matches."}</p>
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

            <div className="jarvis-capture" style={{ marginTop: 12 }}>
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
      </details>

      {/* ── Memory ── */}
      <details style={{ marginTop: 20 }}>
        <summary
          style={{
            color: "var(--gold)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: ".1em",
            cursor: "pointer",
            userSelect: "none",
            marginBottom: 12,
          }}
        >
          🧠 WHAT JARVIS REMEMBERS
        </summary>
        {memoryItems.length === 0 ? (
          <p className="jarvis-empty">
            Nothing taught yet. Say "Jarvis, remember that…" to add a memory.
          </p>
        ) : (
          <ul className="jarvis-memory-list">
            {memoryItems.map((item) => (
              <li className="jarvis-memory-item" key={item}>
                {item}
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* ── Voice config ── */}
      <details open style={{ marginTop: 20 }}>
        <summary
          style={{
            color: "var(--gold)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: ".1em",
            cursor: "pointer",
            userSelect: "none",
            marginBottom: 12,
          }}
        >
          🎙 VOICE CONFIGURATION
        </summary>
        {voiceConfig ? (
          <VoiceSettingsPanel voiceConfig={voiceConfig} />
        ) : (
          <p className="jarvis-empty">Loading voice config…</p>
        )}
      </details>

      {/* ── Credits & Usage ── */}
      <details style={{ marginTop: 20 }}>
        <summary
          style={{
            color: "var(--gold)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: ".1em",
            cursor: "pointer",
            userSelect: "none",
            marginBottom: 12,
          }}
          onClick={() => { if (!credits && !creditsLoading) refreshCredits(); }}
        >
          💰 CREDITS &amp; API STATUS
        </summary>
        {!credits && !creditsLoading && (
          <p className="jarvis-empty" style={{ marginBottom: 8 }}>Click to check live status of all connected services.</p>
        )}
        {creditsLoading && <p className="jarvis-empty">Checking all services…</p>}
        {credits && (() => {
          const rows: { key: keyof CreditsData; label: string; use: string; link: string }[] = [
            { key: "anthropic",  label: "Anthropic (Claude)",  use: "AI reasoning",     link: "https://console.anthropic.com/settings/billing" },
            { key: "perplexity", label: "Perplexity",          use: "Web search",       link: "https://www.perplexity.ai/settings/api" },
            { key: "elevenlabs", label: "ElevenLabs",          use: "Voice (TTS)",      link: "https://elevenlabs.io/billing" },
            { key: "openai",     label: "OpenAI",              use: "TTS fallback",     link: "https://platform.openai.com/usage" },
            { key: "deepgram",   label: "Deepgram",            use: "Transcription",    link: "https://console.deepgram.com" },
          ];
          const statusColor = (s?: CreditStatus) => {
            if (!s || s.status === "not-configured") return "#555";
            if (s.status === "ok") return "#39ff14";
            if (s.status === "out-of-credits") return "#ff6b35";
            if (s.status === "invalid-key") return "rgba(255,80,80,0.9)";
            return "rgba(255,200,80,0.9)";
          };
          const statusLabel = (s?: CreditStatus) => {
            if (!s || s.status === "not-configured") return "Not configured";
            if (s.status === "ok") return "✓ Working";
            if (s.status === "out-of-credits") return "⚠ Out of credits";
            if (s.status === "invalid-key") return "✗ Invalid key";
            return `Error${s.note ? `: ${s.note}` : ""}`;
          };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map(({ key, label, use, link }) => {
                const s = credits[key];
                const color = statusColor(s);
                const notConfigured = !s || s.status === "not-configured";
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, opacity: notConfigured ? 0.45 : 1 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: s?.status === "ok" ? `0 0 6px ${color}` : "none", flexShrink: 0, display: "inline-block" }} />
                    <span style={{ flex: 1, fontSize: 12, color: "#ccc" }}>
                      <strong style={{ color: "#eee" }}>{label}</strong>
                      <span style={{ color: "#888", marginLeft: 6 }}>{use}</span>
                    </span>
                    <span style={{ fontSize: 11, color, fontWeight: 600 }}>{statusLabel(s)}</span>
                    {s && s.status !== "not-configured" && s.status !== "ok" && (
                      <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "var(--gold)", textDecoration: "underline", marginLeft: 4 }}>Top up →</a>
                    )}
                  </div>
                );
              })}
              <button
                onClick={refreshCredits}
                disabled={creditsLoading}
                style={{ marginTop: 8, alignSelf: "flex-start", fontSize: 11, padding: "3px 10px", background: "transparent", border: "1px solid var(--gold)", color: "var(--gold)", cursor: "pointer", borderRadius: 3 }}
              >
                {creditsLoading ? "Checking…" : "↺ Refresh"}
              </button>
            </div>
          );
        })()}
      </details>

      {/* ── Activity ── */}
      <details style={{ marginTop: 20 }}>
        <summary
          style={{
            color: "var(--gold)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: ".1em",
            cursor: "pointer",
            userSelect: "none",
            marginBottom: 12,
          }}
        >
          ⚡ ACTIVITY LOG
        </summary>
        {journal.length === 0 ? (
          <p className="jarvis-empty">
            No activity logged yet. Skills and Jarvis actions appear here.
          </p>
        ) : (
          <ul className="jarvis-activity-list">
            {journal.map((entry) => (
              <li
                className="jarvis-activity-row"
                key={`${entry.ts}:${entry.skill ?? ""}:${entry.action}`}
              >
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
