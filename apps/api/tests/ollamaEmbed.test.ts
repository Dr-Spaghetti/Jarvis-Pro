import { describe, expect, it } from "vitest";

import { cosineSimilarity, embedViaOllama } from "../src/createApiServer/ollamaEmbed";

describe("ollamaEmbed", () => {
  it("cosineSimilarity is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("cosineSimilarity is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("cosineSimilarity is direction-invariant to magnitude", () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1, 6);
  });

  it("cosineSimilarity returns 0 for bad/empty/mismatched input", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("embedViaOllama returns null for empty text without making a request", async () => {
    expect(await embedViaOllama("   ")).toBeNull();
  });

  it("embedViaOllama returns null when the host is unreachable", async () => {
    const previous = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    try {
      expect(await embedViaOllama("hello")).toBeNull();
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "OLLAMA_HOST");
      else process.env.OLLAMA_HOST = previous;
    }
  });
});
