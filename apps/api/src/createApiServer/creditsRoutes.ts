import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed } from "./routeHelpers";

type ServiceStatus = {
  status: "ok" | "out-of-credits" | "invalid-key" | "not-configured" | "error";
  note?: string;
  usage?: string;
};

const checkElevenLabs = async (): Promise<ServiceStatus> => {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return { status: "not-configured" };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        subscription?: { character_count?: number; character_limit?: number };
      };
      const used = data.subscription?.character_count ?? 0;
      const limit = data.subscription?.character_limit ?? 0;
      const remaining = limit - used;
      if (limit > 0 && remaining <= 0) return { status: "out-of-credits" };
      const usage = limit > 0 ? `${remaining.toLocaleString()} chars left` : undefined;
      return usage !== undefined ? { status: "ok", usage } : { status: "ok" };
    }
    if (res.status === 401) return { status: "invalid-key" };
    if (res.status === 402) return { status: "out-of-credits" };
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

const checkKokoro = async (): Promise<ServiceStatus> => {
  const url = process.env.KOKORO_URL?.trim();
  if (!url) return { status: "not-configured" };
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return { status: "ok" };
    return { status: "error", note: `HTTP ${res.status}` };
  } catch {
    return { status: "error", note: "Kokoro not reachable" };
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
    if (res.ok) {
      const data = (await res.json()) as { projects?: { project_id: string }[] };
      const projectId = data.projects?.[0]?.project_id;
      if (projectId) {
        try {
          const balRes = await fetch(
            `https://api.deepgram.com/v1/projects/${projectId}/balances`,
            { headers: { Authorization: `Token ${apiKey}` }, signal: AbortSignal.timeout(5000) },
          );
          if (balRes.ok) {
            const balData = (await balRes.json()) as {
              balances?: { amount: number; units: string }[];
            };
            const balance = balData.balances?.[0];
            if (balance?.amount !== undefined) {
              const usage = `$${balance.amount.toFixed(2)} remaining`;
              return { status: balance.amount > 0 ? "ok" : "out-of-credits", usage };
            }
          }
        } catch {
          /* balance fetch failed — fall through to plain ok */
        }
      }
      return { status: "ok" };
    }
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

  const [elevenlabs, openai, anthropic, perplexity, deepgram, kokoro] = await Promise.all([
    checkElevenLabs(),
    checkOpenAI(),
    checkAnthropic(),
    checkPerplexity(),
    checkDeepgram(),
    checkKokoro(),
  ]);

  writeJson(response, 200, { elevenlabs, openai, anthropic, perplexity, deepgram, kokoro }, corsOrigin);
  return true;
};
