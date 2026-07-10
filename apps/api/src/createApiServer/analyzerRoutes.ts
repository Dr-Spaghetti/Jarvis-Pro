import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import type { IncomingMessage } from "node:http";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

// ─── storage helpers ─────────────────────────────────────────────────────────

const getAnalysesDir = () => join(process.cwd(), ".octogent", "analyses");

const safeAnalysisPath = (id: string): string | null => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const base = getAnalysesDir();
  const target = resolve(join(base, id));
  if (!target.startsWith(resolve(base) + sep)) return null;
  return target;
};

const readAnalysis = (id: string): AnalysisRecord | null => {
  const dir = safeAnalysisPath(id);
  if (!dir || !existsSync(dir)) return null;
  try {
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as AnalysisMeta;
    const resultPath = join(dir, "result.json");
    const result = existsSync(resultPath)
      ? (JSON.parse(readFileSync(resultPath, "utf8")) as ImageBreakdown | VideoAnalysisResult)
      : null;
    return { meta, result };
  } catch {
    return null;
  }
};

const saveAnalysis = (meta: AnalysisMeta, result: ImageBreakdown | VideoAnalysisResult) => {
  const dir = getAnalysesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const analysisDir = join(dir, meta.id);
  mkdirSync(analysisDir, { recursive: true });
  writeFileSync(join(analysisDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  writeFileSync(join(analysisDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
};

const listAnalyses = (): AnalysisMeta[] => {
  const dir = getAnalysesDir();
  if (!existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir) as string[];
    const metas: AnalysisMeta[] = [];
    for (const entry of entries) {
      const metaPath = join(dir, entry, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        metas.push(JSON.parse(readFileSync(metaPath, "utf8")) as AnalysisMeta);
      } catch {
        // skip unreadable
      }
    }
    return metas.sort((a, b) => b.created.localeCompare(a.created));
  } catch {
    return [];
  }
};

// ─── types ───────────────────────────────────────────────────────────────────

type ImageBreakdown = {
  provider: "gemini" | "claude";
  objects: string;
  people: string;
  scene: string;
  text_on_image: string;
  composition: string;
  style: string;
  contextual_cues: string;
  focus_insights?: string;
};

type VideoScene = {
  start: number;
  end: number;
  description: string;
};

type TranscriptSegment = {
  start: number;
  end: number;
  transcript: string;
};

type TimelineEntry = {
  time_start: number;
  time_end: number;
  visual: string;
  spoken: string;
};

type VideoAnalysisResult = {
  scenes: VideoScene[];
  transcript: TranscriptSegment[];
  timeline: TimelineEntry[];
  ffmpeg_available: boolean;
  gemini_available: boolean;
  sampled?: boolean;
  sample_note?: string;
};

type AnalysisMeta = {
  id: string;
  type: "image" | "video";
  filename: string;
  mimeType: string;
  created: string;
  focusPrompt?: string;
};

type AnalysisRecord = {
  meta: AnalysisMeta;
  result: ImageBreakdown | VideoAnalysisResult | null;
};

// ─── body reader ─────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

const readRawBody = async (request: IncomingMessage, maxBytes: number): Promise<Buffer | null> => {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > maxBytes) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
};

// ─── Gemini helpers ───────────────────────────────────────────────────────────

const getGeminiKey = () => process.env.GEMINI_API_KEY?.trim() ?? null;

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_GENERATE_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const IMAGE_ANALYSIS_PROMPT = `Analyze this image in detail. Return ONLY a JSON object (no markdown, no code fence) with exactly these string fields:
- objects: comma-separated list of visible objects and items
- people: description of any people (count, apparent activity, notable details; "none" if absent)
- scene: overall scene and setting description
- text_on_image: exact verbatim transcription of any visible text, signs, labels, or writing ("none" if absent)
- composition: layout, framing, perspective, and lighting notes
- style: artistic or photographic style (e.g. candid photo, diagram, screenshot, illustration)
- contextual_cues: any other relevant context, anomalies, or notable observations`;

const VIDEO_ANALYSIS_PROMPT = `Analyze this video and break it into scenes. Return ONLY a JSON object (no markdown, no code fence):
{"scenes": [{"start": <seconds>, "end": <seconds>, "description": "<what is happening visually and audibly>"}]}
Be precise about timestamps. Each scene should cover a coherent sequence of events. If the video is long, cap at 30 scenes.`;

const buildImagePrompt = (focus?: string): string => {
  if (!focus) return IMAGE_ANALYSIS_PROMPT;
  return `The user specifically wants to focus on: "${focus}"\n\nWith that in mind, analyze this image in detail. Return ONLY a JSON object (no markdown, no code fence) with exactly these string fields:
- focus_insights: specific detailed findings about "${focus}" — what you observe in direct relation to this focus, be thorough
- objects: comma-separated list of visible objects and items
- people: description of any people (count, apparent activity, notable details; "none" if absent)
- scene: overall scene and setting description
- text_on_image: exact verbatim transcription of any visible text, signs, labels, or writing ("none" if absent)
- composition: layout, framing, perspective, and lighting notes
- style: artistic or photographic style (e.g. candid photo, diagram, screenshot, illustration)
- contextual_cues: any other relevant context, anomalies, or notable observations`;
};

const buildVideoPrompt = (focus?: string): string => {
  if (!focus) return VIDEO_ANALYSIS_PROMPT;
  return `Pay special attention to "${focus}" throughout this video — note where and how it appears in your scene descriptions.\n\n${VIDEO_ANALYSIS_PROMPT}`;
};

const analyzeImageWithGemini = async (
  imageData: Buffer,
  mimeType: string,
  focus?: string,
): Promise<ImageBreakdown | null> => {
  const key = getGeminiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(GEMINI_GENERATE_URL(GEMINI_MODEL, key), {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: imageData.toString("base64") } },
              { text: buildImagePrompt(focus) },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      provider: "gemini",
      objects: String(parsed.objects ?? ""),
      people: String(parsed.people ?? "none"),
      scene: String(parsed.scene ?? ""),
      text_on_image: String(parsed.text_on_image ?? "none"),
      composition: String(parsed.composition ?? ""),
      style: String(parsed.style ?? ""),
      contextual_cues: String(parsed.contextual_cues ?? ""),
      ...(parsed.focus_insights ? { focus_insights: String(parsed.focus_insights) } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const analyzeImageWithClaude = async (
  imageData: Buffer,
  mimeType: string,
  focus?: string,
): Promise<ImageBreakdown | null> => {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: imageData.toString("base64"),
                },
              },
              { type: "text", text: buildImagePrompt(focus) },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) return null;
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      provider: "claude",
      objects: String(parsed.objects ?? ""),
      people: String(parsed.people ?? "none"),
      scene: String(parsed.scene ?? ""),
      text_on_image: String(parsed.text_on_image ?? "none"),
      composition: String(parsed.composition ?? ""),
      style: String(parsed.style ?? ""),
      contextual_cues: String(parsed.contextual_cues ?? ""),
      ...(parsed.focus_insights ? { focus_insights: String(parsed.focus_insights) } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// ─── Gemini Files API for video ────────────────────────────────────────────────

const uploadVideoToGeminiFiles = async (
  videoData: Buffer,
  mimeType: string,
  displayName: string,
): Promise<{ fileUri: string; name: string } | null> => {
  const key = getGeminiKey();
  if (!key) return null;

  // Initiate resumable upload
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${key}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(videoData.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { displayName } }),
    },
  );
  if (!initRes.ok) return null;

  const uploadUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) return null;

  // Upload file content
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Length": String(videoData.length),
    },
    body: videoData as unknown as BodyInit,
  });
  if (!uploadRes.ok) return null;

  const fileData = (await uploadRes.json()) as {
    file?: { uri?: string; name?: string; state?: string };
  };
  const fileUri = fileData.file?.uri;
  const name = fileData.file?.name;
  if (!fileUri || !name) return null;

  // Poll until ACTIVE (up to 60s)
  for (let i = 0; i < 12; i++) {
    const stateRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}?key=${key}`,
    );
    if (!stateRes.ok) break;
    const stateData = (await stateRes.json()) as { state?: string };
    if (stateData.state === "ACTIVE") return { fileUri, name };
    await new Promise<void>((r) => setTimeout(r, 5000));
  }

  return null;
};

const analyzeVideoWithGemini = async (
  fileUri: string,
  mimeType: string,
  focus?: string,
): Promise<VideoScene[] | null> => {
  const key = getGeminiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(GEMINI_GENERATE_URL(GEMINI_MODEL, key), {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ fileData: { mimeType, fileUri } }, { text: buildVideoPrompt(focus) }],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as { scenes?: unknown[] };
    if (!Array.isArray(parsed.scenes)) return null;
    return parsed.scenes
      .filter(
        (s): s is Record<string, unknown> =>
          typeof s === "object" && s !== null && !Array.isArray(s),
      )
      .map((s) => ({
        start: typeof s.start === "number" ? s.start : 0,
        end: typeof s.end === "number" ? s.end : 0,
        description: String(s.description ?? ""),
      }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// ─── ffmpeg + Deepgram ────────────────────────────────────────────────────────

const checkFfmpeg = (): Promise<boolean> =>
  new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });

const extractAudioFromVideo = (videoData: Buffer, inputExt: string): Promise<Buffer | null> =>
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: ffmpeg spawn pattern requires async executor
  new Promise(async (resolve) => {
    const tmpIn = join(tmpdir(), `analyzer-in-${Date.now()}${inputExt}`);
    const tmpOut = join(tmpdir(), `analyzer-out-${Date.now()}.wav`);
    try {
      await writeFile(tmpIn, videoData);
      const proc = spawn("ffmpeg", [
        "-i",
        tmpIn,
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        "-y",
        tmpOut,
      ]);
      proc.on("close", (code) => {
        try {
          if (code === 0 && existsSync(tmpOut)) {
            resolve(readFileSync(tmpOut));
          } else {
            resolve(null);
          }
        } finally {
          try {
            unlinkSync(tmpIn);
          } catch {
            /* ignore */
          }
          try {
            unlinkSync(tmpOut);
          } catch {
            /* ignore */
          }
        }
      });
      proc.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });

const transcribeWithDeepgram = async (audioData: Buffer): Promise<TranscriptSegment[] | null> => {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&utterances=true",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": "audio/wav",
        },
        body: audioData as unknown as BodyInit,
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: {
        utterances?: Array<{
          start?: number;
          end?: number;
          transcript?: string;
        }>;
      };
    };
    const utterances = data.results?.utterances;
    if (!Array.isArray(utterances) || utterances.length === 0) return [];
    return utterances.map((u) => ({
      start: u.start ?? 0,
      end: u.end ?? 0,
      transcript: u.transcript ?? "",
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// ─── merge visual scenes + transcript into timeline ────────────────────────────

const mergeTimeline = (scenes: VideoScene[], transcript: TranscriptSegment[]): TimelineEntry[] => {
  // Build a unified set of time boundaries
  const boundaries = new Set<number>();
  for (const s of scenes) {
    boundaries.add(s.start);
    boundaries.add(s.end);
  }
  for (const t of transcript) {
    boundaries.add(t.start);
    boundaries.add(t.end);
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  const entries: TimelineEntry[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i] ?? 0;
    const t1 = sorted[i + 1] ?? 0;
    const mid = (t0 + t1) / 2;

    const scene = scenes.find((s) => s.start <= mid && s.end > mid);
    const spoken = transcript
      .filter((t) => t.start < t1 && t.end > t0)
      .map((t) => t.transcript)
      .join(" ")
      .trim();

    if (scene || spoken) {
      entries.push({
        time_start: t0,
        time_end: t1,
        visual: scene?.description ?? "",
        spoken,
      });
    }
  }
  return entries;
};

// ─── route handlers ───────────────────────────────────────────────────────────

export const handleAnalyzerListRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/analyzer") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  writeJson(response, 200, { analyses: listAnalyses() }, corsOrigin);
  return true;
};

export const handleAnalyzerImageRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/analyzer/image") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const filename = (request.headers["x-filename"] as string | undefined) ?? "image";
  const mimeType =
    (request.headers["content-type"] ?? "image/jpeg").split(";")[0]?.trim() ?? "image/jpeg";
  const focusPrompt =
    (request.headers["x-focus-prompt"] as string | undefined)?.trim() || undefined;

  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    writeJson(response, 400, { error: `Unsupported image type: ${mimeType}` }, corsOrigin);
    return true;
  }

  const body = await readRawBody(request, MAX_IMAGE_BYTES);
  if (!body) {
    writeJson(response, 413, { error: "Image exceeds 20 MB limit." }, corsOrigin);
    return true;
  }
  if (body.length === 0) {
    writeJson(response, 400, { error: "Empty image body." }, corsOrigin);
    return true;
  }

  // Try Gemini first, fall back to Claude
  let result = await analyzeImageWithGemini(body, mimeType, focusPrompt);
  if (!result) {
    const geminiKey = getGeminiKey();
    result = await analyzeImageWithClaude(body, mimeType, focusPrompt);
    if (!result) {
      const errorMsg = !geminiKey
        ? "Set GEMINI_API_KEY in .env for image analysis (Claude fallback also unavailable — check ANTHROPIC_API_KEY)."
        : "Image analysis failed — Gemini returned an error (possibly quota). Claude fallback also failed. Check API keys and quotas.";
      writeJson(response, 503, { error: errorMsg }, corsOrigin);
      return true;
    }
    if (geminiKey) {
      // Gemini was available but failed — note quota issue
      result = { ...result, provider: "claude" };
    }
  }

  const id = `analysis-${Date.now()}`;
  const meta: AnalysisMeta = {
    id,
    type: "image",
    filename,
    mimeType,
    created: new Date().toISOString(),
    ...(focusPrompt ? { focusPrompt } : {}),
  };

  try {
    saveAnalysis(meta, result);
    writeJson(response, 201, { id, meta, result }, corsOrigin);
  } catch (e) {
    writeJson(
      response,
      500,
      { error: e instanceof Error ? e.message : "Failed to save analysis." },
      corsOrigin,
    );
  }
  return true;
};

export const handleAnalyzerVideoRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/analyzer/video") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const filename = (request.headers["x-filename"] as string | undefined) ?? "video";
  const mimeType =
    (request.headers["content-type"] ?? "video/mp4").split(";")[0]?.trim() ?? "video/mp4";
  const focusPrompt =
    (request.headers["x-focus-prompt"] as string | undefined)?.trim() || undefined;

  const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"];
  if (!ALLOWED_VIDEO_TYPES.includes(mimeType)) {
    writeJson(
      response,
      400,
      { error: `Unsupported video type: ${mimeType}. Supported: mp4, mov, webm, avi.` },
      corsOrigin,
    );
    return true;
  }

  const body = await readRawBody(request, MAX_VIDEO_BYTES);
  if (!body) {
    writeJson(response, 413, { error: "Video exceeds 500 MB limit." }, corsOrigin);
    return true;
  }
  if (body.length === 0) {
    writeJson(response, 400, { error: "Empty video body." }, corsOrigin);
    return true;
  }

  const ffmpegAvailable = await checkFfmpeg();
  const geminiKey = getGeminiKey();

  if (!geminiKey) {
    writeJson(
      response,
      503,
      {
        error: "GEMINI_API_KEY is required for video analysis. Add it to .env and restart Jarvis.",
        ffmpeg_available: ffmpegAvailable,
        ffmpeg_install: !ffmpegAvailable
          ? "ffmpeg not found. Install: https://ffmpeg.org/download.html (add to PATH, restart Jarvis)"
          : undefined,
      },
      corsOrigin,
    );
    return true;
  }

  // Upload video to Gemini Files API
  const uploadResult = await uploadVideoToGeminiFiles(body, mimeType, filename);

  let scenes: VideoScene[] = [];
  let geminiAvailable = false;

  if (uploadResult) {
    geminiAvailable = true;
    const sceneResult = await analyzeVideoWithGemini(uploadResult.fileUri, mimeType, focusPrompt);
    if (sceneResult) scenes = sceneResult;
    // Clean up the file from Gemini (best-effort)
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/${uploadResult.name}?key=${geminiKey}`,
      { method: "DELETE" },
    ).catch(() => {
      /* ignore */
    });
  }

  // Audio extraction + Deepgram transcript
  let transcript: TranscriptSegment[] = [];
  const extMap: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-msvideo": ".avi",
  };
  const inputExt = extMap[mimeType] ?? ".mp4";

  if (ffmpegAvailable) {
    const audioData = await extractAudioFromVideo(body, inputExt);
    if (audioData) {
      const transcriptResult = await transcribeWithDeepgram(audioData);
      if (transcriptResult) transcript = transcriptResult;
    }
  }

  const timeline = mergeTimeline(scenes, transcript);

  const result: VideoAnalysisResult = {
    scenes,
    transcript,
    timeline,
    ffmpeg_available: ffmpegAvailable,
    gemini_available: geminiAvailable,
    ...(body.length > 100 * 1024 * 1024
      ? {
          sampled: false,
          sample_note:
            "Video is large (>100 MB) — full analysis attempted. For best results use clips under 100 MB.",
        }
      : {}),
  };

  const id = `analysis-${Date.now()}`;
  const meta: AnalysisMeta = {
    id,
    type: "video",
    filename,
    mimeType,
    created: new Date().toISOString(),
    ...(focusPrompt ? { focusPrompt } : {}),
  };

  try {
    saveAnalysis(meta, result);
    writeJson(response, 201, { id, meta, result }, corsOrigin);
  } catch (e) {
    writeJson(
      response,
      500,
      { error: e instanceof Error ? e.message : "Failed to save analysis." },
      corsOrigin,
    );
  }
  return true;
};

