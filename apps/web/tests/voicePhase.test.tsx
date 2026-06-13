import { describe, expect, it } from "vitest";

import { VOICE_PHASE_LABELS, deriveVoicePhase } from "../src/app/voicePhase";

const base = {
  isMuted: false,
  isSpeaking: false,
  isThinking: false,
  isRecordingCommand: false,
  isWakeArmed: false,
};

describe("deriveVoicePhase", () => {
  it("defaults to idle", () => {
    expect(deriveVoicePhase(base)).toBe("idle");
  });

  it("muted wins over every other signal", () => {
    expect(
      deriveVoicePhase({
        isMuted: true,
        isSpeaking: true,
        isThinking: true,
        isRecordingCommand: true,
        isWakeArmed: true,
      }),
    ).toBe("muted");
  });

  it("speaking wins over thinking and listening", () => {
    expect(
      deriveVoicePhase({ ...base, isSpeaking: true, isThinking: true, isRecordingCommand: true }),
    ).toBe("speaking");
  });

  it("thinking wins over listening", () => {
    expect(deriveVoicePhase({ ...base, isThinking: true, isRecordingCommand: true })).toBe(
      "thinking",
    );
  });

  it("listening covers both active recording and an armed wake word", () => {
    expect(deriveVoicePhase({ ...base, isRecordingCommand: true })).toBe("listening");
    expect(deriveVoicePhase({ ...base, isWakeArmed: true })).toBe("listening");
  });

  it("has a label for every phase", () => {
    for (const phase of ["idle", "listening", "thinking", "speaking", "muted"] as const) {
      expect(VOICE_PHASE_LABELS[phase]).toBeTruthy();
    }
  });
});
