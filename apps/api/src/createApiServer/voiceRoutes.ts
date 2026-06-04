import type { IncomingMessage } from "node:http";

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

  const elevenLabsVoiceId = getElevenLabsVoiceId();
  writeJson(
    response,
    200,
    {
      wake: {
        provider: "browser-speech-recognition",
        phrases: getJarvisWakePhrases(),
      },
      transcription: {
        provider: "openai",
        configured: getOpenAiApiKey() !== null,
        defaultModel: getDefaultTranscriptionModel(),
        models: TRANSCRIPTION_MODELS,
        whisperSupported: true,
      },
      tts: {
        provider: "elevenlabs",
        configured: getElevenLabsApiKey() !== null && elevenLabsVoiceId !== null,
        voiceIdConfigured: elevenLabsVoiceId !== null,
        fallback: "browser-speech-synthesis",
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

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    writeJson(response, 400, { error: "OPENAI_API_KEY is not configured." }, corsOrigin);
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
      Authorization: `Bearer ${apiKey}`,
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

  const apiKey = getElevenLabsApiKey();
  const defaultVoiceId = getElevenLabsVoiceId();
  if (!apiKey || !defaultVoiceId) {
    writeJson(
      response,
      400,
      { error: "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are not configured." },
      corsOrigin,
    );
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

  const voiceId = readString(payload.voiceId) ?? defaultVoiceId;
  const modelId = readString(payload.modelId) ?? "eleven_flash_v2_5";
  const upstreamResponse = await fetch(`${ELEVENLABS_TTS_URL_PREFIX}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      output_format: "mp3_44100_128",
    }),
  });

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    writeJson(
      response,
      upstreamResponse.status,
      { error: "Speech synthesis failed.", detail: errorText.slice(0, 500) },
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
