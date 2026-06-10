import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractPromptVariables,
  interpolatePromptVariables,
} from "../src/app/extractPromptVariables";
import { resetAppTestHarness } from "./test-utils/appTestHarness";

afterEach(() => {
  cleanup();
  resetAppTestHarness();
});

// ─── Unit: extractPromptVariables ─────────────────────────────────────────────

describe("extractPromptVariables", () => {
  it("returns empty array for content with no variables", () => {
    expect(extractPromptVariables("Hello world")).toEqual([]);
  });

  it("extracts a single variable", () => {
    expect(extractPromptVariables("Hello {{name}}!")).toEqual(["name"]);
  });

  it("extracts multiple distinct variables in order of first appearance", () => {
    expect(extractPromptVariables("{{greeting}} {{name}}, you have {{count}} messages.")).toEqual([
      "greeting",
      "name",
      "count",
    ]);
  });

  it("deduplicates repeated variable names", () => {
    expect(extractPromptVariables("{{x}} and {{x}} again")).toEqual(["x"]);
  });

  it("ignores malformed placeholders without inner word chars", () => {
    expect(extractPromptVariables("{{ }} and {{!}} are not vars")).toEqual([]);
  });
});

// ─── Unit: interpolatePromptVariables ─────────────────────────────────────────

describe("interpolatePromptVariables", () => {
  it("replaces a known variable", () => {
    expect(interpolatePromptVariables("Hello {{name}}!", { name: "Alice" })).toBe("Hello Alice!");
  });

  it("leaves unknown placeholders unchanged", () => {
    expect(interpolatePromptVariables("Hello {{name}}!", {})).toBe("Hello {{name}}!");
  });

  it("replaces multiple variables", () => {
    expect(
      interpolatePromptVariables("{{a}} + {{b}} = {{c}}", {
        a: "1",
        b: "2",
        c: "3",
      }),
    ).toBe("1 + 2 = 3");
  });
});

// ─── Hook: usePromptLibrary variable editor integration ───────────────────────

const buildFetchMock = (content: string) =>
  vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("/api/prompts") && !u.includes("/api/prompts/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            prompts: [{ name: "tp", source: "user", description: "" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (u.includes("/api/prompts/tp")) {
      return Promise.resolve(
        new Response(JSON.stringify({ name: "tp", source: "user", content, description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });

describe("usePromptLibrary variable editor", () => {
  it("promptVariables is empty for a prompt with no placeholders", async () => {
    const { usePromptLibrary } = await import("../src/app/hooks/usePromptLibrary");
    const { act, renderHook, waitFor: waitForHook } = await import("@testing-library/react");

    vi.spyOn(globalThis, "fetch").mockImplementation(buildFetchMock("No placeholders here."));

    const { result } = renderHook(() => usePromptLibrary({ enabled: true }));

    await waitForHook(() => {
      expect(result.current.prompts).toHaveLength(1);
    });

    await act(async () => {
      result.current.selectPrompt("tp");
    });

    await waitForHook(() => {
      expect(result.current.selectedPromptDetail).not.toBeNull();
    });

    expect(result.current.promptVariables).toEqual([]);
  });

  it("promptVariables lists variables from prompt content", async () => {
    const { usePromptLibrary } = await import("../src/app/hooks/usePromptLibrary");
    const { act, renderHook, waitFor: waitForHook } = await import("@testing-library/react");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      buildFetchMock("Hello {{name}}, your topic is {{topic}}."),
    );

    const { result } = renderHook(() => usePromptLibrary({ enabled: true }));

    await waitForHook(() => {
      expect(result.current.prompts).toHaveLength(1);
    });

    await act(async () => {
      result.current.selectPrompt("tp");
    });

    await waitForHook(() => {
      expect(result.current.selectedPromptDetail).not.toBeNull();
    });

    expect(result.current.promptVariables).toEqual(["name", "topic"]);
  });

  it("setVariableValue updates variableValues and interpolatedContent", async () => {
    const { usePromptLibrary } = await import("../src/app/hooks/usePromptLibrary");
    const { act, renderHook, waitFor: waitForHook } = await import("@testing-library/react");

    vi.spyOn(globalThis, "fetch").mockImplementation(buildFetchMock("Hi {{user}}!"));

    const { result } = renderHook(() => usePromptLibrary({ enabled: true }));

    await waitForHook(() => {
      expect(result.current.prompts).toHaveLength(1);
    });

    await act(async () => {
      result.current.selectPrompt("tp");
    });

    await waitForHook(() => {
      expect(result.current.selectedPromptDetail).not.toBeNull();
    });

    expect(result.current.interpolatedContent).toBe("Hi {{user}}!");

    await act(async () => {
      result.current.setVariableValue("user", "Alice");
    });

    expect(result.current.variableValues).toEqual({ user: "Alice" });
    expect(result.current.interpolatedContent).toBe("Hi Alice!");
  });

  it("clears variableValues when a new prompt is selected", async () => {
    const { usePromptLibrary } = await import("../src/app/hooks/usePromptLibrary");
    const { act, renderHook, waitFor: waitForHook } = await import("@testing-library/react");

    vi.spyOn(globalThis, "fetch").mockImplementation(buildFetchMock("Hello {{name}}!"));

    const { result } = renderHook(() => usePromptLibrary({ enabled: true }));

    await waitForHook(() => {
      expect(result.current.prompts).toHaveLength(1);
    });

    await act(async () => {
      result.current.selectPrompt("tp");
    });

    await waitForHook(() => {
      expect(result.current.selectedPromptDetail).not.toBeNull();
    });

    await act(async () => {
      result.current.setVariableValue("name", "Bob");
    });

    expect(result.current.variableValues).toEqual({ name: "Bob" });

    await act(async () => {
      result.current.selectPrompt("tp");
    });

    expect(result.current.variableValues).toEqual({});
  });
});
