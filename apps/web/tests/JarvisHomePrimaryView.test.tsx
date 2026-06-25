import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JarvisHomePrimaryView } from "../src/components/JarvisHomePrimaryView";

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const mockJarvisHomeFetch = () =>
  vi.fn(async (input: RequestInfo | URL) => {
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
    if (url.includes("/api/voice/voices")) {
      return jsonResponse({ voices: [] });
    }
    if (url.includes("/api/voice/transcribe")) {
      return jsonResponse({ text: "" });
    }
    return jsonResponse({});
  });

const installFetchMock = (fetchMock: ReturnType<typeof mockJarvisHomeFetch>) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);
  vi.spyOn(window, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);
};

class SilentAudioContext {
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});

  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 8,
      getByteTimeDomainData: (buffer: Uint8Array) => {
        buffer.fill(128);
      },
    };
  }

  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];

  mimeType = "audio/webm";
  state: RecordingState = "inactive";
  private readonly listeners = new Map<string, EventListener[]>();

  constructor() {
    MockMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state !== "recording") return;
    this.state = "inactive";
    this.emit("dataavailable", { data: new Blob(["voice"], { type: "audio/webm" }) });
    this.emit("stop", {});
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as Event);
    }
  }
}

describe("JarvisHomePrimaryView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    MockMediaRecorder.instances = [];
  });

  it("shows the redesigned voice controls and loads voice config", async () => {
    const fetchMock = mockJarvisHomeFetch();
    installFetchMock(fetchMock);

    render(<JarvisHomePrimaryView onNavigate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "🎙 TAP TO TALK" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MUTE" })).toBeInTheDocument();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("/api/voice/config")),
      ).toBe(true);
    });
  });

  it("does not submit command audio during initial silence before speech starts", async () => {
    const fetchMock = mockJarvisHomeFetch();
    installFetchMock(fetchMock);
    vi.stubGlobal("MediaRecorder", MockMediaRecorder as unknown as typeof MediaRecorder);
    vi.stubGlobal("AudioContext", SilentAudioContext as unknown as typeof AudioContext);
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          const track = { stop: vi.fn() };
          return { getTracks: () => [track] } as unknown as MediaStream;
        }),
      },
    });
    render(<JarvisHomePrimaryView onNavigate={vi.fn()} />);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("/api/voice/config")),
      ).toBe(true);
    });

    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(Date.now()), 100),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "🎙 TAP TO TALK" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /LISTENING/ })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2600);
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/voice/transcribe")),
    ).toHaveLength(0);
    expect(screen.getByRole("button", { name: /LISTENING/ })).toBeInTheDocument();
  });
});
