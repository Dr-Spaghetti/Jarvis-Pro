import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleAnalyzerImageRoute,
  handleAnalyzerItemRoute,
  handleAnalyzerListRoute,
  handleAnalyzerVideoRoute,
} from "../src/createApiServer/analyzerRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

// ─── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  spawn: vi.fn((_cmd: string, args: string[]) => {
    // Return a fake process that errors immediately (ffmpeg not available)
    const emitter = {
      on: (event: string, cb: (code?: number) => void) => {
        if (event === "error") cb();
        return emitter;
      },
      stdio: "ignore",
    };
    return emitter;
  }),
}));

// Mock global fetch to prevent real network calls
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ─── helpers ───────────────────────────────────────────────────────────────────

const DEPS = {} as unknown as RouteHandlerDependencies;
const temps: string[] = [];
let origCwd: () => string;

const makeRequest = (method: string, body?: Buffer, headers?: Record<string, string>): IncomingMessage => {
  const req = {
    method,
    headers: headers ?? {},
  } as unknown as IncomingMessage & { [Symbol.asyncIterator]?: unknown };
  if (body) {
    (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () {
        yield body;
      };
  } else {
    (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () {
        // empty body
      };
  }
  return req;
};

const call = async (
  handler: (c: RouteHandlerContext, d: RouteHandlerDependencies) => Promise<boolean>,
  method: string,
  url: string,
  body?: Buffer,
  headers?: Record<string, string>,
) => {
  let status = 0;
  const parts: string[] = [];
  const response = {
    writeHead(s: number) {
      status = s;
      return response;
    },
    end(chunk?: string) {
      if (chunk) parts.push(String(chunk));
    },
  } as unknown as ServerResponse;
  const ctx: RouteHandlerContext = {
    request: makeRequest(method, body, headers),
    response,
    requestUrl: new URL(url, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handler(ctx, DEPS);
  const json = parts.length ? JSON.parse(parts.join("")) : null;
  return { handled, status, json };
};

// ─── test setup ───────────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "octogent-analyzer-"));
  temps.push(tmpRoot);
  // Override process.cwd to point to our temp dir (analyzerRoutes uses process.cwd() + ".octogent/analyses")
  origCwd = process.cwd;
  process.cwd = () => tmpRoot;
  fetchMock.mockReset();
});

afterEach(() => {
  process.cwd = origCwd;
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

// ─── list route ───────────────────────────────────────────────────────────────

describe("handleAnalyzerListRoute", () => {
  it("returns not-handled for unrelated paths", async () => {
    const { handled } = await call(handleAnalyzerListRoute, "GET", "/api/brainstorm/ideas");
    expect(handled).toBe(false);
  });

  it("GET /api/analyzer returns empty list when no analyses", async () => {
    const { handled, status, json } = await call(handleAnalyzerListRoute, "GET", "/api/analyzer");
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.analyses).toEqual([]);
  });

  it("returns 405 for non-GET", async () => {
    const { handled, status } = await call(handleAnalyzerListRoute, "POST", "/api/analyzer");
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });
});

// ─── image route ──────────────────────────────────────────────────────────────

describe("handleAnalyzerImageRoute", () => {
  it("returns not-handled for unrelated path", async () => {
    const { handled } = await call(handleAnalyzerImageRoute, "POST", "/api/analyzer");
    expect(handled).toBe(false);
  });

  it("returns 400 for unsupported mime type", async () => {
    const { handled, status, json } = await call(
      handleAnalyzerImageRoute,
      "POST",
      "/api/analyzer/image",
      Buffer.from("data"),
      { "content-type": "application/pdf" },
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/unsupported/i);
  });

  it("returns 400 for empty body", async () => {
    const { handled, status, json } = await call(
      handleAnalyzerImageRoute,
      "POST",
      "/api/analyzer/image",
      Buffer.from(""),
      { "content-type": "image/jpeg" },
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/empty/i);
  });

  it("returns 503 when Gemini and Claude both fail", async () => {
    const savedGemini = process.env.GEMINI_API_KEY;
    const savedAnthropix = process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = "test-key";

    // Both calls fail
    fetchMock.mockResolvedValue({ ok: false, status: 429 });

    const { handled, status, json } = await call(
      handleAnalyzerImageRoute,
      "POST",
      "/api/analyzer/image",
      Buffer.from("fake-image-data"),
      { "content-type": "image/jpeg", "x-filename": "test.jpg" },
    );
    expect(handled).toBe(true);
    expect(status).toBe(503);
    expect(json.error).toBeTruthy();

    process.env.GEMINI_API_KEY = savedGemini;
    process.env.ANTHROPIC_API_KEY = savedAnthropix;
  });

  it("saves analysis and returns 201 when Gemini succeeds", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const geminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  objects: "desk, laptop, coffee mug",
                  people: "none",
                  scene: "A home office workspace",
                  text_on_image: "none",
                  composition: "horizontal framing",
                  style: "candid photograph",
                  contextual_cues: "natural daylight",
                }),
              },
            ],
          },
        },
      ],
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => geminiResponse,
    });

    const { handled, status, json } = await call(
      handleAnalyzerImageRoute,
      "POST",
      "/api/analyzer/image",
      Buffer.from("fake-jpeg-data"),
      { "content-type": "image/jpeg", "x-filename": "office.jpg" },
    );

    expect(handled).toBe(true);
    expect(status).toBe(201);
    expect(json.id).toMatch(/^analysis-\d+$/);
    expect(json.meta.type).toBe("image");
    expect(json.meta.filename).toBe("office.jpg");
    expect(json.result.provider).toBe("gemini");
    expect(json.result.scene).toContain("office");

    // Verify it was saved to disk
    const analysisDir = join(tmpRoot, ".octogent", "analyses", json.id);
    expect(existsSync(join(analysisDir, "meta.json"))).toBe(true);
    expect(existsSync(join(analysisDir, "result.json"))).toBe(true);
  });
});

