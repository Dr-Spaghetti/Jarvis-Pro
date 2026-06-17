import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/createApiServer/agenticAsk", () => ({
  agenticAsk: vi.fn(),
}));

import {
  handleBrainAskRoute,
  handleBrainCaptureRoute,
  handleBrainConversationRoute,
  handleBrainDigestRoute,
  handleBrainJournalRoute,
  handleBrainMemoryRoute,
  handleBrainModelsRoute,
  handleBrainNoteRoute,
  handleBrainRecentRoute,
  handleBrainRememberRoute,
  handleBrainSearchRoute,
  handleBrainSemanticRoute,
  localDateStamp,
  parseConversationMarkdown,
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

  it("search ranks multi-term + title matches above single-term body matches", async () => {
    writeFileSync(
      join(vault, "Pricing Notes.md"),
      "# Pricing Notes\n\nThoughts on pricing tiers and strategy for clients.\n",
    );
    writeFileSync(join(vault, "Random.md"), "# Random\n\nA note that mentions strategy once.\n");
    const res = await call(handleBrainSearchRoute, "GET", "/api/brain/search?q=pricing%20strategy");
    expect(res.status).toBe(200);
    const titles = res.json.notes.map((n: { title: string }) => n.title);
    // Pricing Strategy (title has both terms) and Pricing Notes (both terms) outrank
    // Random.md, which only matches "strategy".
    expect(titles[0]).toBe("Pricing Strategy");
    expect(titles.indexOf("Random")).toBeGreaterThan(titles.indexOf("Pricing Notes"));
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

  it("digest assembles open tasks, recent notes, and counts without an agent", async () => {
    writeFileSync(
      join(vault, "Tasks.md"),
      "# Tasks\n\n- [ ] Email Rachel at the Venue\n- [x] done thing\n- [ ] Invoice Park Place\n",
    );
    await call(handleBrainRememberRoute, "POST", "/api/brain/remember", { text: "email-only" });
    await call(handleBrainJournalRoute, "POST", "/api/brain/journal", {
      action: "ran digest test",
    });

    const res = await call(handleBrainDigestRoute, "GET", "/api/brain/digest");
    expect(res.status).toBe(200);
    expect(res.json.configured).toBe(true);
    expect(res.json.tasks.open).toContain("Email Rachel at the Venue");
    expect(res.json.tasks.open).toContain("Invoice Park Place");
    // completed tasks are excluded
    expect(res.json.tasks.open.some((t: string) => t.includes("done thing"))).toBe(false);
    expect(res.json.memory.factCount).toBeGreaterThanOrEqual(1);
    expect(res.json.journal.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.json.recentNotes)).toBe(true);
  });

  it("digest reports unconfigured (with today's date) when no vault is set", async () => {
    Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
    const res = await call(handleBrainDigestRoute, "GET", "/api/brain/digest");
    expect(res.status).toBe(200);
    expect(res.json.configured).toBe(false);
    expect(res.json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("ask returns available:false with retrieved sources when no chat model is reachable", async () => {
    // Force every cloud + local provider unreachable so the test is deterministic
    // regardless of which keys happen to be exported in the shell.
    const previousHost = process.env.OLLAMA_HOST;
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOpenAi = process.env.OPENAI_API_KEY;
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    try {
      const res = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {
        question: "What did I write about the Venue?",
      });
      expect(res.status).toBe(200);
      expect(res.json.available).toBe(false);
      expect(res.json.reason).toBe("no-chat-model");
      // retrieval still ran (lexical fallback) and surfaced a source
      expect(res.json.sources.some((s: { title: string }) => s.title === "Daily Log")).toBe(true);
    } finally {
      if (previousHost === undefined) Reflect.deleteProperty(process.env, "OLLAMA_HOST");
      else process.env.OLLAMA_HOST = previousHost;
      if (previousAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousOpenAi !== undefined) process.env.OPENAI_API_KEY = previousOpenAi;
    }
  });

  it("ask requires a question", async () => {
    const res = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {});
    expect(res.status).toBe(400);
  });

  it("semantic search falls back to lexical when Ollama is unreachable", async () => {
    // Force the embedder to fail so the test is deterministic with or without
    // a local Ollama install.
    const previousHost = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    try {
      const res = await call(handleBrainSemanticRoute, "GET", "/api/brain/semantic?q=Venue");
      expect(res.status).toBe(200);
      expect(res.json.configured).toBe(true);
      expect(res.json.semantic).toBe(false);
      // lexical fallback still surfaces the matching note
      expect(res.json.notes.some((n: { title: string }) => n.title === "Daily Log")).toBe(true);
    } finally {
      if (previousHost === undefined) Reflect.deleteProperty(process.env, "OLLAMA_HOST");
      else process.env.OLLAMA_HOST = previousHost;
    }
  });

  it("conversation route returns parsed turns from today's transcript", async () => {
    const dir = join(vault, "Jarvis", "Conversations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${localDateStamp()}.md`),
      "# Jarvis Conversations\n\nintro\n\n" +
        "## 09:15\n\n**You:** what's the weather\n\n**Jarvis:** Sunny, 75.\n\n" +
        "## 09:16\n\n**You:** and tomorrow\n\n**Jarvis:** Rain likely.\n\n",
    );
    const res = await call(handleBrainConversationRoute, "GET", "/api/brain/conversation");
    expect(res.status).toBe(200);
    expect(res.json.configured).toBe(true);
    expect(res.json.turns).toHaveLength(2);
    expect(res.json.turns[0]).toEqual({
      time: "09:15",
      question: "what's the weather",
      answer: "Sunny, 75.",
    });
    expect(res.json.turns[1].answer).toBe("Rain likely.");
  });

  it("conversation route reports unconfigured when no vault is set", async () => {
    Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
    const res = await call(handleBrainConversationRoute, "GET", "/api/brain/conversation");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ configured: false, turns: [] });
  });
});

