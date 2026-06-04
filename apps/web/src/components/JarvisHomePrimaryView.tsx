import { useCallback, useEffect, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import {
  buildBrainAskUrl,
  buildBrainCaptureUrl,
  buildBrainDigestUrl,
  buildBrainJournalUrl,
  buildBrainMemoryUrl,
  buildBrainNoteUrl,
  buildBrainRecentUrl,
  buildBrainSemanticUrl,
  buildDeckSkillsUrl,
  buildDeckTentaclesUrl,
  buildVoiceConfigUrl,
  buildVoiceIntentUrl,
  buildVoiceSpeakUrl,
  buildVoiceTranscribeUrl,
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
  transcription: {
    configured: boolean;
    defaultModel: string;
    models: string[];
    whisperSupported: boolean;
  };
  tts: {
    configured: boolean;
    fallback: string;
    providers?: string[];
    recommended?: string;
  };
};
type JarvisIntentResolution = {
  transcript: string;
  commandText: string;
  intent:
    | {
        type: "navigate";
        target:
          | "agents"
          | "deck"
          | "activity"
          | "code-intel"
          | "monitor"
          | "conversations"
          | "prompts"
          | "settings"
          | "jarvis";
      }
    | { type: "brain-search"; query: string }
    | { type: "brain-capture"; text: string }
    | { type: "create-terminal"; workspaceMode: "shared" | "worktree" }
    | { type: "unknown"; text: string };
};
type SpeechRecognitionResultLike = {
  readonly isFinal?: boolean;
  readonly 0?: { readonly transcript?: string };
};
type SpeechRecognitionEventLike = {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type JarvisHomePrimaryViewProps = {
  onNavigate: (index: PrimaryNavIndex) => void;
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

const formatTimeAgo = (iso: string): string => {
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

const voiceNavTargets: Record<
  Extract<JarvisIntentResolution["intent"], { type: "navigate" }>["target"],
  PrimaryNavIndex
> = {
  jarvis: 9,
  agents: 1,
  deck: 2,
  activity: 3,
  "code-intel": 4,
  monitor: 5,
  conversations: 6,
  prompts: 7,
  settings: 8,
};

const normalizeVoiceText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
};

const extractCommandAfterWake = (transcript: string, phrases: string[]): string | null => {
  const normalized = normalizeVoiceText(transcript);
  for (const phrase of phrases) {
    const index = normalized.indexOf(phrase);
    if (index === -1) continue;
    return normalized.slice(index + phrase.length).trim();
  }
  return null;
};

const hasWakePhrase = (transcript: string, phrases: string[]): boolean =>
  extractCommandAfterWake(transcript, phrases) !== null;

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
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<{ title: string; path: string }[]>([]);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceModel, setVoiceModel] = useState<string | null>(null);
  const [ttsProvider, setTtsProvider] = useState<string>(() => {
    try {
      return window.localStorage.getItem("jarvis.ttsProvider") ?? "";
    } catch {
      return "";
    }
  });
  const [voiceStatus, setVoiceStatus] = useState("Voice idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isWakeArmed, setIsWakeArmed] = useState(false);
  const [isRecordingCommand, setIsRecordingCommand] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
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
      try {
        const res = await fetch(buildBrainJournalUrl(6), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { entries?: unknown };
          if (Array.isArray(data.entries)) setJournal(data.entries as JournalEntry[]);
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch(buildBrainMemoryUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { items?: unknown };
          if (Array.isArray(data.items)) setMemoryCount(data.items.length);
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch(buildBrainDigestUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { tasks?: { openCount?: unknown } };
          if (typeof data.tasks?.openCount === "number") setOpenTaskCount(data.tasks.openCount);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [loadRecent]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(buildVoiceConfigUrl(), { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const config = (await res.json()) as VoiceConfig;
        setVoiceConfig(config);
        setVoiceModel(config.transcription.defaultModel);
        // Keep a saved choice; otherwise default to the recommended provider.
        setTtsProvider((prev) => prev || config.tts.recommended || "browser");
      } catch {
        setVoiceError("Voice config unavailable");
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (recordingTimerRef.current !== null) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      for (const track of mediaStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length === 0) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(buildBrainSemanticUrl(q), {
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

  const submitAsk = useCallback(async () => {
    const question = ask.trim();
    if (question.length === 0) return;
    setAsking(true);
    setAnswer(null);
    setAnswerSources([]);
    setAskNote(null);
    try {
      const res = await fetch(buildBrainAskUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        setAskNote("Ask failed");
        return;
      }
      const data = (await res.json()) as {
        available?: boolean;
        answer?: string;
        hint?: string;
        sources?: { title: string; path: string }[];
      };
      if (data.available && typeof data.answer === "string") {
        setAnswer(data.answer);
        setAnswerSources(Array.isArray(data.sources) ? data.sources : []);
      } else {
        setAskNote(
          data.hint ?? "No local chat model is running. Pull one with: ollama pull qwen2.5:7b",
        );
      }
    } catch {
      setAskNote("Ask failed");
    } finally {
      setAsking(false);
    }
  }, [ask]);

  const speakJarvis = useCallback(
    async (text: string) => {
      if (ttsProvider !== "browser") {
        try {
          const response = await fetch(buildVoiceSpeakUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, provider: ttsProvider }),
          });
          if (response.ok) {
            const objectUrl = URL.createObjectURL(await response.blob());
            const audio = new Audio(objectUrl);
            audio.addEventListener("ended", () => URL.revokeObjectURL(objectUrl), { once: true });
            void audio.play().catch(() => URL.revokeObjectURL(objectUrl));
            return;
          }
        } catch {
          // Fall back to browser speech synthesis below.
        }
      }

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    },
    [ttsProvider],
  );

  const runVoiceIntent = useCallback(
    async (transcript: string) => {
      setVoiceError(null);
      setLastVoiceTranscript(transcript);
      const intentResponse = await fetch(buildVoiceIntentUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!intentResponse.ok) {
        setVoiceError("Unable to resolve command");
        return;
      }
      const resolution = (await intentResponse.json()) as JarvisIntentResolution;
      const intent = resolution.intent;

      if (intent.type === "navigate") {
        onNavigate(voiceNavTargets[intent.target]);
        setVoiceStatus(`Opened ${intent.target}`);
        await speakJarvis(`Opening ${intent.target}.`);
        return;
      }

      if (intent.type === "brain-search") {
        setQuery(intent.query);
        setVoiceStatus("Searching brain");
        await speakJarvis("Searching your brain.");
        return;
      }

      if (intent.type === "brain-capture") {
        const response = await fetch(buildBrainCaptureUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: intent.text }),
        });
        if (!response.ok) {
          setVoiceError("Capture failed");
          return;
        }
        setCaptureMsg("Captured to Inbox");
        void loadRecent();
        setVoiceStatus("Captured");
        await speakJarvis("Captured.");
        return;
      }

      if (intent.type === "create-terminal") {
        const response = await fetch("/api/terminals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceMode: intent.workspaceMode,
            tentacleId: "octoboss",
          }),
        });
        if (!response.ok) {
          setVoiceError("Unable to create agent");
          return;
        }
        onNavigate(1);
        setVoiceStatus("Agent created");
        await speakJarvis("Agent created.");
        return;
      }

      setVoiceStatus("Command captured");
      setVoiceError(intent.text ? `No action matched: ${intent.text}` : "No action matched");
      await speakJarvis("I heard you, but I do not have that command wired yet.");
    },
    [loadRecent, onNavigate, speakJarvis],
  );

  const transcribeCommandAudio = useCallback(
    async (audio: Blob) => {
      const model = voiceModel ?? voiceConfig?.transcription.defaultModel ?? null;
      if (!voiceConfig?.transcription.configured) {
        setVoiceError("Set OPENAI_API_KEY to enable Whisper transcription");
        setVoiceStatus("Transcription unavailable");
        return;
      }
      setVoiceStatus("Transcribing");
      const response = await fetch(buildVoiceTranscribeUrl(model), {
        method: "POST",
        headers: { "Content-Type": audio.type || "audio/webm" },
        body: audio,
      });
      if (!response.ok) {
        setVoiceError("Transcription failed");
        setVoiceStatus("Voice idle");
        return;
      }
      const result = (await response.json()) as { text?: string };
      const transcript = result.text?.trim();
      if (!transcript) {
        setVoiceError("No speech detected");
        setVoiceStatus("Voice idle");
        return;
      }
      setVoiceStatus("Command received");
      await runVoiceIntent(transcript);
    },
    [runVoiceIntent, voiceConfig, voiceModel],
  );

  const stopCommandRecording = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startCommandRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone capture is unavailable in this browser");
      return;
    }
    setVoiceError(null);
    setVoiceStatus("Listening for command");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];
    mediaRecorderRef.current = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      setIsRecordingCommand(false);
      for (const track of stream.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
      const audio = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      void transcribeCommandAudio(audio);
    });
    setIsRecordingCommand(true);
    recorder.start();
    recordingTimerRef.current = window.setTimeout(() => {
      stopCommandRecording();
    }, 7000);
  }, [stopCommandRecording, transcribeCommandAudio]);

  const stopWakeListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsWakeArmed(false);
    setVoiceStatus("Voice idle");
  }, []);

  const startWakeListening = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError("Wake phrase detection is unavailable in this browser");
      return;
    }
    setVoiceError(null);
    const recognition = new Recognition();
    const phrases = voiceConfig?.wake.phrases ?? ["jarvis", "yo jarvis", "heyo jarvis"];
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcripts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript;
        if (transcript) transcripts.push(transcript);
      }
      const transcript = transcripts.join(" ");
      setLastVoiceTranscript(transcript);
      if (!hasWakePhrase(transcript, phrases)) return;

      const commandAfterWake = extractCommandAfterWake(transcript, phrases);
      recognition.stop();
      setIsWakeArmed(false);
      if (commandAfterWake && commandAfterWake.split(/\s+/).length >= 2) {
        void runVoiceIntent(commandAfterWake);
        return;
      }
      void startCommandRecording();
    };
    recognition.onerror = (event) => {
      setVoiceError(event.error ?? "Wake listener error");
      setIsWakeArmed(false);
    };
    recognition.onend = () => {
      setIsWakeArmed(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsWakeArmed(true);
    setVoiceStatus("Wake armed");
  }, [runVoiceIntent, startCommandRecording, voiceConfig]);

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
            <b>● online</b> · {skillCount ?? "—"} skills · {memoryCount ?? 0} memories
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
                    {answerSources.length > 0 && (
                      <div className="jarvis-answer-sources">
                        {answerSources.map((source) => (
                          <button
                            type="button"
                            className="jarvis-answer-source"
                            key={source.path}
                            onClick={() => void openNoteByPath(source.path)}
                          >
                            {source.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {askNote && <p className="jarvis-empty">{askNote}</p>}
              </div>

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

        <section className="jarvis-panel jarvis-voice" aria-label="Jarvis voice control">
          <div className="jarvis-voice-header">
            <p className="jarvis-panel-title">Voice</p>
            <span className="jarvis-voice-status">{voiceStatus}</span>
          </div>

          <div className="jarvis-voice-controls">
            <button
              type="button"
              className="jarvis-btn"
              onClick={isWakeArmed ? stopWakeListening : startWakeListening}
              disabled={isRecordingCommand}
            >
              {isWakeArmed ? "Disarm" : "Arm Wake"}
            </button>
            <button
              type="button"
              className="jarvis-btn jarvis-btn--secondary"
              onClick={() => void startCommandRecording()}
              disabled={isRecordingCommand}
            >
              Command
            </button>
            <button
              type="button"
              className="jarvis-btn jarvis-btn--secondary"
              onClick={stopCommandRecording}
              disabled={!isRecordingCommand}
            >
              Stop
            </button>
            <select
              className="jarvis-select"
              value={voiceModel ?? ""}
              onChange={(event) => setVoiceModel(event.target.value)}
              aria-label="Transcription model"
            >
              {(voiceConfig?.transcription.models ?? ["gpt-4o-mini-transcribe", "whisper-1"]).map(
                (model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ),
              )}
            </select>
            <select
              className="jarvis-select"
              value={ttsProvider}
              onChange={(event) => {
                const value = event.target.value;
                setTtsProvider(value);
                try {
                  window.localStorage.setItem("jarvis.ttsProvider", value);
                } catch {
                  /* ignore */
                }
              }}
              aria-label="Voice output"
            >
              {(voiceConfig?.tts.providers ?? ["browser"]).map((provider) => (
                <option key={provider} value={provider}>
                  {provider === "openai"
                    ? "OpenAI voice"
                    : provider === "deepgram"
                      ? "Deepgram voice"
                      : provider === "elevenlabs"
                        ? "ElevenLabs voice"
                        : provider === "piper"
                          ? "Piper (local)"
                          : "Browser voice"}
                </option>
              ))}
            </select>
          </div>

          <div className="jarvis-voice-grid">
            <span>
              Wake:{" "}
              {getSpeechRecognitionConstructor()
                ? (voiceConfig?.wake.phrases ?? ["jarvis"]).join(", ")
                : "unavailable"}
            </span>
            <span>
              STT:{" "}
              {voiceConfig?.transcription.configured
                ? `ready (${voiceModel ?? voiceConfig.transcription.defaultModel})`
                : "needs OPENAI_API_KEY"}
            </span>
            <span>TTS: {voiceConfig?.tts.configured ? "ElevenLabs" : "browser fallback"}</span>
          </div>

          {lastVoiceTranscript && <p className="jarvis-voice-transcript">{lastVoiceTranscript}</p>}
          {voiceError && <p className="jarvis-empty">{voiceError}</p>}
        </section>

        <section className="jarvis-panel jarvis-activity" aria-label="Recent activity">
          <p className="jarvis-panel-title">Activity</p>
          {journal.length === 0 ? (
            <p className="jarvis-empty">
              No activity logged yet. Skills and Jarvis actions will appear here.
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
            <div className="jarvis-tile-value">{openTaskCount ?? "▸"}</div>
            <div className="jarvis-tile-sub">
              {openTaskCount === null ? "Run today's brief" : `${openTaskCount} open tasks →`}
            </div>
          </button>
          <button type="button" className="jarvis-tile" onClick={() => onNavigate(3)}>
            <div className="jarvis-tile-label">Activity</div>
            <div className="jarvis-tile-value">{journal.length || "—"}</div>
            <div className="jarvis-tile-sub">Recent activity →</div>
          </button>
        </section>
      </div>
    </section>
  );
};
