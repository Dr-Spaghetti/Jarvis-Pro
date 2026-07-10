import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";
import {
  handleWorkflowImproveRoute,
  handleWorkflowItemRoute,
  handleWorkflowRunHistoryRoute,
  handleWorkflowRunRoute,
  handleWorkflowRunsRecentRoute,
  handleWorkflowsCollectionRoute,
} from "../src/createApiServer/workflowRoutes";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const temps: string[] = [];
let stateDir: string;

const makeDeps = (overrides?: Partial<RouteHandlerDependencies>): RouteHandlerDependencies =>
  ({
    projectStateDir: stateDir,
    getApiBaseUrl: () => "http://localhost:3001",
    authToken: null,
    ...overrides,
  }) as unknown as RouteHandlerDependencies;

const makeRequest = (method: string, body?: unknown): IncomingMessage => {
  const req = { method, headers: {} } as unknown as IncomingMessage & {
    [Symbol.asyncIterator]?: unknown;
    on?: unknown;
  };
  (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
    async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    };
  (req as { on: (event: string, cb: () => void) => void }).on = (
    _event: string,
    _cb: () => void,
  ) => {};
  return req;
};

const call = async (
  handler: (c: RouteHandlerContext, d: RouteHandlerDependencies) => Promise<boolean>,
  method: string,
  url: string,
  body?: unknown,
  deps?: RouteHandlerDependencies,
) => {
  let status = 0;
  const parts: string[] = [];
  const sseEvents: unknown[] = [];
  const response = {
    writeHead(s: number) {
      status = s;
      return response;
    },
    end(chunk?: string) {
      if (chunk) parts.push(String(chunk));
    },
    write(chunk: string) {
      const match = /^data: (.+)\n\n$/.exec(chunk);
      if (match) sseEvents.push(JSON.parse(match[1] ?? "{}"));
    },
  } as unknown as ServerResponse;
  const ctx: RouteHandlerContext = {
    request: makeRequest(method, body),
    response,
    requestUrl: new URL(url, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handler(ctx, deps ?? makeDeps());
  const json = parts.length ? JSON.parse(parts.join("")) : null;
  return { handled, status, json, sseEvents };
};

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "octogent-workflows-"));
  temps.push(stateDir);
  fetchMock.mockReset();
});

