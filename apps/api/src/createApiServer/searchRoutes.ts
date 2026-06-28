import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { resolveVaultDir } from "./brainRoutes";
import type { ApiRouteHandler, TerminalRuntime } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed } from "./routeHelpers";

type SearchResult = {
  type: "workflow" | "idea" | "conversation";
  id: string;
  title: string;
  snippet: string;
  navTarget: number;
};

const matchesQuery = (q: string, ...fields: (string | null | undefined)[]): boolean => {
  const lower = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(lower));
};

const buildSnippet = (text: string, q: string, maxLen = 120): string => {
  if (!text) return "";
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const slice = text.slice(start, start + maxLen);
  return (start > 0 ? "…" : "") + slice;
};

// --- Workflows ---------------------------------------------------------------

type Workflow = { id: string; name: string; description: string; steps: string };

const searchWorkflows = (projectStateDir: string, q: string): SearchResult[] => {
  const dir = join(projectStateDir, "state", "workflows");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir) as string[];
  } catch {
    return [];
  }
  const results: SearchResult[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, entry), "utf8")) as Workflow;
      if (!parsed.id || !parsed.name) continue;
      if (!matchesQuery(q, parsed.name, parsed.description, parsed.steps)) continue;
      results.push({
        type: "workflow",
        id: parsed.id,
        title: parsed.name,
        snippet: buildSnippet(parsed.description || parsed.steps || "", q),
        navTarget: 3,
      });
    } catch {
      /* skip malformed files */
    }
  }
  return results;
};

// --- Ideas -------------------------------------------------------------------

const readIdeaFrontmatter = (content: string): { tags: string[]; body: string } => {
  const body = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(content)?.[1]?.trim() ?? content;
  const tagsMatch = /^tags:\s*\[([^\]]*)\]/m.exec(content);
  const tags = tagsMatch
    ? (tagsMatch[1] ?? "")
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
    : [];
  return { tags, body };
};

const searchIdeas = (q: string): SearchResult[] => {
  const vaultDir = resolveVaultDir();
  if (!vaultDir) return [];
  const dir = join(vaultDir, "Ideas");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir) as string[];
  } catch {
    return [];
  }
  const results: SearchResult[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const id = basename(entry, ".md");
    try {
      const content = readFileSync(join(dir, entry), "utf8");
      const { body, tags } = readIdeaFrontmatter(content);
      const titleMatch = /^#\s+(.+)$/m.exec(body);
      const title = titleMatch ? (titleMatch[1] ?? "").trim() || id : id;
      if (!matchesQuery(q, title, body, tags.join(" "))) continue;
      const bodyWithoutTitle = body.replace(/^#[^\n]*\n?/, "").trim();
      results.push({
        type: "idea",
        id,
        title,
        snippet: buildSnippet(bodyWithoutTitle, q),
        navTarget: 6,
      });
    } catch {
      /* skip unreadable files */
    }
  }
  return results;
};

// --- Conversations -----------------------------------------------------------

const searchConversationSessions = (runtime: TerminalRuntime, q: string): SearchResult[] => {
  const result = runtime.searchConversations(q);
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const hit of result.hits) {
    if (seen.has(hit.sessionId)) continue;
    seen.add(hit.sessionId);
    results.push({
      type: "conversation",
      id: hit.sessionId,
      title: `Session ${hit.sessionId.slice(0, 12)}`,
      snippet: hit.snippet.slice(0, 120),
      navTarget: 4,
    });
  }
  return results;
};

// --- Handler -----------------------------------------------------------------

const MAX_PER_TYPE = 5;

export const handleSearchRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir, runtime },
) => {
  if (requestUrl.pathname !== "/api/search") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const q = requestUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    writeJson(response, 200, { results: [], query: q }, corsOrigin);
    return true;
  }

  const workflows = searchWorkflows(projectStateDir, q).slice(0, MAX_PER_TYPE);
  const ideas = searchIdeas(q).slice(0, MAX_PER_TYPE);
  const conversations = searchConversationSessions(runtime, q).slice(0, MAX_PER_TYPE);

  const results: SearchResult[] = [...workflows, ...ideas, ...conversations];
  writeJson(response, 200, { results, query: q }, corsOrigin);
  return true;
};
