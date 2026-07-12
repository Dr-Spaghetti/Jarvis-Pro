type Props = {
  isRecordingCommand: boolean;
  isMuted: boolean;
  isListening: boolean;
  canReplay: boolean;
  togglePushToTalk: () => void;
  hardMute: () => void;
  unmute: () => void;
  playPending: () => Promise<void>;
  startListening: () => void;
  stopListening: () => void;
};

export const JarvisVoiceBar = ({
  isRecordingCommand,
  isMuted,
  isListening,
  canReplay,
  togglePushToTalk,
  hardMute,
  unmute,
  playPending,
  startListening,
  stopListening,
}: Props) => (
  <div className="nc-hq-voice-bar">
    <button
      type="button"
      className="nc-hq-handsfree-btn"
      data-active={isListening}
      aria-pressed={isListening}
      title={isListening ? 'Hands-free on — say "Jarvis" to activate' : "Enable hands-free mode"}
      onClick={isListening ? stopListening : startListening}
    >
      {isListening ? "🎤 HANDS FREE ON" : "HANDS FREE"}
    </button>
    <button
      type="button"
      className="nc-hq-talk-btn"
      data-recording={isRecordingCommand}
      onClick={togglePushToTalk}
    >
      {isRecordingCommand ? "● LISTENING — TAP TO SEND" : "🎙 TAP TO TALK"}
    </button>
    {canReplay && (
      <button type="button" className="nc-hq-replay-btn" onClick={() => void playPending()}>
        🔊 Replay
      </button>
    )}
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
);
