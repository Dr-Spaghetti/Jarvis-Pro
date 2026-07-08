import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCreditsStatusRoute } from "../src/createApiServer/creditsRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

// ─── mocks ────────────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ─── helpers ──────────────────────────────────────────────────────────────────

const DEPS = {} as unknown as RouteHandlerDependencies;

const makeRequest = (method: string): IncomingMessage =>
  ({
    method,
    headers: {},
    [Symbol.asyncIterator]: async function* () {},
  }) as unknown as IncomingMessage;

const call = async (method: string, path: string) => {
  let status = 0;
  const parts: string[] = [];
  const response = {
    writeHead(s: number) {
      status = s;
      return response;
    },
    setHeader() {
      return response;
    },
    end(chunk?: string) {
      if (chunk) parts.push(String(chunk));
    },
  } as unknown as ServerResponse;
  const ctx: RouteHandlerContext = {
    request: makeRequest(method),
    response,
    requestUrl: new URL(path, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handleCreditsStatusRoute(ctx, DEPS);
  const json = parts.length ? (JSON.parse(parts.join("")) as Record<string, unknown>) : null;
  return { handled, status, json };
};

// ─── env helpers ──────────────────────────────────────────────────────────────

const ENV_KEYS = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "PERPLEXITY_API_KEY",
  "KOKORO_URL",
  "DEEPGRAM_API_KEY",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];
const savedEnv: Partial<Record<EnvKey, string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  fetchMock.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
  vi.clearAllMocks();
});

// ─── routing ──────────────────────────────────────────────────────────────────

describe("handleCreditsStatusRoute — routing", () => {
  it("returns false for unrelated paths", async () => {
    const { handled } = await call("GET", "/api/other");
    expect(handled).toBe(false);
  });

  it("returns 405 for non-GET methods", async () => {
    const { handled, status } = await call("POST", "/api/credits/status");
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });

  it("returns 200 with all 6 keys when nothing configured", async () => {
    const { handled, status, json } = await call("GET", "/api/credits/status");
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      elevenlabs: { status: "not-configured" },
      openai: { status: "not-configured" },
      anthropic: { status: "not-configured" },
      perplexity: { status: "not-configured" },
      deepgram: { status: "not-configured" },
      kokoro: { status: "not-configured" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── ElevenLabs ───────────────────────────────────────────────────────────────

describe("checkElevenLabs", () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "test-el-key";
    process.env.ELEVENLABS_VOICE_ID = "test-voice";
  });

  it("returns not-configured when API key missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({ status: "not-configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns not-configured when voice ID missing", async () => {
    delete process.env.ELEVENLABS_VOICE_ID;
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({ status: "not-configured" });
  });

  it("returns ok with remaining chars on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription: { character_count: 1000, character_limit: 10000 },
      }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({ status: "ok", usage: "9,000 chars left" });
  });

  it("returns ok without usage when limit is 0", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ subscription: { character_count: 0, character_limit: 0 } }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({ status: "ok" });
  });

  it("returns out-of-credits when remaining chars <= 0", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription: { character_count: 10000, character_limit: 10000 },
      }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.elevenlabs as { status: string }).status).toBe("out-of-credits");
  });

  it("returns ok with note for scoped key missing user_read (401 + missing_permissions)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: { code: "unauthorized", status: "missing_permissions" } }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({
      status: "ok",
      note: "key lacks user_read — balance unavailable",
    });
  });

  it("returns invalid-key for plain 401 without missing_permissions", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: { code: "unauthorized", status: "invalid_api_key" } }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.elevenlabs as { status: string }).status).toBe("invalid-key");
  });

  it("returns out-of-credits for 402", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402 });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.elevenlabs as { status: string }).status).toBe("out-of-credits");
  });

  it("returns ok with note for 403", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({
      status: "ok",
      note: "key lacks user_read — balance unavailable",
    });
  });

  it("returns error for other non-ok status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({ status: "error", note: "HTTP 500" });
  });

  it("returns error when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.elevenlabs).toEqual({ status: "error", note: "Request failed" });
  });
});

// ─── OpenAI ───────────────────────────────────────────────────────────────────

