import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JarvisConfigSection } from "../src/components/JarvisConfigSection";

const makeFetch = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("JarvisConfigSection", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/brain/recent"))
        return Promise.resolve(
          makeFetch({
            configured: true,
            notes: [
              {
                title: "My Note",
                path: "notes/my-note.md",
                modified: "2026-07-01T00:00:00Z",
                snippet: "Hello world",
              },
            ],
          }),
        );
      if (url.includes("/api/deck/skills"))
        return Promise.resolve(makeFetch({ skills: ["skill-a", "skill-b"] }));
      if (url.includes("/api/deck/tentacles"))
        return Promise.resolve(makeFetch({ tentacles: ["agent-1"] }));
      if (url.includes("/api/brain/journal")) return Promise.resolve(makeFetch({ entries: [] }));
      if (url.includes("/api/brain/memory"))
        return Promise.resolve(makeFetch({ items: ["remember X"] }));
      if (url.includes("/api/voice/config"))
        return Promise.resolve(
          makeFetch({
            tts: {
              configured: true,
              providers: ["deepgram", "browser"],
              configuredProviders: ["deepgram"],
              recommended: "deepgram",
            },
            transcription: {
              configured: true,
              defaultModel: "nova-2",
              models: ["nova-2"],
              phrases: [],
            },
            wake: { phrases: ["hey jarvis"] },
          }),
        );
      return Promise.resolve(makeFetch({}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders config values from API responses", async () => {
    render(<JarvisConfigSection />);
    expect(await screen.findByLabelText("Jarvis interface")).toBeInTheDocument();
    const connectedEls = await screen.findAllByText(/CONNECTED/i);
    expect(connectedEls.length).toBeGreaterThan(0);
  });

  it("shows empty state when vault is not configured", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/brain/recent"))
        return Promise.resolve(makeFetch({ configured: false, notes: [] }));
      return Promise.resolve(
        makeFetch({
          skills: [],
          tentacles: [],
          entries: [],
          items: [],
          tts: {
            configured: false,
            providers: ["browser"],
            configuredProviders: [],
            recommended: "browser",
          },
          transcription: { configured: false, defaultModel: "", models: [], phrases: [] },
          wake: { phrases: [] },
        }),
      );
    });
    render(<JarvisConfigSection />);
    const notConnected = await screen.findAllByText(/NOT CONNECTED/i);
    expect(notConnected.length).toBeGreaterThan(0);
  });

  it("shows memory empty state when no items returned", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/brain/memory")) return Promise.resolve(makeFetch({ items: [] }));
      if (url.includes("/api/brain/recent"))
        return Promise.resolve(makeFetch({ configured: true, notes: [] }));
      if (url.includes("/api/deck/skills")) return Promise.resolve(makeFetch({ skills: [] }));
      if (url.includes("/api/deck/tentacles")) return Promise.resolve(makeFetch({ tentacles: [] }));
      if (url.includes("/api/brain/journal")) return Promise.resolve(makeFetch({ entries: [] }));
      if (url.includes("/api/voice/config"))
        return Promise.resolve(
          makeFetch({
            tts: {
              configured: true,
              providers: ["deepgram", "browser"],
              configuredProviders: ["deepgram"],
              recommended: "deepgram",
            },
            transcription: {
              configured: true,
              defaultModel: "nova-2",
              models: ["nova-2"],
              phrases: [],
            },
            wake: { phrases: ["hey jarvis"] },
          }),
        );
      return Promise.resolve(makeFetch({}));
    });
    render(<JarvisConfigSection />);
    expect(await screen.findByText(/Nothing taught yet/i)).toBeInTheDocument();
  });
});
