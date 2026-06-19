import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getJarvisWakePhrases, resolveJarvisVoiceIntent } from "../voiceIntent";
import type { ApiRouteHandler } from "./routeHelpers";
import {
  readJsonBodyOrWriteError,
  writeJson,
  writeMethodNotAllowed,
  writeText,
} from "./routeHelpers";
import { withCors } from "./security";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const ELEVENLABS_TTS_URL_PREFIX = "https://api.elevenlabs.io/v1/text-to-speech";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_MODELS = [
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-transcribe-diarize",
  "whisper-1",
] as const;

type TranscriptionModel = (typeof TRANSCRIPTION_MODELS)[number];

class RequestBodyTooLargeError extends Error {}

const isTranscriptionModel = (value: string): value is TranscriptionModel =>
  TRANSCRIPTION_MODELS.includes(value as TranscriptionModel);

const getDefaultTranscriptionModel = (): TranscriptionModel => {
  const configured = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim();
  if (configured && isTranscriptionModel(configured)) {
    return configured;
  }
  return "gpt-4o-mini-transcribe";
};

const getOpenAiApiKey = (): string | null => {
  const value = process.env.OPENAI_API_KEY?.trim();
  return value && value.length > 0 ? value : null;
};

const getElevenLabsApiKey = (): string | null => {
  const value = process.env.ELEVENLABS_API_KEY?.trim();
  return value && value.length > 0 ? value : null;
};

const getElevenLabsVoiceId = (): string | null => {
  const value = process.env.ELEVENLABS_VOICE_ID?.trim();
  return value && value.length > 0 ? value : null;
};

const getOpenAiTtsModel = (): string => process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
const getOpenAiTtsVoice = (): string => process.env.OPENAI_TTS_VOICE?.trim() || "alloy";

const getDeepgramApiKey = (): string | null => {
  const value = process.env.DEEPGRAM_API_KEY?.trim();
  return value && value.length > 0 ? value : null;
};
const getDeepgramModel = (): string => process.env.DEEPGRAM_TTS_MODEL?.trim() || "aura-2-thalia-en";
const getDeepgramSttModel = (): string => process.env.DEEPGRAM_STT_MODEL?.trim() || "nova-2";

