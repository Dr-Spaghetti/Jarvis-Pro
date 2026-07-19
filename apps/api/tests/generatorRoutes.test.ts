import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub fetch before handler imports so the module captures the mock
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  handleGeneratorAnimateRoute,
  handleGeneratorAssetRoute,
  handleGeneratorDeleteRoute,
  handleGeneratorImageRoute,
  handleGeneratorItemRoute,
  handleGeneratorListRoute,
  handleGeneratorStatusRoute,
} from "../src/createApiServer/generatorRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

// ─── helpers ──────────────────────────────────────────────────────────────────

const DEPS = {} as unknown as RouteHandlerDependencies;
const temps: string[] = [];
let origCwd: () => string;
let tmpRoot: string;
const savedGeminiKey = process.env.GEMINI_API_KEY;

const makeRequest = (method: string, body?: Buffer): IncomingMessage => {
  const req = {
    method,
    headers: {},
    on: (_event: string, _cb: () => void) => req,
  } as unknown as IncomingMessage & { [Symbol.asyncIterator]?: unknown };
  (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
    async function* () {
      if (body) yield body;
    };
  return req;
};

const call = async (
  handler: (c: RouteHandlerContext, d: RouteHandlerDependencies) => Promise<boolean>,
  method: string,
  url: string,
  body?: unknown,
) => {
  let status = 0;
  const parts: Array<string | Buffer> = [];
  const responseHeaders: Record<string, unknown> = {};
  const response = {
    writeHead(s: number, h?: Record<string, unknown>) {
      status = s;
      if (h) Object.assign(responseHeaders, h);
      return response;
    },
    write(chunk: string | Buffer) {
      parts.push(chunk);
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk != null) parts.push(chunk);
    },
  } as unknown as ServerResponse;
  const bodyBuf = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
  const ctx: RouteHandlerContext = {
    request: makeRequest(method, bodyBuf),
    response,
    requestUrl: new URL(url, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handler(ctx, DEPS);
  const rawBuffer = parts.find((p): p is Buffer => p instanceof Buffer) ?? null;
  const text = parts
    .filter((p): p is string => typeof p === "string")
    .join("");
  let json: Record<string, unknown> | null = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* binary route — json stays null */
    }
  }
  return { handled, status, json, rawBuffer, responseHeaders };
};

const genDir = () => join(tmpRoot, ".octogent", "generations");

const writeMeta = (meta: object) => {
  mkdirSync(genDir(), { recursive: true });
  const id = (meta as { id: string }).id;
  writeFileSync(join(genDir(), `${id}.json`), JSON.stringify(meta));
};

const writeMedia = (id: string, ext: string, data = Buffer.from("fakedata")) => {
  mkdirSync(genDir(), { recursive: true });
  writeFileSync(join(genDir(), `${id}.${ext}`), data);
};

const readMeta = (id: string) =>
  JSON.parse(
    readFileSync(join(genDir(), `${id}.json`), "utf8"),
  ) as Record<string, unknown>;

