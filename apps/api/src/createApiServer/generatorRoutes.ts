import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

// ─── types ────────────────────────────────────────────────────────────────────

type GenerationMode = "text2image" | "image2video";
type GenerationStatus = "generating" | "completed" | "failed";

export type GenerationMeta = {
  id: string;
  mode: GenerationMode;
  prompt: string;
  status: GenerationStatus;
  resultUrl?: string;
  errorMessage?: string;
  model?: string;
  aspectRatio?: string;
  created: string;
  completedAt?: string;
};

// ─── storage helpers ──────────────────────────────────────────────────────────
// Images: .octogent/generations/<id>.png
// Videos: .octogent/generations/<id>.mp4
// Meta:   .octogent/generations/<id>.json

const getGenerationsDir = () => join(process.cwd(), ".octogent", "generations");

const safeId = (id: string): string | null => (/^[a-zA-Z0-9_-]+$/.test(id) ? id : null);

const safeGenerationPath = (id: string, ext: string): string | null => {
  if (!safeId(id)) return null;
  const base = getGenerationsDir();
  const target = resolve(join(base, `${id}.${ext}`));
  if (!target.startsWith(resolve(base) + sep)) return null;
  return target;
};

const readGenerationMeta = (id: string): GenerationMeta | null => {
  const path = safeGenerationPath(id, "json");
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GenerationMeta;
  } catch {
    return null;
  }
};

const saveGenerationMeta = (meta: GenerationMeta): void => {
  const dir = getGenerationsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = safeGenerationPath(meta.id, "json");
  if (!path) return;
  writeFileSync(path, JSON.stringify(meta, null, 2), "utf8");
};

const saveGenerationMedia = (
  id: string,
  buffer: Buffer,
  ext: "png" | "webp" | "jpg" | "mp4",
): void => {
  const dir = getGenerationsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = safeGenerationPath(id, ext);
  if (!path) return;
  writeFileSync(path, buffer);
};

const findGenerationMediaPath = (id: string): { path: string; mime: string } | null => {
  for (const [ext, mime] of [
    ["png", "image/png"],
    ["webp", "image/webp"],
    ["jpg", "image/jpeg"],
    ["mp4", "video/mp4"],
  ] as const) {
    const p = safeGenerationPath(id, ext);
    if (p && existsSync(p)) return { path: p, mime };
  }
  return null;
};

const listGenerations = (): GenerationMeta[] => {
  const dir = getGenerationsDir();
  if (!existsSync(dir)) return [];
  try {
    return (readdirSync(dir) as string[])
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), "utf8")) as GenerationMeta;
        } catch {
          return null;
        }
      })
      .filter((m): m is GenerationMeta => m !== null)
      .sort((a, b) => b.created.localeCompare(a.created));
  } catch {
    return [];
  }
};

// ─── stale-job cleanup ────────────────────────────────────────────────────────
// One-shot: marks any "generating" job older than 15 minutes as failed.
// Called lazily so server-restart orphans don't spin forever in the gallery.

let _cleanupDone = false;

const cleanupStaleGenerations = (): void => {
  if (_cleanupDone) return;
  _cleanupDone = true;
  const dir = getGenerationsDir();
  if (!existsSync(dir)) return;
  const STALE_MS = 15 * 60 * 1000;
  const now = Date.now();
  try {
    for (const file of (readdirSync(dir) as string[]).filter((f) => f.endsWith(".json"))) {
      try {
        const meta = JSON.parse(readFileSync(join(dir, file), "utf8")) as GenerationMeta;
        if (meta.status === "generating" && now - new Date(meta.created).getTime() > STALE_MS) {
          saveGenerationMeta({
            ...meta,
            status: "failed",
            errorMessage: "Server restarted mid-generation.",
            completedAt: new Date().toISOString(),
          });
        }
      } catch {
        // skip corrupted files
      }
    }
  } catch {
    // skip if dir unreadable
  }
};

// ─── Google AI (Gemini API) helpers ───────────────────────────────────────────
// Imagen 3:  imagen-3.0-generate-001 — text-to-image, ~5-15s, synchronous
// Veo 2:     veo-2.0-generate-001   — image/text-to-video, ~60-180s, async
// Both use the same GEMINI_API_KEY already in .env.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const IMAGEN_MODEL = "imagen-3.0-generate-001";
const VEO_MODEL = "veo-2.0-generate-001";

