import { useCallback, useEffect, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../../app/constants";
import { VOICE_PHASE_LABELS, deriveVoicePhase, shouldResumeWakeLoop } from "../../app/voicePhase";
import { apiFetch } from "../../runtime/apiClient";
import {
  buildBrainAskUrl,
  buildBrainCaptureUrl,
  buildBrainRememberUrl,
  buildDeployAgentUrl,
  buildSkillsRunUrl,
  buildVoiceConfigUrl,
  buildVoiceIntentUrl,
  buildVoiceSpeakUrl,
  buildVoiceTranscribeUrl,
  buildVoiceVoicesUrl,
} from "../../runtime/runtimeEndpoints";
import type { JarvisIntentResolution, PendingVoiceIntent, SpeechRecognitionLike, VoiceConfig } from "./types";
import { pushNotification, getSpeechRecognitionConstructor, extractCommandAfterWake, hasWakePhrase, normalizeVoiceText, stripMarkdownForSpeech, voiceNavTargets } from "./utils";

type UseJarvisVoiceOptions = {
  onNavigate: (index: PrimaryNavIndex) => void;
  loadConversation: () => Promise<void>;
  loadMemory: () => Promise<void>;
  loadRecent: () => Promise<void>;
  chatModelRef: React.MutableRefObject<string>;
  onVoiceAnswer: (
    answer: string,
    sources: { title: string; path: string }[],
    via: string | null,
  ) => void;
  onVoiceAnswerFailed: (hint: string) => void;
};

export const useJarvisVoice = ({
  onNavigate,
  loadConversation,
  loadMemory,
  loadRecent,
  chatModelRef,
  onVoiceAnswer,
  onVoiceAnswerFailed,
}: UseJarvisVoiceOptions) => {
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceModel, setVoiceModel] = useState<string | null>(null);
  const [ttsProvider, setTtsProvider] = useState<string>(() => {
    try { return window.localStorage.getItem("jarvis.ttsProvider") || "elevenlabs"; } catch { return "elevenlabs"; }
  });
  const [deepgramVoice, setDeepgramVoice] = useState<string>(() => {
    try { return window.localStorage.getItem("jarvis.deepgramVoice") ?? ""; } catch { return ""; }
  });
  const [deepgramVoices, setDeepgramVoices] = useState<
    { id: string; name: string; description: string }[]
  >([]);
  const [voiceStatus, setVoiceStatus] = useState("Voice idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isWakeArmed, setIsWakeArmed] = useState(false);
  const [isRecordingCommand, setIsRecordingCommand] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [canReplay, setCanReplay] = useState(false);
  const [pendingVoiceIntent, setPendingVoiceIntent] = useState<PendingVoiceIntent | null>(null);
  const [intentCountdown, setIntentCountdown] = useState(10);

  const pendingVoiceIntentRef = useRef<PendingVoiceIntent | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const isListeningRef = useRef(false);
  const isRecordingCommandRef = useRef(false);
  const isMutedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const startWakeListeningRef = useRef<(() => void) | null>(null);
  const startCommandRecordingRef = useRef<(() => void) | null>(null);
  const speakJarvisRef = useRef<((text: string) => Promise<void>) | null>(null);
  const runVoiceIntentRef = useRef<((transcript: string) => Promise<void>) | null>(null);
  const audioUnlockedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pendingAudioBlobRef = useRef<Blob | null>(null);

  const voicePhase = deriveVoicePhase({ isMuted, isSpeaking, isThinking, isRecordingCommand, isWakeArmed });

  // Load voice config.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(buildVoiceConfigUrl(), { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const config = (await res.json()) as VoiceConfig;
        setVoiceConfig(config);
        setVoiceModel(config.transcription.defaultModel);
        setTtsProvider((prev) => prev || config.tts.recommended || "browser");
      } catch {
        setVoiceError("Voice config unavailable");
      }
    })();
  }, []);

  // Load Deepgram voice list.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(buildVoiceVoicesUrl(), { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const data = (await res.json()) as { voices?: { id: string; name: string; description: string }[] };
        setDeepgramVoices(data.voices ?? []);
      } catch { /* voices are optional */ }
    })();
  }, []);

  // Sync voice settings from Settings tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jarvis.ttsProvider" && e.newValue !== null) setTtsProvider(e.newValue);
      if (e.key === "jarvis.deepgramVoice" && e.newValue !== null) setDeepgramVoice(e.newValue);
      if (e.key === "jarvis.voiceModel" && e.newValue !== null) setVoiceModel(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Keep ref mirrors in sync.
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isRecordingCommandRef.current = isRecordingCommand; }, [isRecordingCommand]);
  useEffect(() => { pendingVoiceIntentRef.current = pendingVoiceIntent; }, [pendingVoiceIntent]);

  // 10-second auto-expire countdown for pending intents.
  useEffect(() => {
    if (!pendingVoiceIntent) return;
    setIntentCountdown(Math.ceil((pendingVoiceIntent.expiresAt - Date.now()) / 1000));
    const interval = window.setInterval(() => {
      const remaining =
        Math.ceil((pendingVoiceIntentRef.current?.expiresAt ?? Date.now()) - Date.now()) / 1000;
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

  // Cleanup on unmount.
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
    } catch { /* best-effort */ }
  }, []);

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

  const speakJarvis = useCallback(
    async (text: string): Promise<void> => {
      if (isMutedRef.current) return;
      setIsThinking(false);
      setIsSpeaking(true);
      setCanReplay(false);
      pendingAudioBlobRef.current = null;

      const playBlob = async (blob: Blob): Promise<boolean> => {
        const objectUrl = URL.createObjectURL(blob);
        const audio = new Audio(objectUrl);
        currentAudioRef.current = audio;
        return await new Promise<boolean>((resolve) => {
          let settled = false;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            if (timeoutId !== null) clearTimeout(timeoutId);
            URL.revokeObjectURL(objectUrl);
            if (currentAudioRef.current === audio) currentAudioRef.current = null;
            resolve(ok);
          };
          audio.addEventListener("ended", () => finish(true), { once: true });
          audio.addEventListener("error", () => finish(false), { once: true });
          audio.addEventListener("pause", () => finish(true), { once: true });
          timeoutId = setTimeout(() => finish(true), 30_000);
          audio.play().catch(() => finish(false));
        });
      };

      try {
        const candidates = [ttsProvider, ...(voiceConfig?.tts.providers ?? [])].filter(
          (p, i, all) => p && p !== "browser" && all.indexOf(p) === i,
        );
        for (const provider of candidates) {
          if (isMutedRef.current) return;
          try {
            const speakBody: Record<string, string> = { text, provider };
            if (provider === "deepgram" && deepgramVoice) speakBody.model = deepgramVoice;
            const response = await apiFetch(buildVoiceSpeakUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(speakBody),
            });
            if (response.ok && !isMutedRef.current) {
              const blob = await response.blob();
              const played = await playBlob(blob);
              if (played) return;
              pendingAudioBlobRef.current = blob;
              setCanReplay(true);
              setVoiceError("Tap 🔊 Replay to hear the answer.");
              return;
            }
          } catch { /* try next */ }
        }

        if (!isMutedRef.current && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          await new Promise<void>((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            const timeoutId = setTimeout(resolve, 30_000);
            const done = () => { clearTimeout(timeoutId); resolve(); };
            utterance.addEventListener("end", done, { once: true });
            utterance.addEventListener("error", done, { once: true });
            window.speechSynthesis.speak(utterance);
          });
        } else if (!isMutedRef.current) {
          setVoiceError("Voice output unavailable — check your TTS provider in Settings.");
        }
      } finally {
        setIsSpeaking(false);
      }
    },
    [ttsProvider, voiceConfig, deepgramVoice],
  );

  useEffect(() => { speakJarvisRef.current = speakJarvis; }, [speakJarvis]);

  const stopAllVoiceActivity = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    for (const track of mediaStreamRef.current?.getTracks() ?? []) track.stop();
    mediaStreamRef.current = null;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
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
      try {
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

        // Chain detection: "open agents then deploy researcher" → execute each part sequentially
        const chainParts = transcript
          .split(/\s+(?:then|and then|after that|followed by)\s+/i)
          .map((p) => p.trim())
          .filter(Boolean);
        if (chainParts.length > 1) {
          for (const part of chainParts) {
            await runVoiceIntentRef.current?.(part);
          }
          return;
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
          setVoiceStatus("Searching brain");
          await speakJarvis("Searching your brain.");
          return;
        }

        if (intent.type === "brain-capture") {
          const captureText = intent.text;
          const captureLabel =
            captureText.length > 60 ? `${captureText.slice(0, 60)}…` : captureText;
          setPendingVoiceIntent({
            displayLabel: `Capture to brain: "${captureLabel}"`,
            confirmLabel: "CONFIRM CAPTURE",
            onConfirm: async () => {
              const response = await apiFetch(buildBrainCaptureUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: captureText }),
              });
              if (!response.ok) { setVoiceError("Capture failed"); return; }
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
          const rememberLabel =
            rememberText.length > 60 ? `${rememberText.slice(0, 60)}…` : rememberText;
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
              if (!response.ok) { setVoiceError("Unable to create agent"); return; }
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

        if (intent.type === "deploy-agent") {
          const { archetypeId, archetypeName } = intent;
          setPendingVoiceIntent({
            displayLabel: `Deploy agent: ${archetypeName}`,
            confirmLabel: "CONFIRM DEPLOY",
            onConfirm: async () => {
              const res = await apiFetch(buildDeployAgentUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ archetypeId }),
              });
              if (!res.ok) { setVoiceError(`Could not deploy ${archetypeName}`); return; }
              onNavigate(1);
              setVoiceStatus(`${archetypeName} deployed`);
              pushNotification(`Agent deployed: ${archetypeName}`);
              await speakJarvisRef.current?.(`${archetypeName} is ready.`);
            },
            expiresAt: Date.now() + 10_000,
          });
          setVoiceStatus("Awaiting confirmation");
          await speakJarvis(`Deploy ${archetypeName}. Confirm or cancel.`);
          return;
        }

        if (intent.type === "run-skill") {
          const { skillName } = intent;
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
          const { workflowName } = intent;
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
          const REALTIME_RE =
            /\b(weather|temp(erature)?|forecast|today|tonight|current(ly)?|right now|latest|live|news|score|game|price|stock|crypto|what time|open now|happening)\b/i;
          const ackText = REALTIME_RE.test(intent.question)
            ? "One sec, let me look that up."
            : "Let me think about that.";
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
          if (!res.ok) { setVoiceError("Ask failed"); return; }
          const data = (await res.json()) as {
            available?: boolean;
            answer?: string;
            hint?: string;
            via?: string;
            sources?: { title: string; path: string }[];
          };
          if (data.available && typeof data.answer === "string") {
            const cleanAnswer = stripMarkdownForSpeech(data.answer);
            onVoiceAnswer(cleanAnswer, Array.isArray(data.sources) ? data.sources : [], typeof data.via === "string" ? data.via : null);
            setVoiceStatus("Answered");
            void loadConversation();
            await speakJarvis(cleanAnswer);
          } else {
            const note = data.hint ?? "I couldn't reach an answer model. Check your API keys.";
            onVoiceAnswerFailed(note);
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
    [
      loadConversation,
      loadMemory,
      loadRecent,
      onNavigate,
      onVoiceAnswer,
      onVoiceAnswerFailed,
      speakJarvis,
      chatModelRef,
    ],
  );
  runVoiceIntentRef.current = runVoiceIntent;

  const transcribeCommandAudio = useCallback(
    async (audio: Blob) => {
      if (!voiceConfig?.transcription.configured) {
        setVoiceError("Set DEEPGRAM_API_KEY or OPENAI_API_KEY to enable voice commands");
        setVoiceStatus("Transcription unavailable");
        return;
      }
      setVoiceStatus("Transcribing");
      setIsThinking(true);
      try {
        const response = await apiFetch(
          buildVoiceTranscribeUrl(voiceModel ?? voiceConfig.transcription.defaultModel ?? null),
          {
            method: "POST",
            headers: { "Content-Type": audio.type || "audio/webm" },
            body: audio,
          },
        );
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
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  }, []);

  const startCommandRecording = useCallback(async () => {
    if (isMutedRef.current) return;
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
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    });
    let silenceAudioCtx: AudioContext | null = null;
    recorder.addEventListener("stop", () => {
      isRecordingCommandRef.current = false;
      setIsRecordingCommand(false);
      silenceAudioCtx?.close().catch(() => {});
      for (const track of stream.getTracks()) track.stop();
      mediaStreamRef.current = null;
      const audio = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (audio.size === 0) {
        setVoiceError("No audio captured — check your microphone in Windows Settings → Sound → Input.");
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
    recordingTimerRef.current = window.setTimeout(() => stopCommandRecording(), 30000);
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
        for (const sample of silenceBuf) { const s = (sample - 128) / 128; sumSq += s * s; }
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
          stopCommandRecording();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch { /* Web Audio unavailable — hard-cap timer handles stopping */ }
  }, [maybeContinueLoop, runVoiceIntent, stopCommandRecording, transcribeCommandAudio, voiceConfig]);

  useEffect(() => {
    startCommandRecordingRef.current = () => { void startCommandRecording(); };
  }, [startCommandRecording]);

  // Tab visibility: pause when hidden, re-arm when shown.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (isListeningRef.current) {
          stopAllVoiceActivity();
          setVoiceStatus("Paused — tab hidden");
        }
        return;
      }
      if (shouldResumeWakeLoop({ handsFreeOn: isListeningRef.current, isMuted: isMutedRef.current, isVisible: true })) {
        startWakeListeningRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopAllVoiceActivity]);

  const stopListening = useCallback(() => {
    setIsListening(false);
    isListeningRef.current = false;
    stopAllVoiceActivity();
    setVoiceStatus("Voice idle");
  }, [stopAllVoiceActivity]);

  const startWakeListening = useCallback(() => {
    if (isMutedRef.current || isRecordingCommandRef.current) return;
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
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i]?.[0]?.transcript;
        if (t) transcripts.push(t);
      }
      const transcript = transcripts.join(" ");
      setLastVoiceTranscript(transcript);
      if (!hasWakePhrase(transcript, phrases)) return;
      const commandAfterWake = extractCommandAfterWake(transcript, phrases);
      recognition.stop();
      setIsWakeArmed(false);
      if (commandAfterWake && commandAfterWake.split(/\s+/).length >= 2) {
        void runVoiceIntent(commandAfterWake).finally(() => maybeContinueLoop());
        return;
      }
      void startCommandRecording();
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceError("Microphone is blocked. Allow mic access for this page, then Start again.");
        setIsListening(false);
        isListeningRef.current = false;
        return;
      }
      if (event.error && event.error !== "no-speech") {
        setVoiceStatus(`Voice hiccup (${event.error}) — retrying…`);
      }
    };
    recognition.onend = () => {
      setIsWakeArmed(false);
      if (isListeningRef.current && !isMutedRef.current && !isRecordingCommandRef.current && document.visibilityState === "visible") {
        window.setTimeout(() => startWakeListeningRef.current?.(), 250);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsWakeArmed(true);
    setVoiceStatus('Listening for “Jarvis”…');
  }, [maybeContinueLoop, runVoiceIntent, startCommandRecording, voiceConfig]);

  const startListening = useCallback(() => {
    unlockAudio();
    setIsMuted(false);
    isMutedRef.current = false;
    setIsListening(true);
    isListeningRef.current = true;
    startWakeListening();
  }, [startWakeListening, unlockAudio]);

  const togglePushToTalk = useCallback(() => {
    unlockAudio();
    if (isMutedRef.current) { setIsMuted(false); isMutedRef.current = false; }
    if (isRecordingCommandRef.current) { stopCommandRecording(); return; }
    void startCommandRecording();
  }, [startCommandRecording, stopCommandRecording, unlockAudio]);

  useEffect(() => { startWakeListeningRef.current = startWakeListening; }, [startWakeListening]);

  // Stable ref-backed callback so submitAsk doesn't need to close over voice state directly.
  const autoSpeakIfListening = useCallback(
    (text: string) => {
      if (isListeningRef.current && !isMutedRef.current) {
        void speakJarvisRef.current?.(text);
      }
    },
    [],
  );

  return {
    voiceConfig,
    voiceModel,
    ttsProvider,
    deepgramVoice,
    deepgramVoices,
    voiceStatus,
    voiceError,
    voicePhase,
    isWakeArmed,
    isRecordingCommand,
    lastVoiceTranscript,
    isListening,
    isMuted,
    isSpeaking,
    isThinking,
    canReplay,
    pendingVoiceIntent,
    setPendingVoiceIntent,
    intentCountdown,
    startListening,
    stopListening,
    togglePushToTalk,
    hardMute,
    unmute,
    speakJarvis,
    playPending,
    autoSpeakIfListening,
    VOICE_PHASE_LABELS,
  };
};