// ─── setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "octogent-gen-"));
  temps.push(tmpRoot);
  origCwd = process.cwd;
  process.cwd = () => tmpRoot;
  fetchMock.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  process.cwd = origCwd;
  if (savedGeminiKey === undefined) {
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
  } else {
    process.env.GEMINI_API_KEY = savedGeminiKey;
  }
  vi.useRealTimers();
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("generatorRoutes", () => {
  // ── status ─────────────────────────────────────────────────────────────────

  describe("handleGeneratorStatusRoute", () => {
    it("returns 200 with key info", async () => {
      const res = await call(handleGeneratorStatusRoute, "GET", "/api/generator/status");
      expect(res.status).toBe(200);
      expect(res.json?.geminiKeyPresent).toBe(true);
      expect(res.json?.imagenModel).toBe("imagen-3.0-generate-001");
      expect(res.json?.veoModel).toBe("veo-2.0-generate-001");
    });

    it("reports geminiKeyPresent:false when key absent", async () => {
      Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
      const res = await call(handleGeneratorStatusRoute, "GET", "/api/generator/status");
      expect(res.json?.geminiKeyPresent).toBe(false);
    });

    it("does not handle unrelated paths", async () => {
      const res = await call(handleGeneratorStatusRoute, "GET", "/api/other");
      expect(res.handled).toBe(false);
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe("handleGeneratorListRoute", () => {
    it("returns empty array when no generations exist", async () => {
      const res = await call(handleGeneratorListRoute, "GET", "/api/generator");
      expect(res.status).toBe(200);
      expect(res.json?.generations).toEqual([]);
    });

    it("returns generations sorted newest-first", async () => {
      writeMeta({ id: "gen-100", mode: "text2image", prompt: "older", status: "completed", created: "2025-01-01T00:00:00.000Z" });
      writeMeta({ id: "gen-200", mode: "text2image", prompt: "newer", status: "completed", created: "2025-06-01T00:00:00.000Z" });
      const res = await call(handleGeneratorListRoute, "GET", "/api/generator");
      expect(res.status).toBe(200);
      const gens = res.json?.generations as Array<{ id: string }>;
      expect(gens[0]?.id).toBe("gen-200");
      expect(gens[1]?.id).toBe("gen-100");
    });

    it("does not handle unrelated paths", async () => {
      const res = await call(handleGeneratorListRoute, "GET", "/api/other");
      expect(res.handled).toBe(false);
    });
  });

  // ── item ───────────────────────────────────────────────────────────────────

  describe("handleGeneratorItemRoute", () => {
    it("returns 200 with metadata for existing id", async () => {
      writeMeta({ id: "gen-abc", mode: "text2image", prompt: "hello", status: "completed", created: new Date().toISOString() });
      const res = await call(handleGeneratorItemRoute, "GET", "/api/generator/gen-abc");
      expect(res.status).toBe(200);
      expect(res.json?.id).toBe("gen-abc");
      expect(res.json?.prompt).toBe("hello");
    });

    it("returns 404 for unknown id", async () => {
      const res = await call(handleGeneratorItemRoute, "GET", "/api/generator/gen-missing");
      expect(res.status).toBe(404);
      expect(String(res.json?.error)).toMatch(/not found/i);
    });
  });

  // ── asset ──────────────────────────────────────────────────────────────────

  describe("handleGeneratorAssetRoute", () => {
    it("serves a PNG with correct Content-Type and binary body", async () => {
      const fakeImg = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      writeMedia("gen-img", "png", fakeImg);
      const res = await call(handleGeneratorAssetRoute, "GET", "/api/generator/assets/gen-img");
      expect(res.status).toBe(200);
      expect(res.responseHeaders["Content-Type"]).toBe("image/png");
      expect(res.rawBuffer?.equals(fakeImg)).toBe(true);
    });

    it("serves an MP4 with correct Content-Type", async () => {
      writeMedia("gen-vid", "mp4", Buffer.from("fakevid"));
      const res = await call(handleGeneratorAssetRoute, "GET", "/api/generator/assets/gen-vid");
      expect(res.status).toBe(200);
      expect(res.responseHeaders["Content-Type"]).toBe("video/mp4");
    });

    it("returns 404 when no media file found", async () => {
      writeMeta({ id: "gen-nomedia", mode: "text2image", prompt: "test", status: "completed", created: new Date().toISOString() });
      const res = await call(handleGeneratorAssetRoute, "GET", "/api/generator/assets/gen-nomedia");
      expect(res.status).toBe(404);
    });

    it("returns 400 for id with invalid characters", async () => {
      // '!' is not in [a-zA-Z0-9_-] — safeId rejects it
      const res = await call(handleGeneratorAssetRoute, "GET", "/api/generator/assets/gen!bad");
      expect(res.status).toBe(400);
    });

    it("does not match non-assets paths", async () => {
      const res = await call(handleGeneratorAssetRoute, "GET", "/api/generator/gen-abc");
      expect(res.handled).toBe(false);
    });
  });

  // ── image (Imagen 3) ───────────────────────────────────────────────────────

  describe("handleGeneratorImageRoute", () => {
    it("returns 400 when prompt is missing", async () => {
      const res = await call(handleGeneratorImageRoute, "POST", "/api/generator/image", {});
      expect(res.status).toBe(400);
      expect(String(res.json?.error)).toMatch(/prompt/i);
    });

    it("returns 503 when GEMINI_API_KEY not set", async () => {
      Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
      const res = await call(handleGeneratorImageRoute, "POST", "/api/generator/image", { prompt: "test" });
      expect(res.status).toBe(503);
    });

    it("returns 201 with completed meta and writes PNG to disk", async () => {
      const fakeB64 = Buffer.from("fake-png-bytes").toString("base64");
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ predictions: [{ bytesBase64Encoded: fakeB64, mimeType: "image/png" }] }),
      });
      const res = await call(handleGeneratorImageRoute, "POST", "/api/generator/image", {
        prompt: "a red circle",
        aspectRatio: "16:9",
      });
      expect(res.status).toBe(201);
      expect(res.json?.status).toBe("completed");
      expect(String(res.json?.resultUrl)).toMatch(/\/api\/generator\/assets\//);
      const id = res.json?.id as string;
      expect(existsSync(join(genDir(), `${id}.png`))).toBe(true);
    });

    it("defaults aspectRatio to 1:1 when omitted", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ predictions: [{ bytesBase64Encoded: Buffer.from("img").toString("base64"), mimeType: "image/png" }] }),
      });
      await call(handleGeneratorImageRoute, "POST", "/api/generator/image", { prompt: "test" });
      const body = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      ) as { parameters: { aspectRatio: string } };
      expect(body.parameters.aspectRatio).toBe("1:1");
    });

    it("returns 502 when Imagen API call fails", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ error: { message: "quota exceeded" } }),
      });
      const res = await call(handleGeneratorImageRoute, "POST", "/api/generator/image", { prompt: "test" });
      expect(res.status).toBe(502);
    });

    it("returns 502 when predictions array is empty", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ predictions: [] }),
      });
      const res = await call(handleGeneratorImageRoute, "POST", "/api/generator/image", { prompt: "test" });
      expect(res.status).toBe(502);
    });
  });

  // ── animate (Veo 2) ────────────────────────────────────────────────────────

  describe("handleGeneratorAnimateRoute", () => {
    it("returns 400 when prompt is missing", async () => {
      const res = await call(handleGeneratorAnimateRoute, "POST", "/api/generator/animate", {});
      expect(res.status).toBe(400);
    });

    it("returns 503 when GEMINI_API_KEY not set", async () => {
      Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
      const res = await call(handleGeneratorAnimateRoute, "POST", "/api/generator/animate", { prompt: "wave" });
      expect(res.status).toBe(503);
    });

    it("returns 202 immediately with generating status", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "operations/op-1" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from("v").toString("base64"), mimeType: "video/mp4" }] } }),
        });
      const res = await call(handleGeneratorAnimateRoute, "POST", "/api/generator/animate", { prompt: "ocean" });
      expect(res.status).toBe(202);
      expect(res.json?.status).toBe("generating");
      expect(res.json?.mode).toBe("image2video");
    });

    it("background task completes with status completed and mp4 on disk", async () => {
      vi.useFakeTimers();
      const fakeVidB64 = Buffer.from("fakevideo").toString("base64");
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "operations/op-1" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            done: true,
            response: { videos: [{ bytesBase64Encoded: fakeVidB64, mimeType: "video/mp4" }] },
          }),
        });

      const res = await call(handleGeneratorAnimateRoute, "POST", "/api/generator/animate", { prompt: "ocean" });
      const id = res.json?.id as string;

      // Advance past veoPoll's 8-second setTimeout, then flush microtasks
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();

      const meta = readMeta(id);
      expect(meta.status).toBe("completed");
      expect(String(meta.resultUrl)).toMatch(/\/api\/generator\/assets\//);
      expect(existsSync(join(genDir(), `${id}.mp4`))).toBe(true);
    });

    it("background task sets failed when veoStart fails", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValueOnce({ ok: false });

      const res = await call(handleGeneratorAnimateRoute, "POST", "/api/generator/animate", { prompt: "fail" });
      const id = res.json?.id as string;

      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();

      expect(readMeta(id).status).toBe("failed");
    });

    it("reads local imageId from disk and passes image to Veo", async () => {
      vi.useFakeTimers();
      const srcId = "gen-src-img";
      writeMedia(srcId, "png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeMeta({ id: srcId, mode: "text2image", prompt: "src", status: "completed", created: new Date().toISOString() });

      const fakeVidB64 = Buffer.from("video").toString("base64");
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "operations/op-2" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ done: true, response: { videos: [{ bytesBase64Encoded: fakeVidB64, mimeType: "video/mp4" }] } }),
        });

      await call(handleGeneratorAnimateRoute, "POST", "/api/generator/animate", {
        prompt: "animate it",
        imageId: srcId,
      });

      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();

      // Only 2 fetches (veoStart + veoPoll) — no external image fetch
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const veoBody = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      ) as { instances: Array<{ image?: unknown }> };
      expect(veoBody.instances[0]?.image).toBeDefined();
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe("handleGeneratorDeleteRoute", () => {
    it("returns 200 ok:true for valid id even when no files exist", async () => {
      const res = await call(handleGeneratorDeleteRoute, "DELETE", "/api/generator/gen-xyz");
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
    });

    it("deletes metadata and media files", async () => {
      writeMeta({ id: "gen-del", mode: "text2image", prompt: "bye", status: "completed", created: new Date().toISOString() });
      writeMedia("gen-del", "png");
      expect(existsSync(join(genDir(), "gen-del.json"))).toBe(true);

      const res = await call(handleGeneratorDeleteRoute, "DELETE", "/api/generator/gen-del");
      expect(res.status).toBe(200);
      expect(existsSync(join(genDir(), "gen-del.json"))).toBe(false);
      expect(existsSync(join(genDir(), "gen-del.png"))).toBe(false);
    });

    it("returns 400 for id with invalid characters", async () => {
      const res = await call(handleGeneratorDeleteRoute, "DELETE", "/api/generator/gen!bad");
      expect(res.status).toBe(400);
    });

    it("does not handle GET requests on generator paths", async () => {
      const res = await call(handleGeneratorDeleteRoute, "GET", "/api/generator/gen-abc");
      expect(res.handled).toBe(false);
    });
  });
});
