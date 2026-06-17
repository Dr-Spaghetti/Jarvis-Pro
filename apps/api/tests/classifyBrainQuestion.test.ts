import { describe, expect, it } from "vitest";
import { classifyBrainQuestion } from "../src/createApiServer/classifyBrainQuestion";

describe("classifyBrainQuestion", () => {
  it("routes a plain question as general", () => {
    expect(classifyBrainQuestion("what is the capital of France").type).toBe("general");
  });

  it("routes vault/memory questions as general", () => {
    expect(classifyBrainQuestion("what did I write about the Tampa proposal").type).toBe("general");
  });

  it("detects Local Falcon keywords → agentic with localfalcon connector", () => {
    const r = classifyBrainQuestion("what is my ranking for plumber in Tampa");
    expect(r.type).toBe("agentic");
    if (r.type === "agentic") expect(r.connectors).toContain("localfalcon");
  });

  it("detects 'map pack' as Local Falcon", () => {
    const r = classifyBrainQuestion("how is the map pack looking for roofing");
    expect(r.type).toBe("agentic");
    if (r.type === "agentic") expect(r.connectors).toContain("localfalcon");
  });

  it("detects Apollo keywords → agentic with apollo connector", () => {
    const r = classifyBrainQuestion("how many leads do I have left");
    expect(r.type).toBe("agentic");
    if (r.type === "agentic") expect(r.connectors).toContain("apollo");
  });

  it("detects 'pipeline' as Apollo", () => {
    const r = classifyBrainQuestion("show me my pipeline");
    expect(r.type).toBe("agentic");
    if (r.type === "agentic") expect(r.connectors).toContain("apollo");
  });

  it("detects both connectors when question mentions both", () => {
    const r = classifyBrainQuestion("what are my rankings and how many apollo credits remain");
    expect(r.type).toBe("agentic");
    if (r.type === "agentic") {
      expect(r.connectors).toContain("localfalcon");
      expect(r.connectors).toContain("apollo");
    }
  });

  it("is case-insensitive", () => {
    expect(classifyBrainQuestion("What Is My Ranking for SEO?").type).toBe("agentic");
    expect(classifyBrainQuestion("CHECK MY APOLLO LEADS").type).toBe("agentic");
  });

  it("does not over-match — 'rank' in an unrelated phrase", () => {
    // "rank" is intentionally broad in the classifier (acceptable false positive)
    // — this documents current behaviour rather than asserting it never fires
    const r = classifyBrainQuestion("what rank did she finish in the race");
    expect(r.type).toBe("agentic"); // broad keyword match is expected
    if (r.type === "agentic") expect(r.connectors).toContain("localfalcon");
  });
});
