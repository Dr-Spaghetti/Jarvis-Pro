import { useCallback, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { JarvisActivityFeed } from "./JarvisHome/JarvisActivityFeed";
import { JarvisConversationConsole } from "./JarvisHome/JarvisConversationConsole";
import { JarvisIntentConfirmOverlay } from "./JarvisHome/JarvisIntentConfirmOverlay";
import { JarvisVisualizer } from "./JarvisHome/JarvisVisualizer";
import { JarvisVoiceBar } from "./JarvisHome/JarvisVoiceBar";
import { JarvisVoiceStatus } from "./JarvisHome/JarvisVoiceStatus";
import { useJarvisAsk } from "./JarvisHome/useJarvisAsk";
import { useJarvisData } from "./JarvisHome/useJarvisData";
import { useJarvisVoice } from "./JarvisHome/useJarvisVoice";

type JarvisHomePrimaryViewProps = {
  onNavigate: (index: PrimaryNavIndex) => void;
};

export const JarvisHomePrimaryView = ({ onNavigate }: JarvisHomePrimaryViewProps) => {
  const [visMode, setVisMode] = useState<"core" | "radar" | "signal">("core");

  const data = useJarvisData();
  const {
    chatModel,
    conversation,
    setConversation,
    loadConversation,
    loadMemory,
    loadRecent,
    recentRuns,
  } = data;

  // chatModelRef: bridges chatModel (React state) into the voice hook's async callbacks.
  const chatModelRef = useRef(chatModel);
  chatModelRef.current = chatModel;

  // autoSpeakRef: ref bridge to break the ask ↔ voice circular dependency.
  // useJarvisAsk needs autoSpeakIfListening; useJarvisVoice needs handleVoiceAnswer.
  // We give useJarvisAsk a stable wrapper backed by this ref, then wire the ref
  // after useJarvisVoice initializes.
  const autoSpeakRef = useRef<(text: string) => void>(() => {});
  const stableAutoSpeak = useCallback((text: string) => autoSpeakRef.current(text), []);

  const ask = useJarvisAsk({
    chatModel,
    autoSpeakIfListening: stableAutoSpeak,
    loadConversation,
  });

  const voice = useJarvisVoice({
    onNavigate,
    loadConversation,
    loadMemory,
    loadRecent,
    chatModelRef,
    onVoiceAnswer: ask.handleVoiceAnswer,
    onVoiceAnswerFailed: ask.handleVoiceAnswerFailed,
  });

  // Wire ref — safe to do in render since ref mutation never triggers re-render.
  autoSpeakRef.current = voice.autoSpeakIfListening;

  return (
    <section className="nc-hq" aria-label="Jarvis home view">
      <div className="nc-hq-grid" aria-hidden="true" />
      <div className="nc-hq-scanlines" aria-hidden="true" />

      <JarvisVoiceStatus
        isSpeaking={voice.isSpeaking}
        isThinking={voice.isThinking}
        isRecordingCommand={voice.isRecordingCommand}
        isWakeArmed={voice.isWakeArmed}
      />

      <JarvisVisualizer visMode={visMode} setVisMode={setVisMode} />

      <JarvisVoiceBar
        isRecordingCommand={voice.isRecordingCommand}
        isMuted={voice.isMuted}
        isListening={voice.isListening}
        canReplay={voice.canReplay}
        togglePushToTalk={voice.togglePushToTalk}
        hardMute={voice.hardMute}
        unmute={voice.unmute}
        playPending={voice.playPending}
        startListening={voice.startListening}
        stopListening={voice.stopListening}
      />

      {voice.pendingVoiceIntent && (
        <JarvisIntentConfirmOverlay
          pendingVoiceIntent={voice.pendingVoiceIntent}
          intentCountdown={voice.intentCountdown}
          onConfirm={() => {
            const p = voice.pendingVoiceIntentRef.current;
            if (!p) return;
            voice.setPendingVoiceIntent(null);
            void voice
              .speakJarvis("Confirmed.")
              .then(() => p.onConfirm())
              .catch(() => p.onConfirm());
          }}
          onCancel={() => {
            voice.setPendingVoiceIntent(null);
            void voice.speakJarvis("Cancelled.");
          }}
        />
      )}

      {voice.voiceError && <div className="nc-hq-voice-error">{voice.voiceError}</div>}

      <JarvisActivityFeed recentRuns={recentRuns} />

      <JarvisConversationConsole
        conversation={conversation}
        isThinking={voice.isThinking}
        asking={ask.asking}
        ask={ask.ask}
        setAsk={ask.setAsk}
        askNote={ask.askNote}
        answerVia={ask.answerVia}
        answerSources={ask.answerSources}
        answerCitations={ask.answerCitations}
        sourcesExpanded={ask.sourcesExpanded}
        setSourcesExpanded={ask.setSourcesExpanded}
        submitAsk={() => void ask.submitAsk()}
        onNewChat={() => ask.startNewChat(() => setConversation([]))}
      />
    </section>
  );
};