describe("handleBrainModelsRoute — claudeModels field", () => {
  it("returns empty claudeModels when no Anthropic key is set", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    try {
      const res = await call(handleBrainModelsRoute, "GET", "/api/brain/models");
      expect(res.status).toBe(200);
      expect(res.json.claudeModels).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("returns Claude model IDs in claudeModels when Anthropic key is set", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    try {
      const res = await call(handleBrainModelsRoute, "GET", "/api/brain/models");
      expect(res.status).toBe(200);
      expect(res.json.claudeModels).toContain("claude-haiku-4-5-20251001");
      expect(res.json.claudeModels).toContain("claude-sonnet-4-6");
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
      else Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    }
  });
});

describe("handleBrainAskRoute — model routing", () => {
  it("explicit claude-* model returns no-chat-model (not Ollama fallthrough) when key is absent", async () => {
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevOllama = process.env.OLLAMA_HOST;
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    try {
      const res = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {
        question: "What is 2+2?",
        model: "claude-haiku-4-5-20251001",
      });
      expect(res.status).toBe(200);
      expect(res.json.available).toBe(false);
      expect(res.json.reason).toBe("no-chat-model");
      expect(res.json.hint).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
      if (prevOllama !== undefined) process.env.OLLAMA_HOST = prevOllama;
      else Reflect.deleteProperty(process.env, "OLLAMA_HOST");
    }
  });

  it("explicit Ollama model skips cloud cascade (400 vs 200 distinguishes the two paths)", async () => {
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevOpenAi = process.env.OPENAI_API_KEY;
    const prevOllama = process.env.OLLAMA_HOST;
    // No cloud keys + no vault + unreachable Ollama: auto cascade → 400 "No AI provider"
    //                                                explicit Ollama → 200 "no-chat-model"
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    try {
      const autoRes = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {
        question: "hello",
      });
      expect(autoRes.status).toBe(400);
      expect(autoRes.json.error).toBe("No AI provider could answer.");

      const explicitRes = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {
        question: "hello",
        model: "qwen3.6:latest",
      });
      expect(explicitRes.status).toBe(200);
      expect(explicitRes.json.reason).toBe("no-chat-model");
    } finally {
      if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
      if (prevOpenAi !== undefined) process.env.OPENAI_API_KEY = prevOpenAi;
      if (prevOllama !== undefined) process.env.OLLAMA_HOST = prevOllama;
      else Reflect.deleteProperty(process.env, "OLLAMA_HOST");
      process.env.OBSIDIAN_VAULT_PATH = vault;
    }
  });
});