const getGeminiKey = (): string | null => process.env.GEMINI_API_KEY?.trim() ?? null;

const MISSING_KEY_MSG =
  "GEMINI_API_KEY not set. Add it to .env and restart Jarvis. (Same key used by the Content Analyzer.)";

type ImagenPrediction = { bytesBase64Encoded?: string; mimeType?: string };
type ImagenResponse = { predictions?: ImagenPrediction[]; error?: { message?: string } };

type VeoOperation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    videos?: Array<{ bytesBase64Encoded?: string; mimeType?: string; uri?: string }>;
  };
};

const imagenGenerate = async (
  prompt: string,
  aspectRatio: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ b64: string; mime: string } | string | null> => {
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${IMAGEN_MODEL}:predict?key=${apiKey}`, {
      method: "POST",
      signal: signal ?? null,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio,
          safetyFilterLevel: "block_some",
          personGeneration: "allow_adult",
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      try {
        const errData = JSON.parse(errText) as ImagenResponse;
        return errData.error?.message ?? null;
      } catch {
        return null;
      }
    }
    const data = (await res.json()) as ImagenResponse;
    const pred = data.predictions?.[0];
    if (!pred?.bytesBase64Encoded) return null;
    return { b64: pred.bytesBase64Encoded, mime: pred.mimeType ?? "image/png" };
  } catch {
    return null;
  }
};

const veoStart = async (
  prompt: string,
  imageB64: string | null,
  imageMime: string,
  aspectRatio: string,
  apiKey: string,
): Promise<string | null> => {
  const instance: Record<string, unknown> = { prompt };
  if (imageB64) {
    instance.image = { bytesBase64Encoded: imageB64, mimeType: imageMime };
  }
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${VEO_MODEL}:predictLongRunning?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [instance],
        parameters: { aspectRatio, durationSeconds: 8 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as VeoOperation;
    return data.name ?? null;
  } catch {
    return null;
  }
};

const veoPoll = async (
  operationName: string,
  apiKey: string,
  maxMs: number,
): Promise<{ b64: string; mime: string } | string | null> => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 8000));
    try {
      const res = await fetch(`${GEMINI_BASE}/${operationName}?key=${apiKey}`);
      if (!res.ok) continue;
      const op = (await res.json()) as VeoOperation;
      if (!op.done) continue;
      if (op.error?.message) return op.error.message;

      // Try predictions array first, then videos array
      const preds = op.response?.predictions ?? op.response?.videos ?? [];
      for (const p of preds) {
        if (p.bytesBase64Encoded) {
          return { b64: p.bytesBase64Encoded, mime: p.mimeType ?? "video/mp4" };
        }
        if ("uri" in p && typeof p.uri === "string" && p.uri) {
          return p.uri;
        }
      }
      return null;
    } catch {
      // keep polling
    }
  }
  return null;
};

const mimeToExt = (mime: string): "png" | "webp" | "jpg" | "mp4" => {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("mp4") || mime.includes("video")) return "mp4";
  return "png";
};

// Fetch an external image and return its base64 + mime for Veo input
const fetchImageAsB64 = async (url: string): Promise<{ b64: string; mime: string } | null> => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await r.arrayBuffer());
    return { b64: buf.toString("base64"), mime };
  } catch {
    return null;
  }
};

// Download a video URI (https:// or gs://) server-side.
// gs:// is Google Cloud Storage's native protocol; convert to the HTTPS endpoint
// which is accessible for signed or public objects without extra auth headers.
const downloadMediaBuffer = async (uri: string): Promise<Buffer | null> => {
  const url = uri.startsWith("gs://")
    ? uri.replace(/^gs:\/\/([^/]+)\/(.*)$/, "https://storage.googleapis.com/$1/$2")
    : uri;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
};

// ─── route handlers ───────────────────────────────────────────────────────────

export const handleGeneratorListRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/generator") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  cleanupStaleGenerations();
  writeJson(response, 200, { generations: listGenerations() }, corsOrigin);
  return true;
};

export const handleGeneratorItemRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  const match = /^\/api\/generator\/([^/]+)$/.exec(requestUrl.pathname);
  if (!match) return false;
  const id = match[1] ?? "";
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const meta = readGenerationMeta(id);
  if (!meta) {
    writeJson(response, 404, { error: "Generation not found." }, corsOrigin);
    return true;
  }
  writeJson(response, 200, meta, corsOrigin);
  return true;
};

export const handleGeneratorAssetRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  const match = /^\/api\/generator\/assets\/([^/]+)$/.exec(requestUrl.pathname);
  if (!match) return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const id = match[1] ?? "";
  if (!safeId(id)) {
    response.writeHead(400);
    response.end();
    return true;
  }
  const found = findGenerationMediaPath(id);
  if (!found) {
    response.writeHead(404);
    response.end();
    return true;
  }
  const buf = readFileSync(found.path);
  response.writeHead(200, {
    "Content-Type": found.mime,
    "Content-Length": buf.length,
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": corsOrigin ?? "*",
  });
  response.end(buf);
  return true;
};

export const handleGeneratorImageRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/generator/image") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const apiKey = getGeminiKey();
  if (!apiKey) {
    writeJson(response, 503, { error: MISSING_KEY_MSG }, corsOrigin);
    return true;
  }

  const bodyResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyResult.ok) return true;
  const body = (
    typeof bodyResult.payload === "object" && bodyResult.payload !== null ? bodyResult.payload : {}
  ) as Record<string, unknown>;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    writeJson(response, 400, { error: "prompt is required." }, corsOrigin);
    return true;
  }

  const validRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
  const rawRatio = typeof body.aspectRatio === "string" ? body.aspectRatio : "1:1";
  const aspectRatio = validRatios.includes(rawRatio) ? rawRatio : "1:1";

  const id = `gen-${Date.now()}`;
  const meta: GenerationMeta = {
    id,
    mode: "text2image",
    prompt,
    status: "generating",
    aspectRatio,
    model: "imagen-3",
    created: new Date().toISOString(),
  };
  saveGenerationMeta(meta);

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 60_000);

  try {
    const result = await imagenGenerate(prompt, aspectRatio, apiKey, controller.signal);
    clearTimeout(abortTimer);

    if (!result) {
      saveGenerationMeta({
        ...meta,
        status: "failed",
        errorMessage: "Imagen 3 API unreachable. Check GEMINI_API_KEY.",
      });
      writeJson(response, 502, { error: "Imagen 3 API unreachable." }, corsOrigin);
      return true;
    }

    if (typeof result === "string") {
      // Error message from API
      saveGenerationMeta({ ...meta, status: "failed", errorMessage: result });
      writeJson(response, 502, { error: result }, corsOrigin);
      return true;
    }

    const ext = mimeToExt(result.mime);
    saveGenerationMedia(id, Buffer.from(result.b64, "base64"), ext === "mp4" ? "png" : ext);
    const resultUrl = `/api/generator/assets/${id}`;
    const done: GenerationMeta = {
      ...meta,
      status: "completed",
      resultUrl,
      completedAt: new Date().toISOString(),
    };
    saveGenerationMeta(done);
    writeJson(response, 201, done, corsOrigin);
  } catch (e) {
    clearTimeout(abortTimer);
    saveGenerationMeta({ ...meta, status: "failed", errorMessage: "Unexpected error." });
    writeJson(
      response,
      500,
      { error: e instanceof Error ? e.message : "Generation failed." },
      corsOrigin,
    );
  }
  return true;
};

export const handleGeneratorAnimateRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/generator/animate") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const apiKey = getGeminiKey();
  if (!apiKey) {
    writeJson(response, 503, { error: MISSING_KEY_MSG }, corsOrigin);
    return true;
  }

  const bodyResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyResult.ok) return true;
  const body = (
    typeof bodyResult.payload === "object" && bodyResult.payload !== null ? bodyResult.payload : {}
  ) as Record<string, unknown>;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    writeJson(response, 400, { error: "prompt is required." }, corsOrigin);
    return true;
  }

  // Accept either a local generation ID or an external image URL
  const imageId = typeof body.imageId === "string" ? body.imageId.trim() : "";
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";

  const validAspects = ["16:9", "9:16", "1:1"];
  const rawAspect = typeof body.aspectRatio === "string" ? body.aspectRatio : "16:9";
  const aspectRatio = validAspects.includes(rawAspect) ? rawAspect : "16:9";

  const id = `gen-${Date.now()}`;
  const meta: GenerationMeta = {
    id,
    mode: "image2video",
    prompt,
    status: "generating",
    model: "veo-2",
    aspectRatio,
    created: new Date().toISOString(),
  };
  saveGenerationMeta(meta);

  // Fire-and-forget — Veo 2 takes 60-180s
  (async () => {
    try {
      let imageB64: string | null = null;
      let imageMime = "image/png";

      if (imageId) {
        // Read from local generation on disk
        const imgPath = findGenerationMediaPath(imageId);
        if (imgPath && !imgPath.mime.startsWith("video")) {
          imageB64 = readFileSync(imgPath.path).toString("base64");
          imageMime = imgPath.mime;
        }
      } else if (imageUrl) {
        const fetched = await fetchImageAsB64(imageUrl);
        if (fetched) {
          imageB64 = fetched.b64;
          imageMime = fetched.mime;
        }
      }

      const operationName = await veoStart(prompt, imageB64, imageMime, aspectRatio, apiKey);
      if (!operationName) {
        saveGenerationMeta({
          ...meta,
          status: "failed",
          errorMessage: "Veo 2 API unreachable. Check GEMINI_API_KEY.",
          completedAt: new Date().toISOString(),
        });
        return;
      }

      const result = await veoPoll(operationName, apiKey, 240_000);
      if (!result) {
        saveGenerationMeta({
          ...meta,
          status: "failed",
          errorMessage: "Video generation timed out.",
          completedAt: new Date().toISOString(),
        });
        return;
      }

      let resultUrl: string;
      if (typeof result === "string") {
        const isUrl = result.startsWith("http") || result.startsWith("gs://");
        if (!isUrl) {
          // Literal error message from the API
          saveGenerationMeta({
            ...meta,
            status: "failed",
            errorMessage: result,
            completedAt: new Date().toISOString(),
          });
          return;
        }
        // URL (https:// or gs://) — download server-side so the browser never
        // has to deal with CORS headers or GCS auth on the video element.
        const buf = await downloadMediaBuffer(result);
        if (!buf) {
          saveGenerationMeta({
            ...meta,
            status: "failed",
            errorMessage: `Video URL returned but could not be downloaded: ${result.slice(0, 80)}`,
            completedAt: new Date().toISOString(),
          });
          return;
        }
        saveGenerationMedia(id, buf, "mp4");
        resultUrl = `/api/generator/assets/${id}`;
      } else {
        // Base64 video → save to disk
        const ext = mimeToExt(result.mime);
        saveGenerationMedia(id, Buffer.from(result.b64, "base64"), ext === "png" ? "mp4" : ext);
        resultUrl = `/api/generator/assets/${id}`;
      }

      saveGenerationMeta({
        ...meta,
        status: "completed",
        resultUrl,
        completedAt: new Date().toISOString(),
      });
    } catch {
      saveGenerationMeta({
        ...meta,
        status: "failed",
        errorMessage: "Background video generation error.",
        completedAt: new Date().toISOString(),
      });
    }
  })();

  writeJson(response, 202, meta, corsOrigin);
  return true;
};

export const handleGeneratorDeleteRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  const match = /^\/api\/generator\/([^/]+)$/.exec(requestUrl.pathname);
  if (!match) return false;
  if (request.method !== "DELETE") return false;
  const id = match[1] ?? "";
  if (!safeId(id)) {
    writeJson(response, 400, { error: "Invalid ID." }, corsOrigin);
    return true;
  }
  for (const ext of ["json", "png", "webp", "jpg", "mp4"] as const) {
    const p = safeGenerationPath(id, ext);
    if (p && existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // already gone — fine
      }
    }
  }
  writeJson(response, 200, { ok: true }, corsOrigin);
  return true;
};

export const handleGeneratorStatusRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/generator/status") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  cleanupStaleGenerations();
  writeJson(
    response,
    200,
    {
      geminiKeyPresent: Boolean(getGeminiKey()),
      imagenModel: IMAGEN_MODEL,
      veoModel: VEO_MODEL,
    },
    corsOrigin,
  );
  return true;
};
