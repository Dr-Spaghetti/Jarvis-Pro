type Props = {
  isSpeaking: boolean;
  isThinking: boolean;
  isRecordingCommand: boolean;
  isWakeArmed: boolean;
};

export const JarvisVoiceStatus = ({
  isSpeaking,
  isThinking,
  isRecordingCommand,
  isWakeArmed,
}: Props) => (
  <div className="nc-hq-voice-status">
    <div className="nc-hq-voice-label">Voice</div>
    <div className="nc-hq-voice-indicator">
      <span className="nc-hq-voice-dot" aria-hidden="true" />
      {isSpeaking
        ? "Speaking"
        : isThinking
          ? "Thinking"
          : isRecordingCommand
            ? "Listening"
            : isWakeArmed
              ? "Wake armed"
              : "Ready"}
    </div>
  </div>
);
