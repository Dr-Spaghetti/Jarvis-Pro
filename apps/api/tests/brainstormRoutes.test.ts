import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual };
});

import {
  handleBrainstormExpandRoute,
  handleBrainstormIdeaItemRoute,
  handleBrainstormIdeasRoute,
} from "../src/createApiServer/brainstormRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

const DEPS = {} as unknown as RouteHandlerDependencies;
const previousVault = process.env.OBSIDIAN_VAULT_PATH;
const temps: string[] = [];

const makeRequest = (method: string, body?: unknown): IncomingMessage => {
  const req = { method } as unknown as IncomingMessage & { [Symbol.asyncIterator]?: unknown };
  if (body !== undefined) {
    const buf = Buffer.from(JSON.stringify(body));
    (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () {
        yield buf;
      };
  }
  return req;
};

const call = async (
  handler: (c: RouteHandlerContext, d: RouteHandlerDependencies) => Promise<boolean>,
  method: string,
  url: string,
  body?: unknown,
) => {
  let status = 0;
  const parts: string[] = [];
  const response = {
    writeHead(s: number) {
      status = s;
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
  const handled = await handler(ctx, DEPS);
  const json = parts.length ? JSON.parse(parts.join("")) : null;
  return { handled, status, json };
};

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "octogent-brainstorm-"));
  temps.push(vault);
  process.env.OBSIDIAN_VAULT_PATH = vault;
});

afterEach(() => {
  if (previousVault === undefined) Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
  else process.env.OBSIDIAN_VAULT_PATH = previousVault;
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("handleBrainstormIdeasRoute", () => {
  it("returns not-handled for unrelated path", async () => {
    const { handled } = await call(handleBrainstormIdeasRoute, "GET", "/api/brain/recent");
    expect(handled).toBe(false);
  });

  it("GET /api/brainstorm/ideas returns empty list when Ideas/ folder absent", async () => {
    const { handled, status, json } = await call(
      handleBrainstormIdeasRoute,
      "GET",
      "/api/brainstorm/ideas",
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.configured).toBe(true);
    expect(json.ideas).toEqual([]);
  });

  it("GET without vault configured returns configured:false", async () => {
    Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
    const { handled, status, json } = await call(
      handleBrainstormIdeasRoute,
      "GET",
      "/api/brainstorm/ideas",
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.configured).toBe(false);
  });

  it("POST creates an idea file and returns it", async () => {
    const { handled, status, json } = await call(
      handleBrainstormIdeasRoute,
      "POST",
      "/api/brainstorm/ideas",
      { title: "Test Idea", body: "Some body text", tags: ["alpha", "beta"] },
    );
    expect(handled).toBe(true);
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.idea.title).toBe("Test Idea");
    expect(json.idea.tags).toEqual(["alpha", "beta"]);
    expect(json.idea.id).toMatch(/^idea-\d+$/);

    const filePath = join(vault, "Ideas", `${json.idea.id}.md`);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("# Test Idea");
    expect(content).toContain("Some body text");
    expect(content).toContain('"alpha"');
  });

  it("POST without title returns 400", async () => {
    const { handled, status, json } = await call(
      handleBrainstormIdeasRoute,
      "POST",
      "/api/brainstorm/ideas",
      { title: "  ", body: "body" },
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json.error).toMatch(/title/i);
  });

  it("GET returns created idea in list", async () => {
    await call(handleBrainstormIdeasRoute, "POST", "/api/brainstorm/ideas", {
      title: "Listed Idea",
      body: "Listed body",
      tags: ["x"],
    });
    const { json } = await call(handleBrainstormIdeasRoute, "GET", "/api/brainstorm/ideas");
    expect(json.ideas.length).toBe(1);
    expect(json.ideas[0].title).toBe("Listed Idea");
    expect(json.ideas[0].tags).toEqual(["x"]);
  });
});

describe("handleBrainstormIdeaItemRoute", () => {
  it("returns not-handled for collection path", async () => {
    const { handled } = await call(handleBrainstormIdeaItemRoute, "PUT", "/api/brainstorm/ideas");
    expect(handled).toBe(false);
  });

  it("PUT updates an existing idea", async () => {
    // Create first
    const { json: created } = await call(
      handleBrainstormIdeasRoute,
      "POST",
      "/api/brainstorm/ideas",
      { title: "Original", body: "old body", tags: [] },
    );
    const id = created.idea.id as string;

    const { handled, status, json } = await call(
      handleBrainstormIdeaItemRoute,
      "PUT",
      `/api/brainstorm/ideas/${id}`,
      { title: "Updated", body: "new body", tags: ["tag1"] },
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.idea.title).toBe("Updated");
    expect(json.idea.tags).toEqual(["tag1"]);

    const filePath = join(vault, "Ideas", `${id}.md`);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("# Updated");
    expect(content).toContain("new body");
  });

  it("DELETE removes the idea file", async () => {
    const { json: created } = await call(
      handleBrainstormIdeasRoute,
      "POST",
      "/api/brainstorm/ideas",
      { title: "To Delete", body: "", tags: [] },
    );
    const id = created.idea.id as string;
    const filePath = join(vault, "Ideas", `${id}.md`);
    expect(existsSync(filePath)).toBe(true);

    const { handled, status, json } = await call(
      handleBrainstormIdeaItemRoute,
      "DELETE",
      `/api/brainstorm/ideas/${id}`,
    );
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it("PUT unknown idea returns 404", async () => {
    const { status } = await call(
      handleBrainstormIdeaItemRoute,
      "PUT",
      "/api/brainstorm/ideas/idea-9999999",
      { title: "X", body: "", tags: [] },
    );
    expect(status).toBe(404);
  });

  it("rejects path traversal ID via URL normalization (route does not match)", async () => {
    // The URL constructor normalises /ideas/../../etc/passwd → /api/etc/passwd,
    // so the route regex never matches — handled returns false (no 400 needed).
    const { handled } = await call(
      handleBrainstormIdeaItemRoute,
      "DELETE",
      "/api/brainstorm/ideas/../../etc/passwd",
    );
    expect(handled).toBe(false);
  });

  it("rejects ID containing dots via safeIdeaPath allowlist", async () => {
    // A percent-encoded slash that survives URL parsing still gets blocked by
    // the strict alphanumeric+hyphen+underscore allowlist in safeIdeaPath.
    const { handled, status } = await call(
      handleBrainstormIdeaItemRoute,
      "DELETE",
      "/api/brainstorm/ideas/idea-123.evil",
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
  });
});

describe("handleBrainstormExpandRoute", () => {
  it("returns not-handled for non-expand path", async () => {
    const { handled } = await call(
      handleBrainstormExpandRoute,
      "POST",
      "/api/brainstorm/ideas/idea-123",
    );
    expect(handled).toBe(false);
  });

  it("returns 404 for missing idea", async () => {
    const { handled, status } = await call(
      handleBrainstormExpandRoute,
      "POST",
      "/api/brainstorm/ideas/idea-0000000/expand",
    );
    expect(handled).toBe(true);
    expect(status).toBe(404);
  });
});
