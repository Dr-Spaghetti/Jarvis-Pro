type Props = {
  isRecordingCommand: boolean;
  isMuted: boolean;
  canReplay: boolean;
  togglePushToTalk: () => void;
  hardMute: () => void;
  unmute: () => void;
  playPending: () => Promise<void>;
};

export const JarvisVoiceBar = ({
  isRecordingCommand,
  isMuted,
  canReplay,
  togglePushToTalk,
  hardMute,
  unmute,
  playPending,
}: Props) => (
  <div className="nc-hq-voice-bar">
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