// Speech-to-text via Deepgram. Used as the primary transcriber because it has a
// working account/credit; OpenAI Whisper is the fallback. Deepgram accepts the
// raw recorder audio (webm/opus) directly with the matching Content-Type.
const transcribeViaDeepgram = async (
  apiKey: string,
  audio: Buffer,
  contentType: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; detail: string }> => {
  const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(
    getDeepgramSttModel(),
  )}&smart_format=true&punctuate=true`;
  const body = new ArrayBuffer(audio.byteLength);
  new Uint8Array(body).set(audio);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
    body,
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
  }
  const data = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] };
  };
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return { ok: true, text: typeof transcript === "string" ? transcript.trim() : "" };
};

const getPiperConfig = (): { bin: string; model: string } | null => {
  const bin = process.env.PIPER_BIN?.trim();
  const model = process.env.PIPER_MODEL?.trim();
  return bin && model && existsSync(bin) && existsSync(model) ? { bin, model } : null;
};

// Synthesize WAV locally via the Piper binary (free, offline). Resolves null on
// any failure (missing binary/model, non-zero exit, timeout) so callers fall back.
const synthesizeWithPiper = (text: string): Promise<Buffer | null> =>
  new Promise((resolve) => {
    const config = getPiperConfig();
    if (!config) {
      resolve(null);
      return;
    }
    const outFile = join(tmpdir(), `jarvis-piper-${randomUUID()}.wav`);
    let settled = false;
    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      try {
        if (existsSync(outFile)) rmSync(outFile, { force: true });
      } catch {
        // ignore cleanup failure
      }
      resolve(value);
    };
    try {
      const proc = spawn(config.bin, ["-m", config.model, "-f", outFile]);
      const timer = setTimeout(() => finish(null), 30000);
      proc.on("error", () => {
        clearTimeout(timer);
        finish(null);
      });
      proc.stdin.on("error", () => {});
      proc.on("close", (code) => {
        clearTimeout(timer);
        try {
          if (code === 0 && existsSync(outFile)) {
            finish(readFileSync(outFile));
            return;
          }
        } catch {
          // fall through
        }
        finish(null);
      });
      proc.stdin.write(text);
      proc.stdin.end();
    } catch {
      finish(null);
    }
  });

// Available server-side TTS providers, best-first. The frontend offers these
// (plus always-available "browser") and falls back to browser speech on failure.
const availableTtsProviders = (): string[] => {
  const providers: string[] = [];
  if (getOpenAiApiKey()) providers.push("openai");
  if (getDeepgramApiKey()) providers.push("deepgram");
  if (getElevenLabsApiKey() && getElevenLabsVoiceId()) providers.push("elevenlabs");
  if (getPiperConfig()) providers.push("piper");
  providers.push("browser");
  return providers;
};

const readRawBody = async (request: IncomingMessage, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError("Request body too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
};

const readJsonPayload = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const sanitizeAudioContentType = (contentType: string | undefined): string => {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") {
    return "audio/webm";
  }
  return normalized;
};

const filenameForContentType = (contentType: string): string => {
  if (contentType.includes("mpeg")) return "jarvis-command.mp3";
  if (contentType.includes("mp4")) return "jarvis-command.mp4";
  if (contentType.includes("wav")) return "jarvis-command.wav";
  if (contentType.includes("ogg")) return "jarvis-command.ogg";
  return "jarvis-command.webm";
};

export const handleVoiceConfigRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/voice/config") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const ttsProviders = availableTtsProviders();

  // Which brain answers questions, so the UI can show it's wired (and confirm a
  // fresh build is actually running). Order mirrors handleBrainAskRoute:
  // Claude → OpenAI web-search → local Ollama.
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const perplexityKey = process.env.PERPLEXITY_API_KEY?.trim();
  const openAiKey = getOpenAiApiKey();
  const brainProvider = anthropicKey ? "anthropic" : openAiKey ? "openai" : "local";
  const brainWebSearch =
    brainProvider === "openai"
      ? true
      : brainProvider === "anthropic"
        ? Boolean(perplexityKey)
        : false;

  writeJson(
    response,
    200,
    {
      wake: {
        provider: "browser-speech-recognition",
        phrases: getJarvisWakePhrases(),
      },
      transcription: {
        // Deepgram is used first when configured; OpenAI Whisper is the fallback.
        provider: getDeepgramApiKey() ? "deepgram" : "openai",
        configured: getDeepgramApiKey() !== null || getOpenAiApiKey() !== null,
        defaultModel: getDeepgramApiKey() ? getDeepgramSttModel() : getDefaultTranscriptionModel(),
        models: TRANSCRIPTION_MODELS,
        whisperSupported: getOpenAiApiKey() !== null,
      },
      tts: {
        // `configured` = a server (non-browser) provider is available.
        configured: ttsProviders.some((provider) => provider !== "browser"),
        providers: ttsProviders,
        recommended: ttsProviders[0],
        fallback: "browser-speech-synthesis",
      },
      brain: {
        provider: brainProvider,
        webSearch: brainWebSearch,
      },
    },
    corsOrigin,
  );
  return true;
};

export const handleVoiceIntentRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/voice/intent") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const payload = readJsonPayload(body.payload);
  const transcript = readString(payload.transcript);
  if (!transcript) {
    writeJson(response, 400, { error: "transcript is required." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, resolveJarvisVoiceIntent(transcript), corsOrigin);
  return true;
};

export const handleVoiceTranscribeRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/voice/transcribe") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const deepgramKey = getDeepgramApiKey();
  const openAiKey = getOpenAiApiKey();
  if (!deepgramKey && !openAiKey) {
    writeJson(
      response,
      400,
      { error: "No transcription provider configured (set DEEPGRAM_API_KEY or OPENAI_API_KEY)." },
      corsOrigin,
    );
    return true;
  }

  const requestedModel = requestUrl.searchParams.get("model")?.trim();
  const model =
    requestedModel && isTranscriptionModel(requestedModel)
      ? requestedModel
      : getDefaultTranscriptionModel();

  let audio: Buffer;
  try {
    audio = await readRawBody(request, MAX_AUDIO_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      writeJson(response, 413, { error: "Audio payload is too large." }, corsOrigin);
      return true;
    }
    throw error;
  }

  if (audio.byteLength === 0) {
    writeJson(response, 400, { error: "Audio payload is required." }, corsOrigin);
    return true;
  }

  const contentType = sanitizeAudioContentType(request.headers["content-type"]);

  // Deepgram is preferred (working credit); OpenAI Whisper is the fallback.
  if (deepgramKey) {
    const dg = await transcribeViaDeepgram(deepgramKey, audio, contentType);
    if (dg.ok) {
      writeJson(response, 200, { text: dg.text, model: getDeepgramSttModel() }, corsOrigin);
      return true;
    }
    if (!openAiKey) {
      writeJson(
        response,
        dg.status,
        { error: "Transcription failed.", detail: dg.detail },
        corsOrigin,
      );
      return true;
    }
    // Deepgram failed but an OpenAI key exists — fall through and try it.
  }

  const audioArrayBuffer = new ArrayBuffer(audio.byteLength);
  new Uint8Array(audioArrayBuffer).set(audio);
  const formData = new FormData();
  formData.append("model", model);
  formData.append(
    "file",
    new Blob([audioArrayBuffer], { type: contentType }),
    filenameForContentType(contentType),
  );

  const upstreamResponse = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
    },
    body: formData,
  });

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    writeJson(
      response,
      upstreamResponse.status,
      { error: "Transcription failed.", detail: errorText.slice(0, 500) },
      corsOrigin,
    );
    return true;
  }

  const result = (await upstreamResponse.json()) as { text?: unknown };
  const text = typeof result.text === "string" ? result.text.trim() : "";
  writeJson(response, 200, { text, model }, corsOrigin);
  return true;
};

export const handleVoiceSpeakRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/voice/speak") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = readJsonPayload(body.payload);
  const text = readString(payload.text);
  if (!text) {
    writeJson(response, 400, { error: "text is required." }, corsOrigin);
    return true;
  }

  const openAiKey = getOpenAiApiKey();
  const elevenLabsKey = getElevenLabsApiKey();
  const elevenLabsVoiceId = getElevenLabsVoiceId();
  const deepgramKey = getDeepgramApiKey();

  // Resolve provider: explicit request wins, else first available from the list.
  const requested = readString(payload.provider);
  const known = ["openai", "deepgram", "elevenlabs", "piper"] as const;
  type TtsProvider = (typeof known)[number];
  let provider: TtsProvider | null = (known as readonly string[]).includes(requested ?? "")
    ? (requested as TtsProvider)
    : null;
  if (!provider) {
    const firstServer = availableTtsProviders().find((entry) => entry !== "browser");
    provider = (firstServer as TtsProvider | undefined) ?? null;
  }
  if (!provider) {
    writeJson(
      response,
      400,
      {
        error:
          "No server TTS provider configured (set OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID, or PIPER_BIN + PIPER_MODEL).",
      },
      corsOrigin,
    );
    return true;
  }

  if (provider === "deepgram") {
    if (!deepgramKey) {
      writeJson(response, 400, { error: "DEEPGRAM_API_KEY is not configured." }, corsOrigin);
      return true;
    }
    const upstreamResponse = await fetch(
      `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(getDeepgramModel())}&encoding=mp3`,
      {
        method: "POST",
        headers: { Authorization: `Token ${deepgramKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      writeJson(
        response,
        upstreamResponse.status,
        {
          error: "Speech synthesis failed.",
          provider: "deepgram",
          detail: errorText.slice(0, 500),
        },
        corsOrigin,
      );
      return true;
    }
    const audio = Buffer.from(await upstreamResponse.arrayBuffer());
    response.writeHead(200, withCors({ "Content-Type": "audio/mpeg" }, corsOrigin));
    response.end(audio);
    return true;
  }

  if (provider === "piper") {
    const audio = await synthesizeWithPiper(text);
    if (!audio) {
      writeJson(
        response,
        400,
        { error: "Piper is not configured or failed (set PIPER_BIN + PIPER_MODEL)." },
        corsOrigin,
      );
      return true;
    }
    response.writeHead(200, withCors({ "Content-Type": "audio/wav" }, corsOrigin));
    response.end(audio);
    return true;
  }

  if (provider === "openai") {
    if (!openAiKey) {
      writeJson(response, 400, { error: "OPENAI_API_KEY is not configured." }, corsOrigin);
      return true;
    }
    const upstreamResponse = await fetch(OPENAI_SPEECH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOpenAiTtsModel(),
        voice: readString(payload.voice) ?? getOpenAiTtsVoice(),
        input: text,
        response_format: "mp3",
      }),
    });
    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      writeJson(
        response,
        upstreamResponse.status,
        { error: "Speech synthesis failed.", provider: "openai", detail: errorText.slice(0, 500) },
        corsOrigin,
      );
      return true;
    }
    const audio = Buffer.from(await upstreamResponse.arrayBuffer());
    response.writeHead(200, withCors({ "Content-Type": "audio/mpeg" }, corsOrigin));
    response.end(audio);
    return true;
  }

  // provider === "elevenlabs"
  if (!elevenLabsKey || !elevenLabsVoiceId) {
    writeJson(
      response,
      400,
      { error: "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are not configured." },
      corsOrigin,
    );
    return true;
  }
  const voiceId = readString(payload.voiceId) ?? elevenLabsVoiceId;
  const modelId = readString(payload.modelId) ?? "eleven_flash_v2_5";
  const upstreamResponse = await fetch(
    `${ELEVENLABS_TTS_URL_PREFIX}/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: { "xi-api-key": elevenLabsKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: modelId, output_format: "mp3_44100_128" }),
    },
  );
  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    writeJson(
      response,
      upstreamResponse.status,
      {
        error: "Speech synthesis failed.",
        provider: "elevenlabs",
        detail: errorText.slice(0, 500),
      },
      corsOrigin,
    );
    return true;
  }
  const audio = Buffer.from(await upstreamResponse.arrayBuffer());
  response.writeHead(200, withCors({ "Content-Type": "audio/mpeg" }, corsOrigin));
  response.end(audio);
  return true;
};

export const handleVoiceTextFallbackRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/voice/text") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = readJsonPayload(body.payload);
  const transcript = readString(payload.transcript);
  if (!transcript) {
    writeJson(response, 400, { error: "transcript is required." }, corsOrigin);
    return true;
  }

  writeText(response, 200, transcript, "text/plain", corsOrigin);
  return true;
};