afterEach(() => {
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe("handleWorkflowsCollectionRoute", () => {
  it("returns false for unrelated path", async () => {
    const { handled } = await call(handleWorkflowsCollectionRoute, "GET", "/api/brain/recent");
    expect(handled).toBe(false);
  });

  it("GET /api/workflows returns empty array on fresh workspace", async () => {
    const { handled, status, json } = await call(
      handleWorkflowsCollectionRoute,
      "GET",
      "/api/workflows",
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.workflows).toEqual([]);
  });

  it("POST /api/workflows creates and returns a workflow (201)", async () => {
    const { handled, status, json } = await call(
      handleWorkflowsCollectionRoute,
      "POST",
      "/api/workflows",
      { name: "My Workflow", description: "desc", steps: "Step 1\nStep 2" },
    );
    expect(handled).toBe(true);
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.workflow.name).toBe("My Workflow");
    expect(json.workflow.description).toBe("desc");
    expect(json.workflow.id).toMatch(/^wf-\d+$/);
  });

  it("POST without name returns 400", async () => {
    const { status, json } = await call(handleWorkflowsCollectionRoute, "POST", "/api/workflows", {
      name: "  ",
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/name/i);
  });

  it("GET returns created workflow in list", async () => {
    await call(handleWorkflowsCollectionRoute, "POST", "/api/workflows", {
      name: "Listed",
      description: "",
      steps: "",
    });
    const { json } = await call(handleWorkflowsCollectionRoute, "GET", "/api/workflows");
    expect(json.workflows.length).toBe(1);
    expect(json.workflows[0].name).toBe("Listed");
  });
});

describe("handleWorkflowItemRoute", () => {
  it("returns false for collection path", async () => {
    const { handled } = await call(handleWorkflowItemRoute, "GET", "/api/workflows");
    expect(handled).toBe(false);
  });

  it("GET /api/workflows/:id returns 404 for unknown id", async () => {
    const { handled, status } = await call(
      handleWorkflowItemRoute,
      "GET",
      "/api/workflows/wf-9999999",
    );
    expect(handled).toBe(true);
    expect(status).toBe(404);
  });

  it("PATCH /api/workflows/:id updates name/description/steps", async () => {
    const { json: created } = await call(handleWorkflowsCollectionRoute, "POST", "/api/workflows", {
      name: "Original",
      description: "old",
      steps: "step1",
    });
    const id = created.workflow.id as string;

    const { handled, status, json } = await call(
      handleWorkflowItemRoute,
      "PATCH",
      `/api/workflows/${id}`,
      { name: "Updated", description: "new desc", steps: "step1\nstep2" },
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.workflow.name).toBe("Updated");
    expect(json.workflow.description).toBe("new desc");
  });

  it("DELETE /api/workflows/:id removes workflow (200 ok:true)", async () => {
    const { json: created } = await call(handleWorkflowsCollectionRoute, "POST", "/api/workflows", {
      name: "To Delete",
      description: "",
      steps: "",
    });
    const id = created.workflow.id as string;

    const { handled, status, json } = await call(
      handleWorkflowItemRoute,
      "DELETE",
      `/api/workflows/${id}`,
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const { status: getStatus } = await call(
      handleWorkflowItemRoute,
      "GET",
      `/api/workflows/${id}`,
    );
    expect(getStatus).toBe(404);
  });

  it("rejects invalid ID characters (400)", async () => {
    const { handled, status } = await call(
      handleWorkflowItemRoute,
      "GET",
      "/api/workflows/wf-123.evil",
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
  });
});

describe("handleWorkflowRunHistoryRoute", () => {
  it("returns false for unrelated path", async () => {
    const { handled } = await call(
      handleWorkflowRunHistoryRoute,
      "GET",
      "/api/workflows/wf-1/improve",
    );
    expect(handled).toBe(false);
  });

  it("GET /api/workflows/:id/runs returns empty runs array", async () => {
    const { handled, status, json } = await call(
      handleWorkflowRunHistoryRoute,
      "GET",
      "/api/workflows/wf-123/runs",
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.runs).toEqual([]);
  });
});

describe("handleWorkflowRunsRecentRoute", () => {
  it("returns false for unrelated path", async () => {
    const { handled } = await call(handleWorkflowRunsRecentRoute, "GET", "/api/workflows/recent");
    expect(handled).toBe(false);
  });

  it("GET /api/workflow-runs/recent returns empty list", async () => {
    const { handled, status, json } = await call(
      handleWorkflowRunsRecentRoute,
      "GET",
      "/api/workflow-runs/recent",
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.runs).toEqual([]);
  });
});

describe("handleWorkflowImproveRoute", () => {
  it("returns false for unrelated path", async () => {
    const { handled } = await call(handleWorkflowImproveRoute, "POST", "/api/workflows/wf-1/run");
    expect(handled).toBe(false);
  });

  it("returns 404 for missing workflow", async () => {
    const { handled, status } = await call(
      handleWorkflowImproveRoute,
      "POST",
      "/api/workflows/wf-9999999/improve",
    );
    expect(handled).toBe(true);
    expect(status).toBe(404);
  });

  it("returns 400 'run at least once' guard when no runs exist", async () => {
    const { json: created } = await call(handleWorkflowsCollectionRoute, "POST", "/api/workflows", {
      name: "New Workflow",
      description: "",
      steps: "Do something",
    });
    const id = created.workflow.id as string;

    const { handled, status, json } = await call(
      handleWorkflowImproveRoute,
      "POST",
      `/api/workflows/${id}/improve`,
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/run.*at least once/i);
  });
});

describe("handleWorkflowRunRoute", () => {
  it("returns false for unrelated path", async () => {
    const { handled } = await call(handleWorkflowRunRoute, "POST", "/api/workflows/wf-1/runs");
    expect(handled).toBe(false);
  });

  it("returns 404 for missing workflow", async () => {
    const { handled, status } = await call(
      handleWorkflowRunRoute,
      "POST",
      "/api/workflows/wf-9999999/run",
    );
    expect(handled).toBe(true);
    expect(status).toBe(404);
  });

  it("streams SSE events and emits done event via mocked fetch", async () => {
    const { json: created } = await call(handleWorkflowsCollectionRoute, "POST", "/api/workflows", {
      name: "Run Me",
      description: "",
      steps: "Ask something",
    });
    const id = created.workflow.id as string;

    fetchMock.mockResolvedValue({
      json: async () => ({ answer: "The answer is 42" }),
    });

    const { handled, status, sseEvents } = await call(
      handleWorkflowRunRoute,
      "POST",
      `/api/workflows/${id}/run`,
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);

    const doneEvent = sseEvents.find((e) => (e as { type: string }).type === "done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent as { status: string }).status).toBe("ok");

    const stepDone = sseEvents.find((e) => (e as { type: string }).type === "step-done");
    expect(stepDone).toBeDefined();
    expect((stepDone as { answer: string }).answer).toBe("The answer is 42");
  });

  it("returns 400 when workflow has no steps", async () => {
    const { json: created } = await call(handleWorkflowsCollectionRoute, "POST", "/api/workflows", {
      name: "Empty Steps",
      description: "",
      steps: "   ",
    });
    const id = created.workflow.id as string;

    const { handled, status, json } = await call(
      handleWorkflowRunRoute,
      "POST",
      `/api/workflows/${id}/run`,
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/no steps/i);
  });
});