export const handleAnalyzerItemRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  const match = /^\/api\/analyzer\/([^/]+)$/.exec(requestUrl.pathname);
  if (!match) return false;
  const id = match[1] ?? "";
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const record = readAnalysis(id);
  if (!record) {
    writeJson(response, 404, { error: "Analysis not found." }, corsOrigin);
    return true;
  }
  writeJson(response, 200, record, corsOrigin);
  return true;
};

// ─── Analysis Chat ────────────────────────────────────────────────────────────

type ChatMessage = { role: "user" | "assistant"; content: string };

const buildAnalysisContext = (record: AnalysisRecord): string => {
  const { meta, result } = record;
  if (!result) return `Analyzed ${meta.type}: ${meta.filename}. No result data available.`;

  if (meta.type === "image") {
    const img = result as ImageBreakdown;
    const parts = [`Image analysis of "${meta.filename}" (via ${img.provider}):`];
    if (meta.focusPrompt) parts.push(`User's focus: "${meta.focusPrompt}"`);
    if (img.focus_insights) parts.push(`Focus findings: ${img.focus_insights}`);
    parts.push(
      `Objects: ${img.objects || "none"}`,
      `People: ${img.people || "none"}`,
      `Scene: ${img.scene || "unknown"}`,
      `Text on image: ${img.text_on_image || "none"}`,
      `Composition: ${img.composition || ""}`,
      `Style: ${img.style || ""}`,
      `Contextual cues: ${img.contextual_cues || ""}`,
    );
    return parts.join("\n");
  }

  const vid = result as VideoAnalysisResult;
  const timelineSnippet = vid.timeline
    .slice(0, 20)
    .map((e) => {
      const t = `${String(Math.floor(e.time_start / 60)).padStart(2, "0")}:${String(Math.floor(e.time_start % 60)).padStart(2, "0")}`;
      const parts: string[] = [];
      if (e.visual) parts.push(e.visual);
      if (e.spoken) parts.push(`"${e.spoken}"`);
      return `${t} — ${parts.join(" | ")}`;
    })
    .join("\n");

  return [
    `Video analysis of "${meta.filename}":`,
    `Duration: ${vid.scenes.length} scenes, ${vid.transcript.length} transcript segments`,
    timelineSnippet || "No timeline data.",
  ].join("\n");
};

