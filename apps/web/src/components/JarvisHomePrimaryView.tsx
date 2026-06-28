import { useCallback, useEffect, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { VOICE_PHASE_LABELS, deriveVoicePhase, shouldResumeWakeLoop } from "../app/voicePhase";
import { apiFetch } from "../runtime/apiClient";

import {
  buildBrainAskUrl,
  buildBrainCaptureUrl,
  buildBrainConversationUrl,
  buildBrainDigestUrl,
  buildBrainJournalUrl,
  buildBrainMemoryUrl,
  buildBrainModelsUrl,
  buildBrainNoteUrl,
  buildBrainRecentUrl,
  buildBrainRememberUrl,
  buildBrainSemanticUrl,
  buildDeckSkillsUrl,
  buildDeckTentaclesUrl,
  buildNotificationsUrl,
  buildSkillsRunUrl,
  buildJarvisConversationTurnUrl,
  buildVoiceConfigUrl,
  buildVoiceIntentUrl,
  buildVoiceSpeakUrl,
  buildVoiceTranscribeUrl,
  buildVoiceVoicesUrl,
  buildWorkflowRunsRecentUrl,
} from "../runtime/runtimeEndpoints";

type BrainNote = { title: string; path: string; modified: string; snippet: string };
type ConversationTurn = { time: string; question: string; answer: string };
type RecentWorkflowRun = {
  id: string;
  workflowName: string;
  startedAt: string;
  completedAt: string;
  status: "ok" | "error";
  steps: { step: string; answer: string }[];
};

function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
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
  brain?: { provider: string; webSearch: boolean };
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
    | { type: "remember"; text: string }
    | { type: "create-terminal"; workspaceMode: "shared" | "worktree" }
    | { type: "run-skill"; skillName: string }
    | { type: "run-workflow"; workflowName: string }
    | { type: "ask"; question: string }
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

type PendingVoiceIntent = {
  displayLabel: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  expiresAt: number;
};

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

const pushNotification = (title: string, detail?: string): void => {
  apiFetch(buildNotificationsUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "action", title, detail }),
  })
    .then(() => {
      const ts = Date.now().toString();
      try { window.localStorage.setItem("jarvis.lastNotificationAt", ts); } catch { /* ignore */ }
      window.dispatchEvent(new StorageEvent("storage", { key: "jarvis.lastNotificationAt", newValue: ts }));
    })
    .catch(() => {});
};

const voiceNavTargets: Record<
  Extract<JarvisIntentResolution["intent"], { type: "navigate" }>["target"],
  PrimaryNavIndex
