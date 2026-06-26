import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleTaskPlanRoute } from "../src/createApiServer/taskPlanRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

// ─── mocks ─────────────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ─── helpers ───────────────────────────────────────────────────────────────────

const DEPS = {} as unknown as RouteHandlerDependencies;

const makeRequest = (method: string, body?: Buffer, headers?: Record<string, string>): IncomingMessage => {
  const req = {
    method,
    headers: headers ?? {},
  } as unknown as IncomingMessage & { [Symbol.asyncIterator]?: unknown };
  (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
    async function* () {
      if (body) yield body;
    };
  return req;
};

const call = async (
  method: string,
  url: string,
  body?: Buffer,
  headers?: Record<string, string>,
) => {
  let status = 0;
  const parts: string[] = [];
  const response = {
    writeHead(s: number) { status = s; return response; },
    end(chunk?: string) { if (chunk) parts.push(String(chunk)); },
  } as unknown as ServerResponse;
  const ctx: RouteHandlerContext = {
    request: makeRequest(method, body, headers),
    response,
    requestUrl: new URL(url, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handleTaskPlanRoute(ctx, DEPS);
  const json = parts.length ? JSON.parse(parts.join("")) : null;
  return { handled, status, json };
};

beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

// ─── tests ─────────────────────────────────────────────────────────────────────

describe("handleTaskPlanRoute", () => {
  it("returns not-handled for unrelated paths", async () => {
    const { handled } = await call("POST", "/api/tasks/other");
    expect(handled).toBe(false);
  });

  it("returns 405 for non-POST", async () => {
    const { handled, status } = await call("GET", "/api/tasks/plan");
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });

  it("returns 503 when ANTHROPIC_API_KEY is missing", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const body = Buffer.from(JSON.stringify({ goal: "Launch a website" }));
    const { handled, status, json } = await call("POST", "/api/tasks/plan", body, { "content-type": "application/json" });
    expect(handled).toBe(true);
    expect(status).toBe(503);
    expect(json.error).toMatch(/ANTHROPIC_API_KEY/);

    process.env.ANTHROPIC_API_KEY = saved;
  });

  it("returns 400 when goal is missing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const body = Buffer.from(JSON.stringify({ goal: "" }));
    const { handled, status, json } = await call("POST", "/api/tasks/plan", body, { "content-type": "application/json" });
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/goal/i);
  });

  it("returns 400 when goal exceeds 2000 chars", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const body = Buffer.from(JSON.stringify({ goal: "x".repeat(2001) }));
    const { handled, status, json } = await call("POST", "/api/tasks/plan", body, { "content-type": "application/json" });
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/2000/);
  });

  it("returns planned tasks from Claude", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    const plan = {
      tasks: [
        { title: "Define target audience", detail: "Identify who will use the product", priority: "high" },
        { title: "Set up project repository", detail: "Initialize git and CI/CD", priority: "medium" },
        { title: "Design landing page mockup", detail: "Use Figma for wireframes", priority: "medium" },
      ],
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify(plan) }],
      }),
    });

    const body = Buffer.from(JSON.stringify({ goal: "Launch a product landing page" }));
    const { handled, status, json } = await call("POST", "/api/tasks/plan", body, { "content-type": "application/json" });

    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(json.tasks)).toBe(true);
    expect(json.tasks.length).toBe(3);
    expect(json.tasks[0].title).toBe("Define target audience");
    expect(json.tasks[0].priority).toBe("high");
  });

  it("returns 502 when Claude returns unparseable JSON", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Sorry, I cannot help with that." }],
      }),
    });

    const body = Buffer.from(JSON.stringify({ goal: "Build something" }));
    const { handled, status } = await call("POST", "/api/tasks/plan", body, { "content-type": "application/json" });

    expect(handled).toBe(true);
    expect(status).toBe(502);
  });
});
