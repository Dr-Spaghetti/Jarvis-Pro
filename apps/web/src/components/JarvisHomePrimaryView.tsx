import { useCallback, useEffect, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { VOICE_PHASE_LABELS, deriveVoicePhase } from "../app/voicePhase";
import { apiFetch } from "../runtime/apiClient";
import { HomeTilesPanel } from "./HomeTilesPanel";

import {
  buildBrainAskUrl,
  buildBrainCaptureUrl,
  buildBrainDigestUrl,
  buildBrainJournalUrl,
  buildBrainMemoryUrl,
  buildBrainModelsUrl,
  buildBrainNoteUrl,
  buildBrainRecentUrl,
  buildBrainSemanticUrl,
  buildDeckSkillsUrl,
  buildDeckTentaclesUrl,
  buildSkillsRunUrl,
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
    | { type: "run-skill"; skillName: string }
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
  const [skillRunConfirmName, setSkillRunConfirmName] = useState<string | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  // Which local Ollama model answers. Empty = server default. Persisted so the
  // choice sticks; mirrored to a ref so the voice loop reads it without re-binding.
  const [chatModels, setChatModels] = useState<string[]>([]);
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

  useEffect(() => {
    void loadRecent();
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
      try {
        const res = await apiFetch(buildBrainMemoryUrl(), {
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
  }, [loadRecent]);

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

  // Load the list of installed Ollama chat models for the answer-model picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(buildBrainModelsUrl(), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { models?: string[] };
        if (Array.isArray(data.models)) setChatModels(data.models);
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

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length === 0) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(buildBrainSemanticUrl(q), {
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
    setAskNote(null);
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
        sources?: { title: string; path: string }[];
      };
      if (data.available && typeof data.answer === "string") {
        setAnswer(data.answer);
        setAnswerSources(Array.isArray(data.sources) ? data.sources : []);
        // Auto-speak the answer when running hands-free, so the user doesn't
        // have to click. Never speaks while muted.
        if (isListeningRef.current && !isMutedRef.current) {
          void speakJarvisRef.current?.(data.answer);
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
  }, [ask, chatModel]);

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

      const playBlob = async (blob: Blob): Promise<void> => {
        const objectUrl = URL.createObjectURL(blob);
        const audio = new Audio(objectUrl);
        currentAudioRef.current = audio;
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            URL.revokeObjectURL(objectUrl);
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            resolve();
          };
          audio.addEventListener("ended", cleanup, { once: true });
          audio.addEventListener("error", cleanup, { once: true });
          // A hard mute pauses the element; resolve so the loop/await never
          // hangs waiting for an "ended" that won't come.
          audio.addEventListener("pause", cleanup, { once: true });
          audio.play().catch(cleanup);
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
            const response = await apiFetch(buildVoiceSpeakUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, provider }),
            });
            if (response.ok && !isMutedRef.current) {
              await playBlob(await response.blob());
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
        }
      } finally {
        setIsSpeaking(false);
      }
    },
    [ttsProvider, voiceConfig],
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
      const intentResponse = await apiFetch(buildVoiceIntentUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!intentResponse.ok) {
        setVoiceError("Unable to resolve command");
        setIsThinking(false);
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
        const response = await apiFetch(buildBrainCaptureUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: intent.text }),
        });
        if (!response.ok) {
          setVoiceError("Capture failed");
          setIsThinking(false);
          return;
        }
        setCaptureMsg("Captured to Inbox");
        void loadRecent();
        setVoiceStatus("Captured");
        await speakJarvis("Captured.");
        return;
      }

      if (intent.type === "create-terminal") {
        const response = await apiFetch("/api/terminals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceMode: intent.workspaceMode,
            tentacleId: "octoboss",
          }),
        });
        if (!response.ok) {
          setVoiceError("Unable to create agent");
          setIsThinking(false);
          return;
        }
        onNavigate(1);
        setVoiceStatus("Agent created");
        await speakJarvis("Agent created.");
        return;
      }

      if (intent.type === "run-skill") {
        const needsApproval = /\b(outreach|email.assist)\b/.test(intent.skillName.toLowerCase());
        if (needsApproval) {
          setSkillRunConfirmName(intent.skillName);
          setVoiceStatus(`Approval needed: ${intent.skillName}`);
          setIsThinking(false);
          await speakJarvis(
            `I need your approval to run ${intent.skillName}. Tap Confirm to proceed.`,
          );
          return;
        }
        const res = await apiFetch(buildSkillsRunUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillName: intent.skillName }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setVoiceError(data?.error ?? `Could not run skill: ${intent.skillName}`);
          setIsThinking(false);
          return;
        }
        onNavigate(1);
        setVoiceStatus(`Running skill: ${intent.skillName}`);
        await speakJarvis(`Running ${intent.skillName}.`);
        return;
      }

      if (intent.type === "ask") {
        setVoiceStatus("Thinking");
        setIsThinking(true);
        try {
          const res = await apiFetch(buildBrainAskUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              chatModelRef.current
                ? { question: intent.question, model: chatModelRef.current }
                : { question: intent.question },
            ),
          });
          if (!res.ok) {
            setVoiceError("Ask failed");
            setIsThinking(false);
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
            setVoiceStatus("Answered");
            await speakJarvis(data.answer);
          } else {
            setAskNote(
              data.hint ?? "No local chat model is running. Pull one with: ollama pull qwen2.5:7b",
            );
            setVoiceStatus("No answer model");
            setIsThinking(false);
            await speakJarvis("I don't have a local answer model running right now.");
          }
        } catch {
          setVoiceError("Ask failed");
          setIsThinking(false);
        }
        return;
      }

      setVoiceStatus("Command captured");
      setVoiceError("I didn't catch a question or command.");
      setIsThinking(false);
      await speakJarvis("I didn't catch that — try asking me a question.");
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
      isRecordingCommandRef.current = false;
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
    isRecordingCommandRef.current = true;
    setIsRecordingCommand(true);
    recorder.start();
    recordingTimerRef.current = window.setTimeout(() => {
      stopCommandRecording();
    }, 7000);
  }, [stopCommandRecording, transcribeCommandAudio]);

  // Keep the loop's re-arm handle pointed at the latest startCommandRecording
  // (avoids a circular useCallback dependency with transcribeCommandAudio).
  useEffect(() => {
    startCommandRecordingRef.current = () => {
      void startCommandRecording();
    };
  }, [startCommandRecording]);

  // Stop the hands-free loop cleanly when the tab is hidden or loses focus,
  // so the mic is never left listening in the background.
  useEffect(() => {
    const stopLoop = () => {
      setIsListening(false);
      isListeningRef.current = false;
      stopAllVoiceActivity();
      setVoiceStatus("Voice idle");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", stopLoop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", stopLoop);
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
        void runVoiceIntent(commandAfterWake);
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
  }, [runVoiceIntent, startCommandRecording, voiceConfig]);

  // One click: grant the mic and enter persistent hands-free mode.
  const startListening = useCallback(() => {
    setIsMuted(false);
    isMutedRef.current = false;
    setIsListening(true);
    isListeningRef.current = true;
    startWakeListening();
  }, [startWakeListening]);

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

        <HomeTilesPanel />

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
                {chatModels.length > 0 && (
                  <div className="jarvis-ask-model" style={{ marginTop: 8 }}>
                    <label
                      htmlFor="jarvis-chat-model"
                      style={{ color: "var(--text-secondary)", marginRight: 8 }}
                    >
                      Answer model:
                    </label>
                    <select
                      id="jarvis-chat-model"
                      className="jarvis-select"
                      value={chatModel}
                      onChange={(event) => {
                        const value = event.target.value;
                        setChatModel(value);
                        try {
                          window.localStorage.setItem("jarvis.chatModel", value);
                        } catch {
                          /* ignore */
                        }
                      }}
                      aria-label="Answer model"
                    >
                      <option value="">Auto (default)</option>
                      {chatModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
            <div className="jarvis-voice-header-right">
              <span
                className="jarvis-voice-phase"
                data-phase={voicePhase}
                aria-live="polite"
                aria-label={`Voice ${VOICE_PHASE_LABELS[voicePhase]}`}
              >
                <span className="jarvis-voice-phase-dot" aria-hidden="true" />
                {VOICE_PHASE_LABELS[voicePhase]}
              </span>
              <button
                type="button"
                className="jarvis-voice-mute"
                data-muted={isMuted}
                aria-pressed={isMuted}
                onClick={isMuted ? unmute : hardMute}
              >
                {isMuted ? "Unmute" : "Mute"}
              </button>
            </div>
          </div>

          <div className="jarvis-voice-modes">
            <span className="jarvis-voice-status">{voiceStatus}</span>
          </div>

          <div className="jarvis-voice-controls">
            <button
              type="button"
              className="jarvis-btn"
              onClick={isListening ? stopListening : startListening}
              disabled={isMuted}
            >
              {isListening ? "■ Stop listening" : "🎙 Start listening"}
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
          {skillRunConfirmName && (
            <div className="jarvis-skill-confirm" role="alertdialog" aria-label="Approval required">
              <p className="jarvis-skill-confirm-msg">
                Run <strong>{skillRunConfirmName}</strong>? This skill may send emails or outreach.
              </p>
              <div className="jarvis-skill-confirm-actions">
                <button
                  type="button"
                  className="jarvis-skill-confirm-btn jarvis-skill-confirm-btn--ok"
                  onClick={() => {
                    const name = skillRunConfirmName;
                    setSkillRunConfirmName(null);
                    apiFetch(buildSkillsRunUrl(), {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ skillName: name }),
                    })
                      .then(async (res) => {
                        if (!res.ok) {
                          const data = (await res.json().catch(() => null)) as {
                            error?: string;
                          } | null;
                          setVoiceError(data?.error ?? `Could not run skill: ${name}`);
                          return;
                        }
                        onNavigate(1);
                        setVoiceStatus(`Running skill: ${name}`);
                      })
                      .catch(() => {
                        setVoiceError(`Could not run skill: ${name}`);
                      });
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="jarvis-skill-confirm-btn jarvis-skill-confirm-btn--cancel"
                  onClick={() => {
                    setSkillRunConfirmName(null);
                    setVoiceStatus("Voice idle");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
