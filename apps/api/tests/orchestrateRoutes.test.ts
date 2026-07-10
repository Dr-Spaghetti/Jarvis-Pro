import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleOrchestrateRoute, orchestrateTask } from "../src/createApiServer/orchestrateRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const makeRuntime = () =>
  ({
    createTerminal: vi.fn().mockReturnValue({ terminalId: "t1", tentacleId: "tc1" }),
  }) as unknown as RouteHandlerDependencies["runtime"];

const DEPS = (runtime: RouteHandlerDependencies["runtime"]) =>
  ({ runtime }) as unknown as RouteHandlerDependencies;

const makeRequest = (method: string, body?: unknown): IncomingMessage => {
  const req = { method, headers: {} } as unknown as IncomingMessage & {
    [Symbol.asyncIterator]?: unknown;
  };
  if (body !== undefined) {
    const buf = Buffer.from(JSON.stringify(body));
    (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () {
        yield buf;
      };
  } else {
    (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () {};
  }
  return req;
};

const call = async (method: string, url: string, body?: unknown) => {
  const runtime = makeRuntime();
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
    request: makeRequest(method, body),
    response,
    requestUrl: new URL(url, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handleOrchestrateRoute(ctx, DEPS(runtime));
  const json = parts.length ? (JSON.parse(parts.join("")) as Record<string, unknown>) : null;
  return { handled, status, json, runtime };
};

const savedApiKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  fetchMock.mockReset();
});

afterEach(() => {
  if (savedApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = savedApiKey;
  }
  vi.clearAllMocks();
});

describe("handleOrchestrateRoute — routing", () => {
  it("returns false for unrelated paths", async () => {
    const { handled } = await call("POST", "/api/brain/other", { task: "something" });
    expect(handled).toBe(false);
  });

  it("returns 405 for non-POST methods", async () => {
    const { handled, status } = await call("GET", "/api/brain/orchestrate");
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });
});

describe("handleOrchestrateRoute — validation", () => {
  it("returns 400 when task is missing", async () => {
    const { handled, status, json } = await call("POST", "/api/brain/orchestrate", {});
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: "task is required" });
  });

  it("returns 400 when task is empty string", async () => {
    const { handled, status, json } = await call("POST", "/api/brain/orchestrate", { task: "  " });
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: "task is required" });
  });
});

describe("handleOrchestrateRoute — 503 when ANTHROPIC_API_KEY not configured", () => {
  it("returns 503 and orchestrateTask returns ok:false", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await orchestrateTask("do something", makeRuntime());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ANTHROPIC_API_KEY not configured");

    const { status, json } = await call("POST", "/api/brain/orchestrate", { task: "do something" });
    expect(status).toBe(503);
    expect(json).toMatchObject({ error: "ANTHROPIC_API_KEY not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleOrchestrateRoute — 502 on unparseable plan", () => {
  it("returns ok:false from orchestrateTask and 502 from handler", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "not valid json at all" }] }),
    });

    const result = await orchestrateTask("do something", makeRuntime());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Orchestrator returned unparseable plan");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "not valid json at all" }] }),
    });
    const { status, json } = await call("POST", "/api/brain/orchestrate", { task: "do something" });
    expect(status).toBe(502);
    expect(json).toMatchObject({ error: "Orchestrator returned unparseable plan" });
  });
});

describe("handleOrchestrateRoute — 502 when no valid agents in plan", () => {
  it("returns ok:false from orchestrateTask and 502 from handler", async () => {
    const badPlan = JSON.stringify({ plan: [{ archetypeId: "nonexistent-id", subtask: "foo" }] });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: badPlan }] }),
    });

    const result = await orchestrateTask("do something", makeRuntime());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("No valid agents in plan");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: badPlan }] }),
    });
    const { status, json } = await call("POST", "/api/brain/orchestrate", { task: "do something" });
    expect(status).toBe(502);
    expect(json).toMatchObject({ error: "No valid agents in plan" });
  });
});
