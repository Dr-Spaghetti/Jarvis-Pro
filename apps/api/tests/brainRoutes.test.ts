import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  handleBrainCaptureRoute,
  handleBrainJournalRoute,
  handleBrainMemoryRoute,
  handleBrainNoteRoute,
  handleBrainRecentRoute,
  handleBrainRememberRoute,
  handleBrainSearchRoute,
} from "../src/createApiServer/brainRoutes";
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
  vault = mkdtempSync(join(tmpdir(), "octogent-brain-"));
  temps.push(vault);
  writeFileSync(
    join(vault, "Pricing Strategy.md"),
    "# Pricing Strategy\n\nCharge more for value.\n",
  );
  writeFileSync(join(vault, "Daily Log.md"), "# Daily Log\n\nReviewed the Venue pipeline today.\n");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(vault, ".obsidian", "config.md"), "should be ignored");
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

describe("brainRoutes", () => {
  it("recent returns vault notes (excluding .obsidian) and ignores other paths", async () => {
    const res = await call(handleBrainRecentRoute, "GET", "/api/brain/recent");
    expect(res.handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json.configured).toBe(true);
    const titles = res.json.notes.map((n: { title: string }) => n.title);
    expect(titles).toContain("Pricing Strategy");
    expect(titles).toContain("Daily Log");
    expect(titles.some((t: string) => t.includes("config"))).toBe(false);
  });

  it("recent reports unconfigured when no vault is set", async () => {
    Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
    const res = await call(handleBrainRecentRoute, "GET", "/api/brain/recent");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ configured: false, notes: [] });
  });

  it("search matches by content and returns a snippet", async () => {
    const res = await call(handleBrainSearchRoute, "GET", "/api/brain/search?q=Venue");
    expect(res.status).toBe(200);
    expect(res.json.notes.length).toBeGreaterThan(0);
    expect(res.json.notes[0].title).toBe("Daily Log");
    expect(res.json.notes[0].snippet.toLowerCase()).toContain("venue");
  });

  it("note reads a file and blocks path traversal", async () => {
    const ok = await call(
      handleBrainNoteRoute,
      "GET",
      "/api/brain/note?path=Pricing%20Strategy.md",
    );
    expect(ok.status).toBe(200);
    expect(ok.json.content).toContain("Charge more");

    const bad = await call(handleBrainNoteRoute, "GET", "/api/brain/note?path=../secret.md");
    expect(bad.status).toBe(404);
  });

  it("capture appends to Inbox/Quick Capture.md", async () => {
    const res = await call(handleBrainCaptureRoute, "POST", "/api/brain/capture", {
      text: "call Vinny about Q3",
    });
    expect(res.status).toBe(201);
    expect(res.json.ok).toBe(true);
    const file = join(vault, "Inbox", "Quick Capture.md");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("call Vinny about Q3");
  });

  it("journal appends an entry and lists it back newest-first with parsed fields", async () => {
    const first = await call(handleBrainJournalRoute, "POST", "/api/brain/journal", {
      action: "Produced morning brief",
      detail: "3 emails flagged",
      status: "ok",
      skill: "daily-brief",
    });
    expect(first.status).toBe(201);
    expect(first.json.ok).toBe(true);

    await call(handleBrainJournalRoute, "POST", "/api/brain/journal", {
      action: "Local Falcon scan failed",
      status: "error",
      skill: "local-falcon-seo",
    });

    const list = await call(handleBrainJournalRoute, "GET", "/api/brain/journal?limit=10");
    expect(list.status).toBe(200);
    expect(list.json.configured).toBe(true);
    expect(list.json.entries.length).toBe(2);
    // newest first
    expect(list.json.entries[0].action).toBe("Local Falcon scan failed");
    expect(list.json.entries[0].status).toBe("error");
    expect(list.json.entries[0].skill).toBe("local-falcon-seo");
    expect(list.json.entries[1].action).toBe("Produced morning brief");
    expect(list.json.entries[1].detail).toBe("3 emails flagged");
    expect(existsSync(join(vault, "Journal", "Activity Log.md"))).toBe(true);
  });

  it("journal requires an action on POST", async () => {
    const res = await call(handleBrainJournalRoute, "POST", "/api/brain/journal", { detail: "x" });
    expect(res.status).toBe(400);
  });

  it("remember appends a fact and memory reads it back as an item", async () => {
    const res = await call(handleBrainRememberRoute, "POST", "/api/brain/remember", {
      text: "Nick prefers email-only outreach (no calls).",
    });
    expect(res.status).toBe(201);
    expect(res.json.ok).toBe(true);

    const mem = await call(handleBrainMemoryRoute, "GET", "/api/brain/memory");
    expect(mem.status).toBe(200);
    expect(mem.json.configured).toBe(true);
    expect(mem.json.items).toContain("Nick prefers email-only outreach (no calls).");
    expect(existsSync(join(vault, "Jarvis", "Memory.md"))).toBe(true);
  });

  it("memory reports unconfigured when no vault is set", async () => {
    Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
    const res = await call(handleBrainMemoryRoute, "GET", "/api/brain/memory");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ configured: false, content: "", items: [] });
  });
});
