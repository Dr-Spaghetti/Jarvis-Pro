import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed } from "./routeHelpers";

type ServiceStatus =
  | { status: "ok" }
  | { status: "out-of-credits" }
  | { status: "invalid-key" }
  | { status: "not-configured" }
  | { status: "error"; note: string };

const checkElevenLabs = async (): Promise<ServiceStatus> => {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return { status: "not-configured" };
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: ".", model_id: "eleven_turbo_v2" }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { status: "ok" };
    if (res.status === 402) return { status: "out-of-credits" };
    if (res.status === 401) return { status: "invalid-key" };
    return { status: "error", note: `HTTP ${res.status}` };
  } catch {
    return { status: "error", note: "Request failed" };
  }
};

const checkOpenAI = async (): Promise<ServiceStatus> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { status: "not-configured" };
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", input: ".", voice: "alloy" }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { status: "ok" };
    if (res.status === 429 || res.status === 402) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      if (body?.error?.code === "insufficient_quota") return { status: "out-of-credits" };
      return { status: "error", note: "Rate limited" };
    }
    if (res.status === 401) return { status: "invalid-key" };
    return { status: "error", note: `HTTP ${res.status}` };
  } catch {
    return { status: "error", note: "Request failed" };
  }
};

const checkAnthropic = async (): Promise<ServiceStatus> => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { status: "not-configured" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { status: "ok" };
    if (res.status === 401) return { status: "invalid-key" };
    if (res.status === 402 || res.status === 529) return { status: "out-of-credits" };
    return { status: "error", note: `HTTP ${res.status}` };
  } catch {
    return { status: "error", note: "Request failed" };
  }
};

const checkPerplexity = async (): Promise<ServiceStatus> => {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (!apiKey) return { status: "not-configured" };
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { status: "ok" };
    if (res.status === 401) return { status: "invalid-key" };
    if (res.status === 402) return { status: "out-of-credits" };
    return { status: "error", note: `HTTP ${res.status}` };
  } catch {
    return { status: "error", note: "Request failed" };
  }
};

const checkDeepgram = async (): Promise<ServiceStatus> => {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) return { status: "not-configured" };
  try {
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { status: "ok" };
    if (res.status === 401) return { status: "invalid-key" };
    if (res.status === 402) return { status: "out-of-credits" };
    return { status: "error", note: `HTTP ${res.status}` };
  } catch {
    return { status: "error", note: "Request failed" };
  }
};

export const handleCreditsStatusRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
) => {
  if (requestUrl.pathname !== "/api/credits/status") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const [elevenlabs, openai, anthropic, perplexity, deepgram] = await Promise.all([
    checkElevenLabs(),
    checkOpenAI(),
    checkAnthropic(),
    checkPerplexity(),
    checkDeepgram(),
  ]);

  writeJson(response, 200, { elevenlabs, openai, anthropic, perplexity, deepgram }, corsOrigin);
  return true;
};
