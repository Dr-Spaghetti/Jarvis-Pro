type Props = {
  isSpeaking: boolean;
  isThinking: boolean;
  isRecordingCommand: boolean;
  isWakeArmed: boolean;
};

export const JarvisVoiceStatus = ({ isSpeaking, isThinking, isRecordingCommand, isWakeArmed }: Props) => (
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
);
