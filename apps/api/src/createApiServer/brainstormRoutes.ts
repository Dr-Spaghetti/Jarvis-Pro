import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { resolveVaultDir } from "./brainRoutes";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const IDEAS_DIR = "Ideas";

type Idea = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created: string;
};

const parseFrontmatter = (content: string): { tags: string[]; created: string; body: string } => {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) return { tags: [], created: new Date(0).toISOString(), body: content };
  const fm = match[1] ?? "";
  const body = match[2] ?? "";
  const tagsMatch = /^tags:\s*\[([^\]]*)\]/m.exec(fm);
  const tags = tagsMatch
    ? (tagsMatch[1] ?? "")
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
    : [];
  const createdMatch = /^created:\s*(.+)$/m.exec(fm);
  const created = createdMatch ? (createdMatch[1] ?? "").trim() : new Date(0).toISOString();
  return { tags, created, body: body.trim() };
};

const formatFrontmatter = (tags: string[], created: string): string => {
  const tagStr = tags.map((t) => `"${t}"`).join(", ");
  return `---\ntags: [${tagStr}]\ncreated: ${created}\n---\n`;
};

const safeIdeaPath = (vaultDir: string, id: string): string | null => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const target = resolve(join(vaultDir, IDEAS_DIR, `${id}.md`));
  const root = resolve(vaultDir);
  if (!target.startsWith(root + sep)) return null;
  return target;
};

const listIdeas = (vaultDir: string): Idea[] => {
  const dir = join(vaultDir, IDEAS_DIR);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir) as string[];
  } catch {
    return [];
  }
  const ideas: Idea[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const id = basename(entry, ".md");
    const filePath = join(dir, entry);
    try {
      const content = readFileSync(filePath, "utf8");
      const { tags, created, body } = parseFrontmatter(content);
      const titleMatch = /^#\s+(.+)$/m.exec(body);
      const title = titleMatch ? (titleMatch[1] ?? "").trim() : id;
      ideas.push({ id, title, body, tags, created });
    } catch {
      // skip unreadable files
    }
  }
  return ideas.sort((a, b) => b.created.localeCompare(a.created));
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const callClaudeExpand = async (ideaText: string): Promise<string | null> => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system:
          "You are Jarvis, Nick's creative AI assistant. Expand the given idea into a detailed, thoughtful exploration. Write in flowing paragraphs — no bullet lists or headers. Be creative, concrete, and concise.",
        messages: [{ role: "user", content: ideaText }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const block = data.content?.find((b) => b.type === "text");
    return typeof block?.text === "string" ? block.text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const handleBrainstormIdeasRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brainstorm/ideas") return false;

  const vaultDir = resolveVaultDir();

  if (request.method === "GET") {
    if (!vaultDir) {
      writeJson(response, 200, { configured: false, ideas: [] }, corsOrigin);
      return true;
    }
    writeJson(response, 200, { configured: true, ideas: listIdeas(vaultDir) }, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    if (!vaultDir) {
      writeJson(
        response,
        400,
        { error: "No vault configured (set OBSIDIAN_VAULT_PATH)." },
        corsOrigin,
      );
      return true;
    }

    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);

    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const bodyText = typeof payload.body === "string" ? payload.body.trim() : "";
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((t): t is string => typeof t === "string")
      : [];

    if (!title) {
      writeJson(response, 400, { error: "title (non-empty string) is required" }, corsOrigin);
      return true;
    }

    const created = new Date().toISOString();
    const id = `idea-${Date.now()}`;
    const ideasDir = join(vaultDir, IDEAS_DIR);
    if (!existsSync(ideasDir)) mkdirSync(ideasDir, { recursive: true });

    const fm = formatFrontmatter(tags, created);
    const content = `${fm}\n# ${title}\n\n${bodyText}`;

    try {
      writeFileSync(join(ideasDir, `${id}.md`), content, "utf8");
      writeJson(
        response,
        201,
        { ok: true, idea: { id, title, body: bodyText, tags, created } },
        corsOrigin,
      );
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "write failed" },
        corsOrigin,
      );
    }
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

export const handleBrainstormIdeaItemRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  const match = /^\/api\/brainstorm\/ideas\/([^/]+)$/.exec(requestUrl.pathname);
  if (!match) return false;
  const id = match[1] ?? "";

  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(
      response,
      400,
      { error: "No vault configured (set OBSIDIAN_VAULT_PATH)." },
      corsOrigin,
    );
    return true;
  }

  const filePath = safeIdeaPath(vaultDir, id);
  if (!filePath) {
    writeJson(response, 400, { error: "Invalid idea ID." }, corsOrigin);
    return true;
  }

  if (request.method === "PUT") {
    if (!existsSync(filePath)) {
      writeJson(response, 404, { error: "Idea not found." }, corsOrigin);
      return true;
    }

    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);

    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const bodyText = typeof payload.body === "string" ? payload.body.trim() : "";
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((t): t is string => typeof t === "string")
      : [];

    if (!title) {
      writeJson(response, 400, { error: "title (non-empty string) is required" }, corsOrigin);
      return true;
    }

    const existing = readFileSync(filePath, "utf8");
    const { created } = parseFrontmatter(existing);
    const fm = formatFrontmatter(tags, created);
    const content = `${fm}\n# ${title}\n\n${bodyText}`;

    try {
      writeFileSync(filePath, content, "utf8");
      writeJson(
        response,
        200,
        { ok: true, idea: { id, title, body: bodyText, tags, created } },
        corsOrigin,
      );
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "write failed" },
        corsOrigin,
      );
    }
    return true;
  }

  if (request.method === "DELETE") {
    if (!existsSync(filePath)) {
      writeJson(response, 404, { error: "Idea not found." }, corsOrigin);
      return true;
    }
    try {
      rmSync(filePath);
      writeJson(response, 200, { ok: true }, corsOrigin);
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "delete failed" },
        corsOrigin,
      );
    }
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

export const handleBrainstormExpandRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  const match = /^\/api\/brainstorm\/ideas\/([^/]+)\/expand$/.exec(requestUrl.pathname);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const id = match[1] ?? "";
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(
      response,
      400,
      { error: "No vault configured (set OBSIDIAN_VAULT_PATH)." },
      corsOrigin,
    );
    return true;
  }

  const filePath = safeIdeaPath(vaultDir, id);
  if (!filePath || !existsSync(filePath)) {
    writeJson(response, 404, { error: "Idea not found." }, corsOrigin);
    return true;
  }

  const existing = readFileSync(filePath, "utf8");
  const { tags, created, body } = parseFrontmatter(existing);
  const titleMatch = /^#\s+(.+)$/m.exec(body);
  const title = titleMatch ? (titleMatch[1] ?? "").trim() : id;

  const elaboration = await callClaudeExpand(`Title: ${title}\n\n${body}`);
  if (!elaboration) {
    writeJson(
      response,
      503,
      { error: "AI expansion failed — check ANTHROPIC_API_KEY in .env." },
      corsOrigin,
    );
    return true;
  }

  const newBody = `${body}\n\n## AI Expansion\n\n${elaboration}`;
  const fm = formatFrontmatter(tags, created);
  const newContent = `${fm}\n# ${title}\n\n${newBody}`;

  try {
    writeFileSync(filePath, newContent, "utf8");
    writeJson(
      response,
      200,
      { ok: true, idea: { id, title, body: newBody, tags, created } },
      corsOrigin,
    );
  } catch (error) {
    writeJson(
      response,
      500,
      { error: error instanceof Error ? error.message : "expand write failed" },
      corsOrigin,
    );
  }
  return true;
};
