import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { AGENT_ARCHETYPES } from "../src/agentArsenal";
import {
  handleArsenalDeployRoute,
  handleArsenalListRoute,
} from "../src/createApiServer/arsenalRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

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

const makeResponse = () => {
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
    get status() {
      return status;
    },
    get body() {
      return parts.length ? (JSON.parse(parts.join("")) as unknown) : null;
    },
  };
  return response;
};

const callList = async (method: string, path: string) => {
  const res = makeResponse();
  const ctx: RouteHandlerContext = {
    request: makeRequest(method),
    response: res as unknown as ServerResponse,
    requestUrl: new URL(path, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handleArsenalListRoute(ctx, {} as RouteHandlerDependencies);
  return { handled, status: res.status, json: res.body };
};

const callDeploy = async (
  method: string,
  path: string,
  body: unknown,
  deps?: Partial<RouteHandlerDependencies>,
) => {
  const res = makeResponse();
  const ctx: RouteHandlerContext = {
    request: makeRequest(method, body),
    response: res as unknown as ServerResponse,
    requestUrl: new URL(path, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handleArsenalDeployRoute(ctx, (deps ?? {}) as RouteHandlerDependencies);
  return { handled, status: res.status, json: res.body };
};

describe("handleArsenalListRoute", () => {
  it("returns false for unrelated paths", async () => {
    const { handled } = await callList("GET", "/api/other");
    expect(handled).toBe(false);
  });

  it("returns 405 for non-GET methods", async () => {
    const { handled, status } = await callList("POST", "/api/arsenal");
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });

  it("returns all archetypes with id/name/role/icon/category/skills", async () => {
    const { handled, status, json } = await callList("GET", "/api/arsenal");
    expect(handled).toBe(true);
    expect(status).toBe(200);
    const list = json as Array<Record<string, unknown>>;
    expect(list).toHaveLength(AGENT_ARCHETYPES.length);
    for (const item of list) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.name).toBe("string");
      expect(typeof item.role).toBe("string");
      expect(typeof item.icon).toBe("string");
      expect(typeof item.category).toBe("string");
      expect(Array.isArray(item.skills)).toBe(true);
      expect(item).not.toHaveProperty("systemPrompt");
    }
  });
});

describe("handleArsenalDeployRoute", () => {
  it("returns false for unrelated paths", async () => {
    const { handled } = await callDeploy("POST", "/api/other", {});
    expect(handled).toBe(false);
  });

  it("returns 405 for non-POST methods", async () => {
    const { handled, status } = await callDeploy("GET", "/api/arsenal/deploy", undefined);
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });

  it("returns 400 when archetypeId is missing", async () => {
    const { handled, status, json } = await callDeploy("POST", "/api/arsenal/deploy", {});
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect((json as Record<string, unknown>).error).toMatch(/archetypeId/i);
  });

  it("returns 400 when archetypeId is an empty string", async () => {
    const { handled, status } = await callDeploy("POST", "/api/arsenal/deploy", {
      archetypeId: "   ",
    });
    expect(handled).toBe(true);
    expect(status).toBe(400);
  });

  it("returns 404 for unknown archetypeId", async () => {
    const { handled, status, json } = await callDeploy("POST", "/api/arsenal/deploy", {
      archetypeId: "does-not-exist",
    });
    expect(handled).toBe(true);
    expect(status).toBe(404);
    expect((json as Record<string, unknown>).error).toMatch(/does-not-exist/);
  });

  it("returns 200 with terminalId and tentacleId for a valid archetype", async () => {
    const firstArchetype = AGENT_ARCHETYPES[0]!;
    const createTerminal = vi.fn().mockReturnValue({
      terminalId: "t-123",
      tentacleId: "ten-456",
    });
    const deps = { runtime: { createTerminal } } as unknown as RouteHandlerDependencies;
    const { handled, status, json } = await callDeploy(
      "POST",
      "/api/arsenal/deploy",
      { archetypeId: firstArchetype.id },
      deps,
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    const body = json as Record<string, unknown>;
    expect(body.terminalId).toBe("t-123");
    expect(body.tentacleId).toBe("ten-456");
    expect(body.archetypeId).toBe(firstArchetype.id);
    expect(createTerminal).toHaveBeenCalledOnce();
  });

  it("returns 500 when runtime.createTerminal throws", async () => {
    const firstArchetype = AGENT_ARCHETYPES[0]!;
    const createTerminal = vi.fn().mockImplementation(() => {
      throw new Error("terminal exploded");
    });
    const deps = { runtime: { createTerminal } } as unknown as RouteHandlerDependencies;
    const { handled, status, json } = await callDeploy(
      "POST",
      "/api/arsenal/deploy",
      { archetypeId: firstArchetype.id },
      deps,
    );
    expect(handled).toBe(true);
    expect(status).toBe(500);
    expect((json as Record<string, unknown>).error).toBe("terminal exploded");
  });
});
