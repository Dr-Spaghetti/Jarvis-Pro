export type VoicePhase = "idle" | "listening" | "thinking" | "speaking" | "muted";

export type VoicePhaseSignals = {
  isMuted: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  isRecordingCommand: boolean;
  isWakeArmed: boolean;
};

// Single source of truth for the visual voice indicator. Pure so it can be
// unit-tested and reused. Priority: a hard mute wins over everything; then the
// active output (speaking), then processing (thinking), then input (listening).
export const deriveVoicePhase = ({
  isMuted,
  isSpeaking,
  isThinking,
  isRecordingCommand,
  isWakeArmed,
}: VoicePhaseSignals): VoicePhase => {
  if (isMuted) {
    return "muted";
  }
  if (isSpeaking) {
    return "speaking";
  }
  if (isThinking) {
    return "thinking";
  }
  if (isRecordingCommand || isWakeArmed) {
    return "listening";
  }
  return "idle";
};

export const VOICE_PHASE_LABELS: Record<VoicePhase, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  muted: "Muted",
};