describe("checkOpenAI", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-oai-key";
  });

  it("returns not-configured when key missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.openai).toEqual({ status: "not-configured" });
  });

  it("returns ok on 200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.openai).toEqual({ status: "ok" });
  });

  it("returns invalid-key on 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.openai as { status: string }).status).toBe("invalid-key");
  });

  it("returns out-of-credits on 429 with insufficient_quota", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: "insufficient_quota" } }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.openai as { status: string }).status).toBe("out-of-credits");
  });

  it("returns rate-limited error on 429 with other code", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: "rate_limit_exceeded" } }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.openai).toEqual({ status: "error", note: "Rate limited" });
  });

  it("returns out-of-credits on 402 with insufficient_quota", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({ error: { code: "insufficient_quota" } }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.openai as { status: string }).status).toBe("out-of-credits");
  });

  it("returns error for other non-ok status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.openai).toEqual({ status: "error", note: "HTTP 503" });
  });

  it("returns error when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.openai).toEqual({ status: "error", note: "Request failed" });
  });
});

// ─── Anthropic ────────────────────────────────────────────────────────────────

describe("checkAnthropic", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-ant-key";
  });

  it("returns not-configured when key missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.anthropic).toEqual({ status: "not-configured" });
  });

  it("returns ok on 200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.anthropic).toEqual({ status: "ok" });
  });

  it("returns invalid-key on 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.anthropic as { status: string }).status).toBe("invalid-key");
  });

  it("returns out-of-credits on 402", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.anthropic as { status: string }).status).toBe("out-of-credits");
  });

  it("returns out-of-credits on 529", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 529, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.anthropic as { status: string }).status).toBe("out-of-credits");
  });

  it("returns error for other status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.anthropic).toEqual({ status: "error", note: "HTTP 500" });
  });

  it("returns error when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.anthropic).toEqual({ status: "error", note: "Request failed" });
  });
});

// ─── Perplexity ───────────────────────────────────────────────────────────────

describe("checkPerplexity", () => {
  beforeEach(() => {
    process.env.PERPLEXITY_API_KEY = "test-pplx-key";
  });

  it("returns not-configured when key missing", async () => {
    delete process.env.PERPLEXITY_API_KEY;
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.perplexity).toEqual({ status: "not-configured" });
  });

  it("returns ok on 200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.perplexity).toEqual({ status: "ok" });
  });

  it("returns invalid-key on 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.perplexity as { status: string }).status).toBe("invalid-key");
  });

  it("returns out-of-credits on 402", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.perplexity as { status: string }).status).toBe("out-of-credits");
  });

  it("returns error for other status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.perplexity).toEqual({ status: "error", note: "HTTP 503" });
  });

  it("returns error when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.perplexity).toEqual({ status: "error", note: "Request failed" });
  });
});

// ─── Kokoro ───────────────────────────────────────────────────────────────────

describe("checkKokoro", () => {
  beforeEach(() => {
    process.env.KOKORO_URL = "http://localhost:8000";
  });

  it("returns not-configured when URL missing", async () => {
    delete process.env.KOKORO_URL;
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.kokoro).toEqual({ status: "not-configured" });
  });

  it("returns ok on healthy response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.kokoro).toEqual({ status: "ok" });
  });

  it("returns error on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.kokoro).toEqual({ status: "error", note: "HTTP 503" });
  });

  it("returns error when fetch throws (service unreachable)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.kokoro).toEqual({ status: "error", note: "Kokoro not reachable" });
  });
});

// ─── Deepgram ─────────────────────────────────────────────────────────────────

describe("checkDeepgram", () => {
  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = "test-dg-key";
  });

  it("returns not-configured when key missing", async () => {
    delete process.env.DEEPGRAM_API_KEY;
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "not-configured" });
  });

  it("returns ok with balance when project and funds exist", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ project_id: "proj-abc" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [{ amount: 4.23, units: "usd" }] }),
      });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "ok", usage: "$4.23 remaining" });
  });

  it("returns out-of-credits when balance is 0", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ project_id: "proj-abc" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [{ amount: 0, units: "usd" }] }),
      });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "out-of-credits", usage: "$0.00 remaining" });
  });

  it("returns ok without usage when no projects exist (pay-as-you-go)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projects: [] }),
    });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "ok" });
  });

  it("returns ok without usage when balance array is empty", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ project_id: "proj-abc" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "ok" });
  });

  it("returns ok without usage when balance fetch throws", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ project_id: "proj-abc" }] }),
      })
      .mockRejectedValueOnce(new Error("timeout"));
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "ok" });
  });

  it("returns invalid-key on 401", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.deepgram as { status: string }).status).toBe("invalid-key");
  });

  it("returns out-of-credits on 402", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect((json?.deepgram as { status: string }).status).toBe("out-of-credits");
  });

  it("returns error for other status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "error", note: "HTTP 503" });
  });

  it("returns error when projects fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    const { json } = await call("GET", "/api/credits/status");
    expect(json?.deepgram).toEqual({ status: "error", note: "Request failed" });
  });
});
