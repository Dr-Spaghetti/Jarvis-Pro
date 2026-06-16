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

  describe("remember (teach/correct) intent", () => {
    it("routes 'always …' to remember", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis always answer in one sentence");
      expect(intent).toEqual({ type: "remember", text: "answer in one sentence" });
    });

    it("routes 'from now on …' to remember", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis from now on call me boss");
      expect(intent).toEqual({ type: "remember", text: "call me boss" });
    });

    it("routes 'remember that …' to remember (not capture)", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis remember that I prefer email only");
      expect(intent.type).toBe("remember");
      if (intent.type === "remember") {
        expect(intent.text).toBe("i prefer email only");
      }
    });

    it("keeps 'remember this …' as a quick capture, not a durable rule", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis remember this invoice park place");
      expect(intent.type).toBe("brain-capture");
    });

    it("routes 'correction …' to remember", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis correction the venue contact is rachel");
      expect(intent).toEqual({ type: "remember", text: "the venue contact is rachel" });
    });
  });

  describe("run-skill intent", () => {
    it("routes explicit 'run skill [name]' to run-skill", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis run skill daily brief");
      expect(intent).toEqual({ type: "run-skill", skillName: "daily brief" });
    });

    it("routes 'execute skill [name]' to run-skill", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis execute skill review repair outreach");
      expect(intent).toEqual({ type: "run-skill", skillName: "review repair outreach" });
    });

    it("routes implicit 'run [name]' to run-skill when name is not a nav target", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis run morning report");
      expect(intent.type).toBe("run-skill");
      if (intent.type === "run-skill") {
        expect(intent.skillName).toBe("morning report");
      }
    });

    it("does not treat 'run new agent' as run-skill (terminal guard)", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis run new agent");
      expect(intent.type).toBe("create-terminal");
    });

    it("does not treat 'run deck' as run-skill (nav word guard)", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis run deck");
      expect(intent.type).toBe("navigate");
    });

    it("does not treat a question as run-skill (question opener guard)", () => {
      const { intent } = resolveJarvisVoiceIntent("what skill should I run");
      expect(intent.type).toBe("ask");
    });

    it("does not treat 'run the skill' (no name) as run-skill", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis run the skill");
      expect(intent.type).not.toBe("run-skill");
    });

    it("does not treat 'run skills' as run-skill", () => {
      const { intent } = resolveJarvisVoiceIntent("jarvis run skills");
      expect(intent.type).not.toBe("run-skill");
    });
  });
});