export const handleAnalyzerChatRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  const match = /^\/api\/analyzer\/([^/]+)\/chat$/.exec(requestUrl.pathname);
  if (!match) return false;
  const id = match[1] ?? "";
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicKey) {
    writeJson(
      response,
      503,
      { error: "ANTHROPIC_API_KEY is required for Analysis Chat." },
      corsOrigin,
    );
    return true;
  }

  const record = readAnalysis(id);
  if (!record) {
    writeJson(response, 404, { error: "Analysis not found." }, corsOrigin);
    return true;
  }

  // Read body BEFORE writing SSE headers (readJsonBodyOrWriteError may write error responses)
  const bodyResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyResult.ok) return true;
  const bodyPayload = (
    typeof bodyResult.payload === "object" && bodyResult.payload !== null ? bodyResult.payload : {}
  ) as Record<string, unknown>;

  const message = typeof bodyPayload.message === "string" ? bodyPayload.message.trim() : "";
  if (!message) {
    writeJson(response, 400, { error: "message is required." }, corsOrigin);
    return true;
  }

  const rawHistory = Array.isArray(bodyPayload.history) ? (bodyPayload.history as unknown[]) : [];
  const history: ChatMessage[] = rawHistory
    .filter(
      (h): h is Record<string, unknown> => typeof h === "object" && h !== null && !Array.isArray(h),
    )
    .filter((h) => (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .map((h) => ({ role: h.role as "user" | "assistant", content: String(h.content) }));

  const systemContext = buildAnalysisContext(record);
  const messages: ChatMessage[] = [...history, { role: "user", content: message }];

  // Switch to SSE streaming
  const sseHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  if (corsOrigin) sseHeaders["Access-Control-Allow-Origin"] = corsOrigin;
  response.writeHead(200, sseHeaders);

  let aborted = false;
  const requestController = new AbortController();
  request.on("close", () => {
    aborted = true;
    requestController.abort();
  });

  const writeEvent = (data: Record<string, unknown>) => {
    if (!aborted) {
      try {
        response.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        aborted = true;
      }
    }
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: requestController.signal,
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        stream: true,
        system: `You are an expert visual and media analyst with deep knowledge of photography, videography, design, and content strategy. The user has analyzed a piece of media and wants to discuss it in depth. Here is the full analysis:\n\n${systemContext}\n\nProvide specific, analytical answers that reference concrete details from the analysis. Be precise and insightful, not generic.`,
        messages,
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      writeEvent({ error: `Claude API error: ${errText}` });
      response.end();
      return true;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            if (event.type === "content_block_delta") {
              const delta = event.delta as Record<string, unknown> | undefined;
              if (delta?.type === "text_delta" && typeof delta.text === "string") {
                writeEvent({ delta: delta.text });
              }
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  } catch (e) {
    if (!aborted && !(e instanceof Error && e.name === "AbortError")) {
      writeEvent({ error: e instanceof Error ? e.message : "Chat request failed." });
    }
  }

  if (!aborted) {
    try {
      response.write("data: [DONE]\n\n");
      response.end();
    } catch {
      // connection already closed
    }
  }
  return true;
};