> = {
  jarvis: 9,
  agents: 1,
  deck: 1,
  activity: 2,
  "code-intel": 5,
  monitor: 2,
  conversations: 4,
  prompts: 6,
  settings: 7,
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
  const [visMode, setVisMode] = useState<"core" | "radar" | "signal">("core");
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
  const [recentRuns, setRecentRuns] = useState<RecentWorkflowRun[]>([]);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<{ title: string; path: string }[]>([]);
  const [answerCitations, setAnswerCitations] = useState<{ title: string; url: string }[]>([]);
  const [answerVia, setAnswerVia] = useState<string | null>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [jarvisSessionId, setJarvisSessionId] = useState<string>(() => {
    try {
      const stored = window.localStorage.getItem("jarvis.sessionId");
      if (stored) return stored;
      const fresh = `jarvis-${Date.now()}`;
      window.localStorage.setItem("jarvis.sessionId", fresh);
      return fresh;
    } catch {
      return `jarvis-${Date.now()}`;
    }
  });
  const [memoryItems, setMemoryItems] = useState<string[]>([]);
  const [pendingVoiceIntent, setPendingVoiceIntent] = useState<PendingVoiceIntent | null>(null);
  const [intentCountdown, setIntentCountdown] = useState(10);
  const pendingVoiceIntentRef = useRef<PendingVoiceIntent | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  // Which local Ollama model answers. Empty = server default. Persisted so the
  // choice sticks; mirrored to a ref so the voice loop reads it without re-binding.
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [chatModel, setChatModel] = useState<string>(() => {
    try {
      return window.localStorage.getItem("jarvis.chatModel") ?? "";
    } catch {
      return "";
    }
  });
  const chatModelRef = useRef("");
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceModel, setVoiceModel] = useState<string | null>(null);
  const [ttsProvider, setTtsProvider] = useState<string>(() => {
    try {
      return window.localStorage.getItem("jarvis.ttsProvider") ?? "";
    } catch {
      return "";
    }
  });
  const [deepgramVoice, setDeepgramVoice] = useState<string>(() => {
    try {
      return window.localStorage.getItem("jarvis.deepgramVoice") ?? "";
    } catch {
      return "";
    }
  });
  const [deepgramVoices, setDeepgramVoices] = useState<
    { id: string; name: string; description: string }[]
  >([]);
  const [voiceStatus, setVoiceStatus] = useState("Voice idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isWakeArmed, setIsWakeArmed] = useState(false);
  const [isRecordingCommand, setIsRecordingCommand] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState("");
  // Persistent hands-free mode: one click starts it, then Jarvis keeps listening
  // for the wake word, answers, and goes back to listening — no more clicking.
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  // When autoplay is blocked, we keep the last answer's audio so the user can
  // play it with a direct tap (which browsers always allow).
  const [canReplay, setCanReplay] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  // Live mirrors of loop state so async callbacks read current values, not
  // stale closures. Plus a handle on in-flight audio for hard mute.
  const isListeningRef = useRef(false);
  const isRecordingCommandRef = useRef(false);
  const isMutedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const startWakeListeningRef = useRef<(() => void) | null>(null);
  const startCommandRecordingRef = useRef<(() => void) | null>(null);
  const speakJarvisRef = useRef<((text: string) => Promise<void>) | null>(null);
  // Audio unlock: the first user gesture (any voice button) primes audio so
  // later TTS playback is never blocked by the browser's autoplay policy.
  const audioUnlockedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Last spoken answer's audio, kept for the manual "Replay" affordance.
  const pendingAudioBlobRef = useRef<Blob | null>(null);

  const voicePhase = deriveVoicePhase({
    isMuted,
    isSpeaking,
    isThinking,
    isRecordingCommand,
    isWakeArmed,
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainRecentUrl(12), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { configured?: boolean };
      setConfigured(data.configured !== false);
      setRecent(asNotes(data));
    } catch {
      // silently ignore
    }
  }, []);

  // Pull today's conversation thread so the user can see the whole exchange and
  // Obsidian keeps the record. Refreshed after each ask.
  const loadConversation = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainConversationUrl(50), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { turns?: ConversationTurn[] };
      if (Array.isArray(data.turns)) setConversation(data.turns);
    } catch {
      // silently ignore
    }
  }, []);

  // Durable things Jarvis has been taught (facts, preferences, corrections). These
  // are injected into every answer as standing rules, so showing them builds trust.
  const loadMemory = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainMemoryUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: unknown };
      if (Array.isArray(data.items)) {
        const items = data.items.filter((x): x is string => typeof x === "string");
        setMemoryItems(items);
        setMemoryCount(items.length);
      }
    } catch {
      // silently ignore
    }
  }, []);

  const loadJournal = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainJournalUrl(6), {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { entries?: unknown };
        if (Array.isArray(data.entries)) setJournal(data.entries as JournalEntry[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadRecentRuns = useCallback(async () => {
    try {
      const res = await apiFetch(buildWorkflowRunsRecentUrl(), {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { runs?: unknown };
        if (Array.isArray(data.runs)) setRecentRuns(data.runs as RecentWorkflowRun[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    void loadConversation();
    (async () => {
      try {
        const res = await apiFetch(buildDeckSkillsUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          if (Array.isArray(data)) setSkillCount(data.length);
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await apiFetch(buildDeckTentaclesUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          if (Array.isArray(data)) setAgentCount(data.length);
        }
      } catch {
        /* ignore */
      }
      void loadJournal();
      void loadMemory();
      void loadRecentRuns();
      try {
        const res = await apiFetch(buildBrainDigestUrl(), {
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
  }, [loadRecent, loadConversation, loadMemory, loadJournal, loadRecentRuns]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(buildVoiceConfigUrl(), {
          headers: { Accept: "application/json" },
        });
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
    (async () => {
      try {
        const res = await apiFetch(buildVoiceVoicesUrl(), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          voices?: { id: string; name: string; description: string }[];
        };
        setDeepgramVoices(data.voices ?? []);
      } catch {
        // voices are optional; ignore
      }
    })();
  }, []);

  // Sync voice settings changed from the Settings tab (written to localStorage).
  // Also refresh journal when Analyzer (or any other tab) logs a new entry.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jarvis.ttsProvider" && e.newValue !== null) setTtsProvider(e.newValue);
      if (e.key === "jarvis.deepgramVoice" && e.newValue !== null) setDeepgramVoice(e.newValue);
      if (e.key === "jarvis.chatModel" && e.newValue !== null) setChatModel(e.newValue);
      if (e.key === "jarvis.voiceModel" && e.newValue !== null) setVoiceModel(e.newValue);
      if (e.key === "jarvis.lastJournalEntry") void loadJournal();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadJournal]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  useEffect(() => {
    isRecordingCommandRef.current = isRecordingCommand;
  }, [isRecordingCommand]);
  useEffect(() => {
    chatModelRef.current = chatModel;
  }, [chatModel]);

  useEffect(() => {
    pendingVoiceIntentRef.current = pendingVoiceIntent;
  }, [pendingVoiceIntent]);

  // 10-second auto-expire countdown. Fires every 250ms when an intent is pending.
  useEffect(() => {
    if (!pendingVoiceIntent) return;
    setIntentCountdown(Math.ceil((pendingVoiceIntent.expiresAt - Date.now()) / 1000));
    const interval = window.setInterval(() => {
      const remaining = Math.ceil((pendingVoiceIntentRef.current?.expiresAt ?? Date.now()) - Date.now()) / 1000;
      if (remaining <= 0) {
        setPendingVoiceIntent(null);
        setIntentCountdown(10);
        speakJarvisRef.current?.("Cancelled.").catch(() => {});
        clearInterval(interval);
        return;
      }
      setIntentCountdown(Math.ceil(remaining));
    }, 250);
    return () => clearInterval(interval);
  }, [pendingVoiceIntent]);

  // Load the list of installed Ollama chat models for the answer-model picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(buildBrainModelsUrl(), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { models?: string[]; claudeModels?: string[] };
        if (Array.isArray(data.models)) setChatModels(data.models);
        if (Array.isArray(data.claudeModels)) setClaudeModels(data.claudeModels);
        // If the persisted selection is no longer available (e.g. API key removed),
        // clear it so the dropdown defaults to Auto instead of silently erroring.
        const allValid = [...(data.claudeModels ?? []), ...(data.models ?? [])];
        setChatModel((prev) => {
          if (!prev || allValid.includes(prev)) return prev;
          try {
            window.localStorage.removeItem("jarvis.chatModel");
          } catch {
            /* ignore */
          }
          return "";
        });
      } catch {
        /* ignore — picker just shows the default */
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

  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length === 0) {
      setResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(buildBrainSemanticUrl(q), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          setIsSearching(false);
          return;
        }
        setResults(asNotes(await res.json()));
        setIsSearching(false);
      } catch {
        setIsSearching(false);
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
      const res = await apiFetch(buildBrainCaptureUrl(), {
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
    setAnswerCitations([]);
    setAnswerVia(null);
    setSourcesExpanded(false);
    setAskNote(null);
    const askedAt = new Date().toISOString();
    try {
      const res = await apiFetch(buildBrainAskUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatModel ? { question, model: chatModel } : { question }),
      });
      if (!res.ok) {
        setAskNote("Ask failed");
        return;
      }
      const data = (await res.json()) as {
        available?: boolean;
        answer?: string;
        hint?: string;
        via?: string;
        sources?: { title: string; path: string }[];
        citations?: { title: string; url: string }[];
      };
      if (data.available && typeof data.answer === "string") {
        const cleanAnswer = stripMarkdownForSpeech(data.answer);
        const answeredAt = new Date().toISOString();
        setAnswer(cleanAnswer);
        setAnswerSources(Array.isArray(data.sources) ? data.sources : []);
        setAnswerCitations(Array.isArray(data.citations) ? data.citations : []);
        setAnswerVia(typeof data.via === "string" ? data.via : null);
        void loadConversation();
        // Persist turn to transcripts so it appears in Recent Convos.
        // On success, dispatch a storage event so the Recent Convos tab refreshes live.
        void apiFetch(buildJarvisConversationTurnUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: jarvisSessionId,
            question,
            answer: cleanAnswer,
            askedAt,
            answeredAt,
          }),
        }).then((r) => {
          if (!r.ok) return;
          const ts = new Date().toISOString();
          try { window.localStorage.setItem("jarvis.lastTurnAt", ts); } catch { /* ignore */ }
          window.dispatchEvent(new StorageEvent("storage", { key: "jarvis.lastTurnAt", newValue: ts }));
        });
        // Auto-speak the clean answer when running hands-free.
        if (isListeningRef.current && !isMutedRef.current) {
          void speakJarvisRef.current?.(cleanAnswer);
        }
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
  }, [ask, chatModel, jarvisSessionId, loadConversation]);

  // Prime audio playback inside a real user gesture so the browser's autoplay
  // policy never blocks Jarvis from speaking later (TTS fires from async
  // callbacks, long after the click, which browsers would otherwise mute).
  // Resuming an AudioContext + flagging that we've had a gesture is enough for
  // Chrome/Edge to allow all subsequent HTMLAudioElement playback this session.
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    try {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = audioContextRef.current ?? new Ctor();
        audioContextRef.current = ctx;
        void ctx.resume?.();
      }
    } catch {
      // Best-effort; a failure here just means we rely on the gesture itself.
    }
  }, []);

  // Play the kept-back answer audio from a direct user tap (always allowed).
  const playPending = useCallback(async () => {
    const blob = pendingAudioBlobRef.current;
    if (!blob) return;
    setVoiceError(null);
    setCanReplay(false);
    setIsSpeaking(true);
    try {
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      currentAudioRef.current = audio;
      await new Promise<void>((resolve) => {
        const done = () => {
          URL.revokeObjectURL(objectUrl);
          if (currentAudioRef.current === audio) currentAudioRef.current = null;
          resolve();
        };
        audio.addEventListener("ended", done, { once: true });
        audio.addEventListener("error", done, { once: true });
        audio.addEventListener("pause", done, { once: true });
        audio.play().catch(done);
      });
    } finally {
      setIsSpeaking(false);
    }
  }, []);

  // Resolves when speech finishes so the hands-free loop can re-arm afterwards.
  // Tracks isSpeaking for the indicator and keeps a handle on the audio element
  // so a hard mute can cut playback instantly. A hard mute skips speaking.
  const speakJarvis = useCallback(
    async (text: string): Promise<void> => {
      if (isMutedRef.current) {
        return;
      }
      // Speaking supersedes the thinking indicator.
      setIsThinking(false);
      setIsSpeaking(true);
      // A fresh utterance clears any stale "replay" offer.
      setCanReplay(false);
      pendingAudioBlobRef.current = null;

      // Returns true if playback actually started/finished, false if the
      // browser blocked it (autoplay) so the caller can offer a manual replay.
      const playBlob = async (blob: Blob): Promise<boolean> => {
        const objectUrl = URL.createObjectURL(blob);
        const audio = new Audio(objectUrl);
        currentAudioRef.current = audio;
        return await new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(objectUrl);
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            resolve(ok);
          };
          audio.addEventListener("ended", () => finish(true), { once: true });
          audio.addEventListener("error", () => finish(false), { once: true });
          // A hard mute pauses the element; resolve so the loop/await never
          // hangs waiting for an "ended" that won't come.
          audio.addEventListener("pause", () => finish(true), { once: true });
          audio.play().catch(() => finish(false));
        });
      };

      try {
        // Try the chosen voice first, then any OTHER working server voices, so a
        // provider that's out of credit (e.g. OpenAI) auto-falls to a natural
        // one (Deepgram/Piper) instead of the robotic browser voice.
        const candidates = [ttsProvider, ...(voiceConfig?.tts.providers ?? [])].filter(
          (provider, index, all) =>
            provider && provider !== "browser" && all.indexOf(provider) === index,
        );
        for (const provider of candidates) {
          if (isMutedRef.current) return;
          try {
            const speakBody: Record<string, string> = { text, provider };
            if (provider === "deepgram" && deepgramVoice) {
              speakBody.model = deepgramVoice;
            }
            const response = await apiFetch(buildVoiceSpeakUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(speakBody),
            });
            if (response.ok && !isMutedRef.current) {
              const blob = await response.blob();
              const played = await playBlob(blob);
              if (played) return;
              // The audio arrived but the browser blocked playback. Other
              // providers would hit the same wall, so stop and let the user
              // start it with a tap instead of failing silently.
              pendingAudioBlobRef.current = blob;
              setCanReplay(true);
              setVoiceError("Tap 🔊 Replay to hear the answer.");
              return;
            }
          } catch {
            // Try the next candidate provider.
          }
        }

        // Last resort: the browser's built-in (robotic) voice.
        if (!isMutedRef.current && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          await new Promise<void>((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.addEventListener("end", () => resolve(), { once: true });
            utterance.addEventListener("error", () => resolve(), { once: true });
            window.speechSynthesis.speak(utterance);
          });
        } else if (!isMutedRef.current) {
          // No server provider worked and no browser speech available — say so
          // visibly rather than leaving the user wondering why it's silent.
          setVoiceError("Voice output unavailable — check your TTS provider in Settings.");
        }
      } finally {
        setIsSpeaking(false);
      }
    },
    [ttsProvider, voiceConfig, deepgramVoice],
  );

  useEffect(() => {
    speakJarvisRef.current = speakJarvis;
  }, [speakJarvis]);

  // Stop every voice activity at once: recognition, recording, pending audio,
  // and speech. Used by the hard mute and by the tab-blur safety stop.
  const stopAllVoiceActivity = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
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
    mediaStreamRef.current = null;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    isRecordingCommandRef.current = false;
    setIsWakeArmed(false);
    setIsRecordingCommand(false);
    setIsThinking(false);
    setIsSpeaking(false);
  }, []);

  const hardMute = useCallback(() => {
    setIsMuted(true);
    isMutedRef.current = true;
    setIsListening(false);
    isListeningRef.current = false;
    stopAllVoiceActivity();
    setVoiceStatus("Muted");
  }, [stopAllVoiceActivity]);

  const unmute = useCallback(() => {
    setIsMuted(false);
    isMutedRef.current = false;
    setVoiceStatus("Voice idle");
  }, []);

  // After a command fully resolves, go back to listening for the wake word so
  // the next request needs no click. Only while hands-free, not muted, visible.
  const maybeContinueLoop = useCallback(() => {
    if (isListeningRef.current && !isMutedRef.current && document.visibilityState === "visible") {
      startWakeListeningRef.current?.();
    }
  }, []);

  const runVoiceIntent = useCallback(
    async (transcript: string) => {
      setVoiceError(null);
      setIsThinking(true);
      setLastVoiceTranscript(transcript);
      // Everything below runs inside try/finally so a thrown await (network
      // drop, bad JSON) can never leave the indicator stuck on "Thinking" and
      // freeze the hands-free loop. The finally always clears it.
      try {
        // If a confirmation is already pending, intercept confirm/cancel before routing.
        const pending = pendingVoiceIntentRef.current;
        if (pending) {
          const lower = transcript.toLowerCase().trim();
          if (/^(confirm|yes|do it|proceed|go ahead|run it)\b/.test(lower)) {
            setPendingVoiceIntent(null);
            await speakJarvis("Confirmed.");
            await pending.onConfirm();
            return;
          }
          if (/^(cancel|no|stop|abort|nevermind|never mind|dismiss)\b/.test(lower)) {
            setPendingVoiceIntent(null);
            setVoiceStatus("Voice idle");
            await speakJarvis("Cancelled.");
            return;
          }
        }

        const intentResponse = await apiFetch(buildVoiceIntentUrl(), {
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
          const captureText = intent.text;
          const captureLabel = captureText.length > 60 ? `${captureText.slice(0, 60)}…` : captureText;
          setPendingVoiceIntent({
            displayLabel: `Capture to brain: "${captureLabel}"`,
            confirmLabel: "CONFIRM CAPTURE",
            onConfirm: async () => {
              const response = await apiFetch(buildBrainCaptureUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: captureText }),
              });
              if (!response.ok) {
                setVoiceError("Capture failed");
                return;
              }
              setCaptureMsg("Captured to Inbox");
              void loadRecent();
              setVoiceStatus("Captured");
              pushNotification("Captured to brain", captureText);
              await speakJarvisRef.current?.("Captured.");
            },
            expiresAt: Date.now() + 10_000,
          });
          setVoiceStatus("Awaiting confirmation");
          await speakJarvis(`Capture: "${captureLabel}". Confirm or cancel.`);
          return;
        }

        if (intent.type === "remember") {
          const rememberText = intent.text;
          const rememberLabel = rememberText.length > 60 ? `${rememberText.slice(0, 60)}…` : rememberText;
          setPendingVoiceIntent({
            displayLabel: `Remember: "${rememberLabel}"`,
            confirmLabel: "CONFIRM REMEMBER",
            onConfirm: async () => {
              const response = await apiFetch(buildBrainRememberUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: rememberText }),
              });
              if (!response.ok) {
                setVoiceError("Couldn't save that to memory");
                await speakJarvisRef.current?.("I couldn't save that. Try again.").catch(() => {});
                return;
              }
              void loadMemory();
              setVoiceStatus("Saved to memory");
              pushNotification("Saved to memory", rememberText);
              await speakJarvisRef.current?.("Got it. I'll remember that from now on.");
            },
            expiresAt: Date.now() + 10_000,
          });
          setVoiceStatus("Awaiting confirmation");
          await speakJarvis(`Remember: "${rememberLabel}". Confirm or cancel.`);
          return;
        }

        if (intent.type === "create-terminal") {
          const terminalMode = intent.workspaceMode;
          setPendingVoiceIntent({
            displayLabel: `Create agent terminal (${terminalMode} mode)`,
            confirmLabel: "CONFIRM CREATE AGENT",
            onConfirm: async () => {
              const response = await apiFetch("/api/terminals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceMode: terminalMode, tentacleId: "octoboss" }),
              });
              if (!response.ok) {
                setVoiceError("Unable to create agent");
                return;
              }
              onNavigate(1);
              setVoiceStatus("Agent created");
              pushNotification("Agent terminal created", `${terminalMode} mode`);
              await speakJarvisRef.current?.("Agent created.");
            },
            expiresAt: Date.now() + 10_000,
          });
          setVoiceStatus("Awaiting confirmation");
          await speakJarvis("Create a new agent terminal. Confirm or cancel.");
          return;
        }

        if (intent.type === "run-skill") {
          const skillName = intent.skillName;
          setPendingVoiceIntent({
            displayLabel: `Run skill: ${skillName}`,
            confirmLabel: "CONFIRM RUN SKILL",
            onConfirm: async () => {
              const res = await apiFetch(buildSkillsRunUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ skillName, confirmed: true }),
              });
              if (!res.ok) {
                const data = (await res.json().catch(() => null)) as { error?: string } | null;
                setVoiceError(data?.error ?? `Could not run skill: ${skillName}`);
                return;
              }
              onNavigate(1);
              setVoiceStatus(`Running skill: ${skillName}`);
              pushNotification(`Skill run: ${skillName}`);
              await speakJarvisRef.current?.(`Running ${skillName}.`);
            },
            expiresAt: Date.now() + 10_000,
          });
          setVoiceStatus(`Approval needed: ${skillName}`);
          await speakJarvis(`Run skill: ${skillName}. Confirm or cancel.`);
          return;
        }

        if (intent.type === "run-workflow") {
          const workflowName = intent.workflowName;
          setPendingVoiceIntent({
            displayLabel: `Run workflow: ${workflowName}`,
            confirmLabel: "CONFIRM RUN WORKFLOW",
            onConfirm: async () => {
              onNavigate(3);
              setVoiceStatus(`Opening workflows: ${workflowName}`);
              pushNotification(`Workflow opened: ${workflowName}`);
              await speakJarvisRef.current?.(`Opening workflows to run ${workflowName}.`);
            },
            expiresAt: Date.now() + 10_000,
          });
          setVoiceStatus("Awaiting confirmation");
          await speakJarvis(`Run workflow: ${workflowName}. Confirm or cancel.`);
          return;
        }

        if (intent.type === "ask") {
          setVoiceStatus("Thinking");
          // Detect queries that need real-time lookup so we can say the right thing.
          const REALTIME_RE =
            /\b(weather|temp(erature)?|forecast|today|tonight|current(ly)?|right now|latest|live|news|score|game|price|stock|crypto|what time|open now|happening)\b/i;
          const ackText = REALTIME_RE.test(intent.question)
            ? "One sec, let me look that up."
            : "Let me think about that.";
          // Fire the acknowledgment and the API call in parallel. The user hears
          // something instantly; the answer starts speaking right after the ack finishes.
          const [, res] = await Promise.all([
            speakJarvis(ackText).catch(() => {}),
            apiFetch(buildBrainAskUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                chatModelRef.current
                  ? { question: intent.question, model: chatModelRef.current }
                  : { question: intent.question },
              ),
            }),
          ]);
          if (!res.ok) {
            setVoiceError("Ask failed");
            return;
          }
          const data = (await res.json()) as {
            available?: boolean;
            answer?: string;
            hint?: string;
            via?: string;
            sources?: { title: string; path: string }[];
          };
          if (data.available && typeof data.answer === "string") {
            const cleanAnswer = stripMarkdownForSpeech(data.answer);
            setAnswer(cleanAnswer);
            setAnswerSources(Array.isArray(data.sources) ? data.sources : []);
            setAnswerVia(typeof data.via === "string" ? data.via : null);
            setVoiceStatus("Answered");
            void loadConversation();
            await speakJarvis(cleanAnswer);
          } else {
            // Never go silent: tell the user (out loud) why there's no answer,
            // and show the exact provider error under the ask box.
            const note = data.hint ?? "I couldn't reach an answer model. Check your API keys.";
            setAskNote(note);
            setVoiceStatus("No answer model");
            await speakJarvis(
              "I couldn't reach an answer model. The reason is on the screen below your question.",
            );
          }
          return;
        }

        setVoiceStatus("Command captured");
        setVoiceError("I didn't catch a question or command.");
        await speakJarvis("I didn't catch that — try asking me a question.");
      } catch {
        setVoiceError("Something went wrong handling that. Try again.");
        setVoiceStatus("Voice idle");
        await speakJarvis("Sorry, something went wrong. Please try again.").catch(() => {});
      } finally {
        setIsThinking(false);
      }
    },
    [loadConversation, loadMemory, loadRecent, onNavigate, speakJarvis],
  );

  const transcribeCommandAudio = useCallback(
    async (audio: Blob) => {
      const model = voiceModel ?? voiceConfig?.transcription.defaultModel ?? null;
      if (!voiceConfig?.transcription.configured) {
        setVoiceError("Set DEEPGRAM_API_KEY or OPENAI_API_KEY to enable voice commands");
        setVoiceStatus("Transcription unavailable");
        return;
      }
      setVoiceStatus("Transcribing");
      setIsThinking(true);
      try {
        const response = await apiFetch(buildVoiceTranscribeUrl(model), {
          method: "POST",
          headers: { "Content-Type": audio.type || "audio/webm" },
          body: audio,
        });
        if (!response.ok) {
          setVoiceError("Transcription failed");
          setVoiceStatus("Voice idle");
          setIsThinking(false);
          return;
        }
        const result = (await response.json()) as { text?: string };
        const transcript = result.text?.trim();
        if (!transcript) {
          setVoiceError("No speech detected");
          setVoiceStatus("Voice idle");
          setIsThinking(false);
          return;
        }
        setVoiceStatus("Command received");
        await runVoiceIntent(transcript);
      } catch {
        setVoiceError("Transcription request failed");
        setVoiceStatus("Voice idle");
      } finally {
        setIsThinking(false);
        // Re-arm for the next command when running hands-free.
        maybeContinueLoop();
      }
    },
    [maybeContinueLoop, runVoiceIntent, voiceConfig, voiceModel],
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
    if (isMutedRef.current) {
      return;
    }
    // No server-side transcription key → use browser SpeechRecognition as fallback.
    if (!voiceConfig?.transcription.configured) {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition) {
        setVoiceError("Set DEEPGRAM_API_KEY or OPENAI_API_KEY to enable voice commands");
        return;
      }
      setVoiceError(null);
      setVoiceStatus("Listening for command");
      isRecordingCommandRef.current = true;
      setIsRecordingCommand(true);
      const recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        const parts: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const t = event.results[i]?.[0]?.transcript;
          if (t) parts.push(t);
        }
        const transcript = parts.join(" ").trim();
        isRecordingCommandRef.current = false;
        setIsRecordingCommand(false);
        if (transcript) {
          setVoiceStatus("Command received");
          void runVoiceIntent(transcript).finally(() => maybeContinueLoop());
        } else {
          setVoiceError("No speech detected");
          setVoiceStatus("Voice idle");
          maybeContinueLoop();
        }
      };
      recognition.onerror = () => {
        isRecordingCommandRef.current = false;
        setIsRecordingCommand(false);
        setVoiceError("Transcription failed — try again");
        setVoiceStatus("Voice idle");
        maybeContinueLoop();
      };
      recognition.onend = () => {
        isRecordingCommandRef.current = false;
        setIsRecordingCommand(false);
      };
      recognition.start();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone capture is unavailable in this browser");
      return;
    }
    setVoiceError(null);
    setVoiceStatus("Listening for command");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const domErr = err instanceof DOMException ? err : null;
      const msg =
        domErr?.name === "NotFoundError" || domErr?.name === "DevicesNotFoundError"
          ? "No microphone found — check Windows Settings → System → Sound → Input device."
          : domErr?.name === "NotReadableError" || domErr?.name === "TrackStartError"
            ? "Microphone is in use by another app — close other audio apps and try again."
            : "Microphone blocked — click the 🔒 in the address bar → Site settings → Microphone → Allow.";
      setVoiceError(msg);
      setVoiceStatus("Voice idle");
      isRecordingCommandRef.current = false;
      setIsRecordingCommand(false);
      setIsThinking(false);
      return;
    }
    mediaStreamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];
    mediaRecorderRef.current = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    });
    // Closed in the stop handler so it's always cleaned up, even on external stops.
    let silenceAudioCtx: AudioContext | null = null;
    recorder.addEventListener("stop", () => {
      isRecordingCommandRef.current = false;
      setIsRecordingCommand(false);
      silenceAudioCtx?.close().catch(() => {});
      for (const track of stream.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
      const audio = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      if (audio.size === 0) {
        setVoiceError(
          "No audio captured — check your microphone in Windows Settings → Sound → Input.",
        );
        setVoiceStatus("Voice idle");
        setIsThinking(false);
        maybeContinueLoop();
        return;
      }
      void transcribeCommandAudio(audio);
    });
    isRecordingCommandRef.current = true;
    setIsRecordingCommand(true);
    recorder.start();
    // Hard cap: never record more than 30 s.
    recordingTimerRef.current = window.setTimeout(() => {
      stopCommandRecording();
    }, 30000);
    // Silence-based endpointing via Web Audio AnalyserNode. Initial quiet is
    // user reaction time; only trailing silence after real speech ends a turn.
    try {
      const ctx = new AudioContext();
      silenceAudioCtx = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const silenceBuf = new Uint8Array(analyser.frequencyBinCount);
      const recordingStartedAt = Date.now();
      const MIN_REC_MS = 600;
      const SILENCE_THRESHOLD_MS = 1500;
      const NO_SPEECH_TIMEOUT_MS = 7000;
      const RMS_THRESHOLD = 0.015;
      let heardSpeech = false;
      let silenceStartedAt: number | null = null;
      const tick = () => {
        if (!isRecordingCommandRef.current) return;
        analyser.getByteTimeDomainData(silenceBuf);
        let sumSq = 0;
        for (const sample of silenceBuf) {
          const s = (sample - 128) / 128;
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / silenceBuf.length);
        if (rms > RMS_THRESHOLD) {
          heardSpeech = true;
          silenceStartedAt = null;
        } else if (heardSpeech && Date.now() - recordingStartedAt >= MIN_REC_MS) {
          if (silenceStartedAt === null) {
            silenceStartedAt = Date.now();
          } else if (Date.now() - silenceStartedAt >= SILENCE_THRESHOLD_MS) {
            stopCommandRecording();
            return;
          }
        } else if (Date.now() - recordingStartedAt >= NO_SPEECH_TIMEOUT_MS) {
          // Timed out with no speech detected locally — still try transcription in
          // case the mic is just very quiet; Deepgram will return empty text if silent.
          stopCommandRecording();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      // Web Audio unavailable — the hard-cap timer handles stopping.
    }
  }, [maybeContinueLoop, runVoiceIntent, stopCommandRecording, transcribeCommandAudio, voiceConfig]);

  // Keep the loop's re-arm handle pointed at the latest startCommandRecording
  // (avoids a circular useCallback dependency with transcribeCommandAudio).
  useEffect(() => {
    startCommandRecordingRef.current = () => {
      void startCommandRecording();
    };
  }, [startCommandRecording]);

  // Pause the mic when the tab is hidden (privacy + battery), but REMEMBER the
  // user's hands-free intent (isListeningRef stays set) and silently re-arm when
  // the tab is shown again. We deliberately do NOT listen for window "blur":
  // blur fires on harmless focus changes (devtools, a second monitor, an alt-tab
  // that doesn't hide the tab) and was the main cause of "voice just stopped".
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (isListeningRef.current) {
          stopAllVoiceActivity();
          setVoiceStatus("Paused — tab hidden");
        }
        return;
      }
      if (
        shouldResumeWakeLoop({
          handsFreeOn: isListeningRef.current,
          isMuted: isMutedRef.current,
          isVisible: true,
        })
      ) {
        startWakeListeningRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stopAllVoiceActivity]);

  // Stop the whole hands-free loop (the "Stop listening" button).
  const stopListening = useCallback(() => {
    setIsListening(false);
    isListeningRef.current = false;
    stopAllVoiceActivity();
    setVoiceStatus("Voice idle");
  }, [stopAllVoiceActivity]);

  // Start (or restart) the wake-word listener. Browser speech recognition ends
  // itself after a pause, so onend RESTARTS it whenever we're still in
  // hands-free mode — that's what keeps Jarvis always listening with no clicks.
  const startWakeListening = useCallback(() => {
    if (isMutedRef.current || isRecordingCommandRef.current) {
      return;
    }
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError("Voice needs Chrome or Edge — open Jarvis in one of those.");
      setIsListening(false);
      isListeningRef.current = false;
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
      // If the wake phrase and the command came together ("jarvis what's my
      // schedule"), handle it directly; otherwise record the follow-up speech.
      if (commandAfterWake && commandAfterWake.split(/\s+/).length >= 2) {
        // Inline "Jarvis <command>": this path bypasses transcribeCommandAudio,
        // so re-arm the wake loop ourselves once the command resolves — without
        // this, hands-free stops after one spoken-together command.
        void runVoiceIntent(commandAfterWake).finally(() => maybeContinueLoop());
        return;
      }
      void startCommandRecording();
    };
    recognition.onerror = (event) => {
      // A blocked mic is fatal to the loop — stop so we don't hammer it.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceError("Microphone is blocked. Allow mic access for this page, then Start again.");
        setIsListening(false);
        isListeningRef.current = false;
        return;
      }
      // Everything else (network, audio-capture, aborted) is transient: surface
      // it so failures aren't silent, but let onend restart the loop so a brief
      // hiccup doesn't permanently stop voice. "no-speech" is normal silence.
      if (event.error && event.error !== "no-speech") {
        setVoiceStatus(`Voice hiccup (${event.error}) — retrying…`);
      }
    };
    recognition.onend = () => {
      setIsWakeArmed(false);
      // Keep listening: restart unless we're muted, mid-command, or the user
      // stopped. This is the fix for "it stops working after a few seconds".
      if (
        isListeningRef.current &&
        !isMutedRef.current &&
        !isRecordingCommandRef.current &&
        document.visibilityState === "visible"
      ) {
        window.setTimeout(() => startWakeListeningRef.current?.(), 250);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsWakeArmed(true);
    setVoiceStatus("Listening for “Jarvis”…");
  }, [maybeContinueLoop, runVoiceIntent, startCommandRecording, voiceConfig]);

  // One click: grant the mic and enter persistent hands-free mode.
  const startListening = useCallback(() => {
    unlockAudio();
    setIsMuted(false);
    isMutedRef.current = false;
    setIsListening(true);
    isListeningRef.current = true;
    startWakeListening();
  }, [startWakeListening, unlockAudio]);

  // Push-to-talk: the simple, reliable path. One tap unlocks audio and records a
  // single turn (auto-stops after 7s); tapping again sends early. No wake word
  // and no always-on loop, so it can't get stuck or die on a tab switch.
  // maybeContinueLoop() won't arm the hands-free loop here because isListeningRef
  // stays false unless the user explicitly started hands-free mode.
  const togglePushToTalk = useCallback(() => {
    unlockAudio();
    if (isMutedRef.current) {
      setIsMuted(false);
      isMutedRef.current = false;
    }
    if (isRecordingCommandRef.current) {
      stopCommandRecording();
      return;
    }
    void startCommandRecording();
  }, [startCommandRecording, stopCommandRecording, unlockAudio]);

  // Keep the restart handle pointed at the latest startWakeListening so onend
  // (and the post-command loop) can re-arm without a circular dependency.
  useEffect(() => {
    startWakeListeningRef.current = startWakeListening;
  }, [startWakeListening]);

  const openNoteByPath = useCallback(async (path: string) => {
    try {
      const res = await apiFetch(buildBrainNoteUrl(path), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { title?: string; content?: string };
      setOpenNote({ title: data.title ?? path, content: data.content ?? "" });
    } catch {
      /* ignore */
    }
  }, []);

  const shown = results ?? recent;

  const consoleScrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <section className="nc-hq" aria-label="Jarvis home view">
      <div className="nc-hq-grid" aria-hidden="true" />
      <div className="nc-hq-scanlines" aria-hidden="true" />

      {/* top-left: voice status */}
      <div className="nc-hq-voice-status">
        <div className="nc-hq-voice-label">VOICE_SYNTH</div>
        <div className="nc-hq-voice-indicator">
          <span className="nc-hq-voice-dot" aria-hidden="true" />
          {isSpeaking
            ? "SPEAKING"
            : isThinking
              ? "PROCESSING"
              : isRecordingCommand
                ? "LISTENING"
                : isWakeArmed
                  ? "WAKE ARMED"
                  : "STANDBY"}
        </div>
      </div>

      {/* top-right: consciousness mode tabs */}
      <div className="nc-hq-variant-ctrl">
        <span className="nc-hq-variant-label">CONSCIOUSNESS_CORE</span>
        <div className="nc-hq-variant-tabs">
          {(["core", "radar", "signal"] as const).map((m) => (
            <button
              key={m}
              className="nc-hq-variant-tab"
              data-active={visMode === m ? "true" : "false"}
              onClick={() => setVisMode(m)}
              type="button"
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* center visualizer */}
      <div className="nc-hq-visualizer">
        {visMode === "core" && (
          <div className="nc-core">
            <div className="nc-core-ring" aria-hidden="true" />
            <div className="nc-core-ring nc-core-ring--mid" aria-hidden="true" />
            <div className="nc-core-ring nc-core-ring--inner" aria-hidden="true" />
            <div className="nc-core-orb">
              <div className="nc-core-center-dot" aria-hidden="true" />
            </div>
          </div>
        )}
        {visMode === "radar" && (
          <div className="nc-radar">
            <div className="nc-radar-ring nc-radar-ring--25" aria-hidden="true" />
            <div className="nc-radar-ring nc-radar-ring--12" aria-hidden="true" />
            <div className="nc-radar-line-h" aria-hidden="true" />
            <div className="nc-radar-line-v" aria-hidden="true" />
            <div className="nc-radar-sweep" aria-hidden="true" />
            <div
              className="nc-radar-blip"
              aria-hidden="true"
              style={{
                left: "64%",
                top: "38%",
                width: 9,
                height: 9,
                background: "var(--gold)",
                boxShadow: "0 0 14px var(--gold)",
              }}
            />
            <div
              className="nc-radar-blip"
              aria-hidden="true"
              style={{
                left: "42%",
                top: "60%",
                width: 9,
                height: 9,
                background: "var(--nc-warn, #f5e600)",
                boxShadow: "0 0 14px var(--nc-warn,#f5e600)",
              }}
            />
            <div
              className="nc-radar-blip"
              aria-hidden="true"
              style={{
                left: "55%",
                top: "72%",
                width: 7,
                height: 7,
                background: "var(--term-red)",
                boxShadow: "0 0 12px var(--term-red)",
              }}
            />
          </div>
        )}
        {visMode === "signal" && (
          <div className="nc-signal">
            {Array.from({ length: 32 }, (_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: static animation bars have no other stable key
                key={i}
                className="nc-signal-bar"
                aria-hidden="true"
                style={{
                  height: "60%",
                  animationDelay: `${(i * 0.08).toFixed(2)}s`,
                  animationDuration: `${(0.6 + (i % 5) * 0.15).toFixed(2)}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* voice + mute bar above console */}
      <div className="nc-hq-voice-bar">
        <button
          type="button"
          className="nc-hq-talk-btn"
          data-recording={isRecordingCommand}
          onClick={togglePushToTalk}
        >
          {isRecordingCommand ? "● LISTENING — TAP TO SEND" : "🎙 TAP TO TALK"}
        </button>
        <button
          type="button"
          className="nc-hq-mute-btn"
          data-muted={isMuted}
          aria-pressed={isMuted}
          onClick={isMuted ? unmute : hardMute}
        >
          {isMuted ? "UNMUTE" : "MUTE"}
        </button>
      </div>

      {/* voice intent confirmation overlay */}
      {pendingVoiceIntent && (
        <div className="nc-hq-intent-confirm" role="alertdialog" aria-label="Confirm voice action">
          <span className="nc-hq-intent-confirm-countdown">{intentCountdown}s</span>
          <p className="nc-hq-intent-confirm-label">{pendingVoiceIntent.displayLabel}</p>
          <div className="nc-hq-intent-confirm-actions">
            <button
              type="button"
              className="nc-hq-intent-confirm-ok"
              onClick={() => {
                const p = pendingVoiceIntent;
                setPendingVoiceIntent(null);
                void speakJarvis("Confirmed.").then(() => p.onConfirm()).catch(() => p.onConfirm());
              }}
            >
              {pendingVoiceIntent.confirmLabel}
            </button>
            <button
              type="button"
              className="nc-hq-intent-confirm-cancel"
              onClick={() => {
                setPendingVoiceIntent(null);
                setVoiceStatus("Voice idle");
                void speakJarvis("Cancelled.");
              }}
            >
              CANCEL
            </button>
          </div>
          <p className="nc-hq-intent-confirm-hint">or say "confirm" / "cancel"</p>
        </div>
      )}

      {voiceError && <div className="nc-hq-voice-error">{voiceError}</div>}

      {/* Execution activity feed */}
      {recentRuns.length > 0 && (
        <div className="nc-hq-activity">
          <div className="nc-hq-activity-hdr">EXEC_LOG</div>
          <div className="nc-hq-activity-list">
            {recentRuns.slice(0, 6).map((run) => {
              const minsAgo = Math.round(
                (Date.now() - new Date(run.startedAt).getTime()) / 60000,
              );
              const timeLabel =
                minsAgo < 1
                  ? "just now"
                  : minsAgo < 60
                    ? `${minsAgo}m ago`
                    : `${Math.round(minsAgo / 60)}h ago`;
              return (
                <div key={run.id} className="nc-hq-activity-item">
                  <span className="nc-hq-activity-badge" data-status={run.status}>
                    {run.status === "ok" ? "✓" : "✗"}
                  </span>
                  <span className="nc-hq-activity-name">{run.workflowName}</span>
                  <span className="nc-hq-activity-meta">
                    {run.steps.length} step{run.steps.length !== 1 ? "s" : ""} · {timeLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* bottom conversational console */}
      <div className="nc-hq-console">
        <div className="nc-hq-console-hdr">
          <span className="nc-hq-console-hdr-left">
            <span className="nc-hq-console-hdr-dot" aria-hidden="true" />
            DIRECT_LINK · JARVIS
          </span>
          <span
            className="nc-hq-console-hdr-right"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                fontSize: 9,
                letterSpacing: ".18em",
                color: "var(--text-secondary)",
                textTransform: "uppercase",
              }}
            >
              CTX · {conversation.length * 2} TURNS
            </span>
            {conversation.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const newId = `jarvis-${Date.now()}`;
                  try {
                    window.localStorage.setItem("jarvis.sessionId", newId);
                  } catch {
                    /* ignore */
                  }
                  setJarvisSessionId(newId);
                  setConversation([]);
                  setAnswer(null);
                  setAskNote(null);
                  setAsk("");
                }}
                style={{
                  background: "none",
                  border: "1px solid rgba(57,255,20,0.18)",
                  color: "rgba(57,255,20,0.38)",
                  fontFamily: "var(--font-display)",
                  fontSize: 8,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  padding: "2px 7px",
                  cursor: "pointer",
                }}
              >
                NEW CHAT
              </button>
            )}
          </span>
        </div>
        <div
          className="nc-hq-console-msgs"
          ref={(el) => {
            consoleScrollRef.current = el;
          }}
        >
          {conversation.length === 0 && (
            <div
              style={{
                color: "var(--text-secondary)",
                fontSize: 11,
                letterSpacing: ".08em",
                padding: "8px 0",
              }}
            >
              AWAITING DIRECTIVE<span className="nc-blink">_</span>
            </div>
          )}
          {conversation.map((turn) => (
            <div className="nc-hq-turn" key={`${turn.time}-${turn.question}`}>
              <div className="nc-hq-msg nc-hq-msg--you">
                <div className="nc-hq-msg-who">USR_CMD · {turn.time}</div>
                <div className="nc-hq-msg-text">{turn.question}</div>
              </div>
              <div className="nc-hq-msg nc-hq-msg--jarvis">
                <div className="nc-hq-msg-who">JARVIS</div>
                <div className="nc-hq-msg-text">{turn.answer}</div>
              </div>
            </div>
          ))}
          {isThinking && (
            <div className="nc-hq-thinking">
              PROCESSING<span className="nc-blink">_</span>
            </div>
          )}
          {answerVia && !asking && (
            <div className="nc-hq-attribution">
              <button
                type="button"
                className="nc-hq-attribution-line"
                onClick={() => setSourcesExpanded((v) => !v)}
              >
                via {answerVia}
                {answerSources.length > 0 &&
                  ` · ${answerSources.length} note${answerSources.length !== 1 ? "s" : ""}`}
                {answerCitations.length > 0 && " · web"}
                <span className="nc-hq-attribution-arrow">
                  {sourcesExpanded ? "▴" : "▾"}
                </span>
              </button>
              {sourcesExpanded && (answerSources.length > 0 || answerCitations.length > 0) && (
                <div className="nc-hq-attribution-detail">
                  {answerSources.map((s) => (
                    <div key={s.path} className="nc-hq-attribution-item">
                      ◆ {s.title}
                    </div>
                  ))}
                  {answerCitations.map((c) => (
                    <a
                      key={c.url}
                      className="nc-hq-attribution-cite"
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ◆ {c.title || c.url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="nc-hq-console-input">
          <span className="nc-hq-prompt" aria-hidden="true">
            &gt;
          </span>
          <input
            className="nc-hq-input"
            type="text"
            placeholder="Issue a directive to JARVIS…"
            value={ask}
            aria-label="Send a message to Jarvis"
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void submitAsk();
                setTimeout(() => {
                  if (consoleScrollRef.current)
                    consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
                }, 100);
              }
            }}
          />
          <button
            type="button"
            className="nc-hq-send"
            disabled={asking || ask.trim().length === 0}
            onClick={() => {
              void submitAsk();
              setTimeout(() => {
                if (consoleScrollRef.current)
                  consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
              }, 100);
            }}
          >
            {asking ? "…" : "SEND"}
          </button>
        </div>
      </div>
    </section>
  );
};
