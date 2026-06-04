import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

// Read-only (plus quick-capture) access to the user's Obsidian vault for the
// Jarvis home screen. Purely additive: a new "/api/brain" prefix that touches no
// existing route. The vault path comes from OBSIDIAN_VAULT_PATH (loaded at startup
// by loadEnvFile). Everything degrades to empty/404 when no vault is configured.

const MAX_FILES_SCANNED = 2000;

type BrainNote = { title: string; path: string; modified: string; snippet: string };

const resolveVaultDir = (): string | null => {
  const dir = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!dir || !existsSync(dir)) return null;
  return dir;
};

const isIgnored = (relPath: string): boolean => {
  const parts = relPath.split(/[\\/]/);
  return parts.some(
    (p) => p === ".obsidian" || p === ".git" || p === "node_modules" || p === ".trash",
  );
};

const listMarkdownFiles = (vaultDir: string): string[] => {
  let entries: string[] = [];
  try {
    entries = readdirSync(vaultDir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const rel = String(entry);
    if (!rel.toLowerCase().endsWith(".md")) continue;
    if (isIgnored(rel)) continue;
    files.push(rel);
    if (files.length >= MAX_FILES_SCANNED) break;
  }
  return files;
};

const stripFrontmatter = (content: string): string => content.replace(/^---\n[\s\S]*?\n---\n?/, "");

const deriveTitle = (content: string, relPath: string): string => {
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) return h1;
  return basename(relPath, ".md");
};