describe("handleBrainAskRoute — agentic path", () => {
  let vault: string;
  let prevAnthropic: string | undefined;
  let prevOpenAi: string | undefined;
  let prevOllama: string | undefined;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "jarvis-agentic-"));
    process.env.OBSIDIAN_VAULT_PATH = vault;
    prevAnthropic = process.env.ANTHROPIC_API_KEY;
    prevOpenAi = process.env.OPENAI_API_KEY;
    prevOllama = process.env.OLLAMA_HOST;
    // Remove cloud keys so they don't interfere; point Ollama at an unreachable
    // address so the Ollama path fails fast instead of waiting 30 s.
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    // Reset mock call counts between tests
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
    Reflect.deleteProperty(process.env, "OBSIDIAN_VAULT_PATH");
    if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
    else Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    if (prevOpenAi !== undefined) process.env.OPENAI_API_KEY = prevOpenAi;
    else Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    if (prevOllama !== undefined) process.env.OLLAMA_HOST = prevOllama;
    else Reflect.deleteProperty(process.env, "OLLAMA_HOST");
  });

  it("routes an agentic question to agenticAsk and returns via in response", async () => {
    const { agenticAsk } = await import("../src/createApiServer/agenticAsk");
    vi.mocked(agenticAsk).mockResolvedValue({
      ok: true,
      answer: "Your Local Falcon rank is #2.",
      via: "Local Falcon",
    });

    const res = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {
      question: "what is my ranking for plumber near Tampa",
    });

    expect(res.status).toBe(200);
    expect(res.json.available).toBe(true);
    expect(res.json.answer).toBe("Your Local Falcon rank is #2.");
    expect(res.json.via).toBe("Local Falcon");
    expect(vi.mocked(agenticAsk)).toHaveBeenCalledOnce();
  });

  it("returns agentic-failed when agenticAsk fails", async () => {
    const { agenticAsk } = await import("../src/createApiServer/agenticAsk");
    vi.mocked(agenticAsk).mockResolvedValue({
      ok: false,
      reason: "claude-error",
      hint: "Agentic lookup returned no answer.",
    });

    const res = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {
      question: "what is my local SEO ranking",
    });

    expect(res.status).toBe(200);
    expect(res.json.available).toBe(false);
    expect(res.json.reason).toBe("agentic-failed");
    expect(typeof res.json.hint).toBe("string");
  });

  it("returns agentic-skipped when an explicit Ollama model is chosen for a live-data question", async () => {
    const { agenticAsk } = await import("../src/createApiServer/agenticAsk");

    // question would normally classify as agentic (has "ranking")
    const res = await call(handleBrainAskRoute, "POST", "/api/brain/ask", {
      question: "what is my ranking for plumber",
      model: "qwen3.6:latest",
    });

    // agenticAsk must NOT be called — H-1: warn instead of silently falling through to Ollama
    expect(vi.mocked(agenticAsk)).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.json.available).toBe(false);
    expect(res.json.reason).toBe("agentic-skipped");
    expect(typeof res.json.hint).toBe("string");
  });
});

describe("parseConversationMarkdown", () => {
  it("extracts You/Jarvis pairs and skips the header block", () => {
    const turns = parseConversationMarkdown(
      "# Jarvis Conversations\n\nintro text\n\n" +
        "## 14:02\n\n**You:** hello there\n\n**Jarvis:** Hi Nick, how can I help?\n\n",
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual({
      time: "14:02",
      question: "hello there",
      answer: "Hi Nick, how can I help?",
    });
  });

  it("keeps multi-line answers intact", () => {
    const turns = parseConversationMarkdown(
      "## 10:00\n\n**You:** summarize\n\n**Jarvis:** Line one.\nLine two.\n\n",
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.answer).toBe("Line one.\nLine two.");
  });

  it("returns nothing for content without turns", () => {
    expect(parseConversationMarkdown("# Just a header\n\nno turns here")).toEqual([]);
  });
});
