import { describe, expect, it } from "vitest";

import { parseMemory, selectMemorySlice } from "../src/createApiServer/brain/memory";
import { proposeMemoryFromQuestion } from "../src/createApiServer/brain/proposeMemory";

describe("proposeMemoryFromQuestion", () => {
  it("proposes preferences into Me", () => {
    expect(proposeMemoryFromQuestion("I prefer email over phone")).toEqual([
      { text: "I prefer email over phone", section: "Me" },
    ]);
  });

  it("proposes commitments", () => {
    const proposed = proposeMemoryFromQuestion("I'll text Dan on Friday");
    expect(proposed[0]?.section).toBe("Commitments");
  });

  it("does not propose ordinary questions", () => {
    expect(proposeMemoryFromQuestion("What is the capital of France?")).toEqual([]);
    expect(proposeMemoryFromQuestion("how are you")).toEqual([]);
  });
});

describe("selectMemorySlice", () => {
  it("always includes Me and prefers question-relevant bullets", () => {
    const sections = parseMemory(`# Jarvis Memory

## Me

- Always be brief.

## People

- Rachel is the Venue contact.

## Facts

- Likes neon green.
`);
    const slice = selectMemorySlice(sections, "who is rachel", 12);
    expect(slice[0]).toBe("Always be brief.");
    expect(slice).toContain("Rachel is the Venue contact.");
  });
});