const buildSnippet = (body: string, around?: string): string => {
  const text = body
    .replace(/^#+\s+/gm, "")
    .replace(/[*_>`#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (around) {
    const idx = text.toLowerCase().indexOf(around.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      return `${start > 0 ? "…" : ""}${text.slice(start, start + 180)}…`;
    }
  }
  return text.slice(0, 180);
};

const toPosix = (p: string): string => p.split(sep).join("/");

const readNote = (
  vaultDir: string,
  relPath: string,
): { content: string; modified: string } | null => {
  const target = resolve(vaultDir, relPath);
  const root = resolve(vaultDir);
  if (target !== root && !target.startsWith(root + sep)) return null; // traversal guard
  if (!target.toLowerCase().endsWith(".md") || !existsSync(target)) return null;
  try {
    return {
      content: readFileSync(target, "utf8"),
      modified: statSync(target).mtime.toISOString(),
    };
  } catch {
    return null;
  }
};

// ── Journal (observability) + memory (persistent context) ──────────────────
// Both are vault-backed markdown so skills (via Obsidian MCP / OBSIDIAN_VAULT_PATH)
// and the web UI share one source of truth, with no extra infrastructure.

const JOURNAL_PATH = "Journal/Activity Log.md";
const JOURNAL_HEADER =
  "# Jarvis Activity Log\n\nAppend-only record of what Jarvis did and whether it worked.\n\n";
const MEMORY_PATH = "Jarvis/Memory.md";
const MEMORY_HEADER =
  '# Jarvis Memory\n\nLong-lived context Jarvis should remember about Nick and his work.\nSkills read this for context; the web "remember" action appends here.\n\n## Facts\n\n';

type JournalStatus = "ok" | "warn" | "error";
const JOURNAL_STATUSES: readonly JournalStatus[] = ["ok", "warn", "error"];
const isJournalStatus = (value: unknown): value is JournalStatus =>
  typeof value === "string" && (JOURNAL_STATUSES as readonly string[]).includes(value);

type JournalEntry = {
  ts: string;
  status: JournalStatus;
  skill: string | null;
  action: string;
  detail: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const oneLine = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

const ensureAndAppend = (
  vaultDir: string,
  relPath: string,
  header: string,
  line: string,
): string => {
  const target = join(vaultDir, relPath);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(target)) appendFileSync(target, header, "utf8");
  appendFileSync(target, line, "utf8");
  return toPosix(relPath);
};

const formatJournalLine = (entry: JournalEntry): string => {
  const skill = entry.skill ? ` (${entry.skill})` : "";
  const detail = entry.detail ? ` — ${entry.detail}` : "";
  return `- [${entry.ts}] [${entry.status}]${skill} ${entry.action}${detail}\n`;
};

const JOURNAL_LINE = /^- \[([^\]]+)\] \[(ok|warn|error)\](?: \(([^)]+)\))? (.+)$/;
const parseJournalLine = (line: string): JournalEntry | null => {
  const match = JOURNAL_LINE.exec(line);
  if (!match) return null;
  const ts = match[1] ?? "";
  const status = match[2] ?? "ok";
  const skill = match[3] ?? null;
  const rest = match[4] ?? "";
  const splitIdx = rest.indexOf(" — ");
  const action = splitIdx >= 0 ? rest.slice(0, splitIdx) : rest;
  const detail = splitIdx >= 0 ? rest.slice(splitIdx + 3) : null;
  return {
    ts,
    status: isJournalStatus(status) ? status : "ok",
    skill,
    action: action.trim(),
    detail: detail ? detail.trim() : null,
  };
};

export const handleBrainJournalRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/journal") return false;
  const vaultDir = resolveVaultDir();

  if (request.method === "GET") {
    if (!vaultDir) {
      writeJson(response, 200, { configured: false, entries: [] }, corsOrigin);
      return true;
    }
    const limit = Math.min(200, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 20));
    const file = join(vaultDir, JOURNAL_PATH);
    const entries: JournalEntry[] = [];
    if (existsSync(file)) {
      try {
        for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
          const entry = parseJournalLine(line);
          if (entry) entries.push(entry);
        }
      } catch {
        // unreadable journal → empty
      }
    }
    writeJson(
      response,
      200,
      { configured: true, entries: entries.reverse().slice(0, limit) },
      corsOrigin,
    );
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
    const action = typeof payload.action === "string" ? oneLine(payload.action) : "";
    if (action.length === 0) {
      writeJson(response, 400, { error: "action (non-empty string) is required" }, corsOrigin);
      return true;
    }
    const entry: JournalEntry = {
      ts: new Date().toISOString(),
      status: isJournalStatus(payload.status) ? payload.status : "ok",
      skill:
        typeof payload.skill === "string" && payload.skill.trim() ? oneLine(payload.skill) : null,
      action,
      detail:
        typeof payload.detail === "string" && payload.detail.trim()
          ? oneLine(payload.detail)
          : null,
    };
    try {
      const path = ensureAndAppend(
        vaultDir,
        JOURNAL_PATH,
        JOURNAL_HEADER,
        formatJournalLine(entry),
      );
      writeJson(response, 201, { ok: true, path, entry }, corsOrigin);
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "journal append failed" },
        corsOrigin,
      );
    }
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

export const handleBrainMemoryRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/memory") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(response, 200, { configured: false, content: "", items: [] }, corsOrigin);
    return true;
  }
  const file = join(vaultDir, MEMORY_PATH);
  if (!existsSync(file)) {
    writeJson(response, 200, { configured: true, content: "", items: [] }, corsOrigin);
    return true;
  }
  try {
    const content = readFileSync(file, "utf8");
    const items = content
      .split(/\r?\n/)
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((line) => line.length > 0);
    writeJson(response, 200, { configured: true, content, items }, corsOrigin);
  } catch {
    writeJson(response, 200, { configured: true, content: "", items: [] }, corsOrigin);
  }
  return true;
};

export const handleBrainRememberRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/remember") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
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
  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = asRecord(body.payload);
  const text = typeof payload.text === "string" ? oneLine(payload.text) : "";
  if (text.length === 0) {
    writeJson(response, 400, { error: "text (non-empty string) is required" }, corsOrigin);
    return true;
  }
  try {
    const path = ensureAndAppend(vaultDir, MEMORY_PATH, MEMORY_HEADER, `- ${text}\n`);
    writeJson(response, 201, { ok: true, path }, corsOrigin);
  } catch (error) {
    writeJson(
      response,
      500,
      { error: error instanceof Error ? error.message : "remember failed" },
      corsOrigin,
    );
  }
  return true;
};

export const handleBrainRecentRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/recent") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(response, 200, { configured: false, notes: [] }, corsOrigin);
    return true;
  }
  const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 12));
  const scored: Array<{ mtime: number; note: BrainNote }> = [];
  for (const rel of listMarkdownFiles(vaultDir)) {
    const full = join(vaultDir, rel);
    try {
      const mtime = statSync(full).mtimeMs;
      const content = readFileSync(full, "utf8");
      const body = stripFrontmatter(content);
      scored.push({
        mtime,
        note: {
          title: deriveTitle(content, rel),
          path: toPosix(rel),
          modified: new Date(mtime).toISOString(),
          snippet: buildSnippet(body),
        },
      });
    } catch {
      // skip unreadable
    }
  }
  scored.sort((a, b) => b.mtime - a.mtime);
  writeJson(
    response,
    200,
    { configured: true, notes: scored.slice(0, limit).map((s) => s.note) },
    corsOrigin,
  );
  return true;
};

export const handleBrainSearchRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/search") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const q = (requestUrl.searchParams.get("q") ?? "").trim();
  const vaultDir = resolveVaultDir();
  if (!vaultDir || q.length === 0) {
    writeJson(response, 200, { configured: Boolean(vaultDir), query: q, notes: [] }, corsOrigin);
    return true;
  }
  const needle = q.toLowerCase();
  const results: Array<{ score: number; mtime: number; note: BrainNote }> = [];
  for (const rel of listMarkdownFiles(vaultDir)) {
    const full = join(vaultDir, rel);
    try {
      const content = readFileSync(full, "utf8");
      const lower = content.toLowerCase();
      const inName = rel.toLowerCase().includes(needle);
      const occurrences = lower.split(needle).length - 1;
      if (!inName && occurrences === 0) continue;
      const score = (inName ? 10 : 0) + Math.min(occurrences, 5);
      const body = stripFrontmatter(content);
      results.push({
        score,
        mtime: statSync(full).mtimeMs,
        note: {
          title: deriveTitle(content, rel),
          path: toPosix(rel),
          modified: new Date(statSync(full).mtimeMs).toISOString(),
          snippet: buildSnippet(body, q),
        },
      });
    } catch {
      // skip
    }
  }
  results.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  writeJson(
    response,
    200,
    { configured: true, query: q, notes: results.slice(0, 20).map((r) => r.note) },
    corsOrigin,
  );
  return true;
};

export const handleBrainNoteRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/note") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const vaultDir = resolveVaultDir();
  const relPath = requestUrl.searchParams.get("path") ?? "";
  if (!vaultDir || relPath.length === 0) {
    writeJson(response, 404, { error: "Note not found" }, corsOrigin);
    return true;
  }
  const note = readNote(vaultDir, relPath);
  if (!note) {
    writeJson(response, 404, { error: "Note not found" }, corsOrigin);
    return true;
  }
  writeJson(
    response,
    200,
    { path: toPosix(relPath), title: deriveTitle(note.content, relPath), ...note },
    corsOrigin,
  );
  return true;
};

export const handleBrainCaptureRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/capture") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
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
  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const text = ((body.payload as { text?: unknown } | null)?.text ?? "").toString().trim();
  if (text.length === 0) {
    writeJson(response, 400, { error: "text (non-empty string) is required" }, corsOrigin);
    return true;
  }
  try {
    const inboxDir = join(vaultDir, "Inbox");
    if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });
    const file = join(inboxDir, "Quick Capture.md");
    if (!existsSync(file)) {
      appendFileSync(file, "# Quick Capture\n\n", "utf8");
    }
    appendFileSync(file, `- ${text}\n`, "utf8");
    writeJson(response, 201, { ok: true, path: "Inbox/Quick Capture.md" }, corsOrigin);
  } catch (error) {
    writeJson(
      response,
      500,
      { error: error instanceof Error ? error.message : "capture failed" },
      corsOrigin,
    );
  }
  return true;
};
