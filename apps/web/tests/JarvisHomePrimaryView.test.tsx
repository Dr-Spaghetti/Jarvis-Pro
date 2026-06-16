import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JarvisHomePrimaryView } from "../src/components/JarvisHomePrimaryView";

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("JarvisHomePrimaryView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the voice stack status and transcription model picker", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/brain/recent")) {
        return jsonResponse({ configured: true, notes: [] });
      }
      if (url.includes("/api/deck/skills")) {
        return jsonResponse([]);
      }
      if (url.includes("/api/deck/tentacles")) {
        return jsonResponse([]);
      }
      if (url.includes("/api/voice/config")) {
        return jsonResponse({
          wake: { phrases: ["yo jarvis", "heyo jarvis", "jarvis"] },
          transcription: {
            configured: true,
            defaultModel: "gpt-4o-mini-transcribe",
            models: ["gpt-4o-mini-transcribe", "whisper-1"],
            whisperSupported: true,
          },
          tts: { configured: false, fallback: "browser-speech-synthesis" },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<JarvisHomePrimaryView onNavigate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "🎙 Tap to talk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hands-free mode" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Transcription model" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/STT:/)).toHaveTextContent("STT: ready (gpt-4o-mini-transcribe)");
    });
    expect(screen.getByRole("option", { name: "whisper-1" })).toBeInTheDocument();
  });
});
