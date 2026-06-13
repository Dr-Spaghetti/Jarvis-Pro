import { describe, expect, it } from "vitest";
import { resolveJarvisVoiceIntent } from "../src/voiceIntent";

describe("resolveJarvisVoiceIntent", () => {
  it("routes a conversational question to the Ask-Jarvis brain", () => {
    const { intent } = resolveJarvisVoiceIntent("how are you doing today jarvis");
    expect(intent.type).toBe("ask");
    // Trailing wake-word address is stripped from the question.
    if (intent.type === "ask") {
      expect(intent.question).toBe("how are you doing today");
    }
  });

  it("answers an explicit 'ask jarvis' even when it contains a nav keyword", () => {
    const { intent } = resolveJarvisVoiceIntent("ask jarvis what is on my deck");
    expect(intent.type).toBe("ask");
    if (intent.type === "ask") {
      expect(intent.question).toBe("what is on my deck");
    }
  });

  it("treats leftover non-command speech as a question by default", () => {
    const { intent } = resolveJarvisVoiceIntent("jarvis remind me about the proposal later");
    expect(intent.type).toBe("ask");
  });

  it("still routes explicit brain search commands", () => {
    const { intent } = resolveJarvisVoiceIntent("jarvis search my brain for pricing");
    expect(intent).toEqual({ type: "brain-search", query: "pricing" });
  });

  it("still routes navigation commands", () => {
    expect(resolveJarvisVoiceIntent("jarvis open settings").intent).toEqual({
      type: "navigate",
      target: "settings",
    });
    expect(resolveJarvisVoiceIntent("jarvis go home").intent).toEqual({
      type: "navigate",
      target: "jarvis",
    });
  });

  it("still routes agent creation commands", () => {
    const { intent } = resolveJarvisVoiceIntent("jarvis start a new agent");
    expect(intent.type).toBe("create-terminal");
  });

  it("does not navigate home just because a sentence ends with the wake word", () => {
    const { intent } = resolveJarvisVoiceIntent("what should I focus on first jarvis");
    expect(intent.type).toBe("ask");
  });

  it("returns unknown with empty text when only the wake word is heard", () => {
    const { intent } = resolveJarvisVoiceIntent("jarvis");
    expect(intent).toEqual({ type: "unknown", text: "" });
  });
});