// ─── video route ──────────────────────────────────────────────────────────────

describe("handleAnalyzerVideoRoute", () => {
  it("returns not-handled for unrelated path", async () => {
    const { handled } = await call(handleAnalyzerVideoRoute, "POST", "/api/analyzer/image");
    expect(handled).toBe(false);
  });

  it("returns 503 when GEMINI_API_KEY is missing", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const { handled, status, json } = await call(
      handleAnalyzerVideoRoute,
      "POST",
      "/api/analyzer/video",
      Buffer.from("fake-video-data"),
      { "content-type": "video/mp4", "x-filename": "test.mp4" },
    );

    expect(handled).toBe(true);
    expect(status).toBe(503);
    expect(json.error).toMatch(/GEMINI_API_KEY/);

    process.env.GEMINI_API_KEY = saved;
  });

  it("returns 400 for unsupported video type", async () => {
    const { handled, status, json } = await call(
      handleAnalyzerVideoRoute,
      "POST",
      "/api/analyzer/video",
      Buffer.from("data"),
      { "content-type": "video/3gpp" },
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/unsupported/i);
  });

  it("saves analysis with empty scenes when Gemini upload fails", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    // Gemini Files API upload fails
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const { handled, status, json } = await call(
      handleAnalyzerVideoRoute,
      "POST",
      "/api/analyzer/video",
      Buffer.from("fake-mp4-data"),
      { "content-type": "video/mp4", "x-filename": "clip.mp4" },
    );

    expect(handled).toBe(true);
    expect(status).toBe(201);
    expect(json.meta.type).toBe("video");
    expect(json.result.scenes).toEqual([]);
    expect(json.result.gemini_available).toBe(false);
    expect(json.result.ffmpeg_available).toBe(false);
  });
});

// ─── item route ───────────────────────────────────────────────────────────────

describe("handleAnalyzerItemRoute", () => {
  it("returns not-handled for collection path", async () => {
    const { handled } = await call(handleAnalyzerItemRoute, "GET", "/api/analyzer");
    expect(handled).toBe(false);
  });

  it("returns 404 for unknown analysis id", async () => {
    const { handled, status } = await call(
      handleAnalyzerItemRoute,
      "GET",
      "/api/analyzer/analysis-9999999",
    );
    expect(handled).toBe(true);
    expect(status).toBe(404);
  });

  it("returns saved analysis", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const geminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  objects: "chair",
                  people: "none",
                  scene: "empty room",
                  text_on_image: "none",
                  composition: "centered",
                  style: "photo",
                  contextual_cues: "none",
                }),
              },
            ],
          },
        },
      ],
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => geminiResponse });

    const createResult = await call(
      handleAnalyzerImageRoute,
      "POST",
      "/api/analyzer/image",
      Buffer.from("fake-data"),
      { "content-type": "image/png", "x-filename": "room.png" },
    );
    const id = createResult.json.id as string;

    const { handled, status, json } = await call(
      handleAnalyzerItemRoute,
      "GET",
      `/api/analyzer/${id}`,
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.meta.id).toBe(id);
    expect(json.result.scene).toBe("empty room");
  });
});

// ─── mergeTimeline (via integration) ─────────────────────────────────────────

describe("mergeTimeline logic", () => {
  it("produces timeline entries with visual and spoken merged", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    // Gemini Files API: init upload → upload URL header → upload → polling → generate content
    fetchMock
      // Init upload: return upload URL
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "https://fake-upload-url" },
      })
      // Upload: return file metadata
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          file: { uri: "https://fake-uri", name: "files/fake123", state: "ACTIVE" },
        }),
      })
      // State poll: already ACTIVE
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: "ACTIVE" }),
      })
      // generateContent: return scenes
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      scenes: [
                        { start: 0, end: 5, description: "Intro shot" },
                        { start: 5, end: 10, description: "Main content" },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      })
      // DELETE (cleanup): ignored
      .mockResolvedValueOnce({ ok: true });

    const { json } = await call(
      handleAnalyzerVideoRoute,
      "POST",
      "/api/analyzer/video",
      Buffer.from("fake-mp4"),
      { "content-type": "video/mp4", "x-filename": "test.mp4" },
    );

    expect(json.result.gemini_available).toBe(true);
    expect(json.result.scenes.length).toBe(2);
    expect(json.result.scenes[0].description).toBe("Intro shot");
    // Timeline should exist (even with no transcript)
    expect(Array.isArray(json.result.timeline)).toBe(true);
  });
});
