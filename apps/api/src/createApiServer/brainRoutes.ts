import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { chatViaOllama, getChatModel, listOllamaChatModels } from "./ollamaChat";
import { cosineSimilarity, embedViaOllama } from "./ollamaEmbed";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

// Read-only (plus quick-capture) access to the user's Obsidian vault for the
// Jarvis home screen. Purely additive: a new "/api/brain" prefix that touches no
// existing route. The vault path comes from OBSIDIAN_VAULT_PATH (loaded at startup
// by loadEnvFile). Everything degrades to empty/404 when no vault is configured.

const MAX_FILES_SCANNED = 2000;

type BrainNote = { title: string; path: string; modified: string; snippet: string };

export const resolveVaultDir = (): string | null => {
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

// Multi-term lexical scoring: match each query word independently and reward
// notes that hit the title, path, headings, and more of the distinct terms.
const lexicalSearchNotes = (vaultDir: string, rawQuery: string, limit = 20): BrainNote[] => {
  const needle = rawQuery.toLowerCase();
  const terms = needle.split(/\s+/).filter((term) => term.length >= 2);
  const searchTerms = terms.length > 0 ? terms : [needle];
  const results: Array<{ score: number; mtime: number; note: BrainNote }> = [];
  for (const rel of listMarkdownFiles(vaultDir)) {
    const full = join(vaultDir, rel);
    try {
      const content = readFileSync(full, "utf8");
      const lower = content.toLowerCase();
      const title = deriveTitle(content, rel);
      const titleLower = title.toLowerCase();
      const pathLower = rel.toLowerCase();
      const headingsLower = (content.match(/^#{1,6}\s+.+$/gm) ?? []).join("\n").toLowerCase();

      let matchedTerms = 0;
      let score = 0;
      let firstHit: string | null = null;
      for (const term of searchTerms) {
        const occurrences = lower.split(term).length - 1;
        const inTitle = titleLower.includes(term);
        const inPath = pathLower.includes(term);
        const inHeading = headingsLower.includes(term);
        if (occurrences === 0 && !inTitle && !inPath) continue;
        matchedTerms += 1;
        if (!firstHit) firstHit = term;
        score +=
          (inTitle ? 12 : 0) + (inPath ? 6 : 0) + (inHeading ? 4 : 0) + Math.min(occurrences, 5);
      }
      if (matchedTerms === 0) continue;
      score *= matchedTerms; // notes matching more distinct terms rank higher
      const mtime = statSync(full).mtimeMs;
      results.push({
        score,
        mtime,
        note: {
          title,
          path: toPosix(rel),
          modified: new Date(mtime).toISOString(),
          snippet: buildSnippet(stripFrontmatter(content), firstHit ?? rawQuery),
        },
      });
    } catch {
      // skip
    }
  }
  results.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return results.slice(0, limit).map((r) => r.note);
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
  writeJson(
    response,
    200,
    { configured: true, query: q, notes: lexicalSearchNotes(vaultDir, q, 20) },
    corsOrigin,
  );
  return true;
};

// ── Semantic search via local Ollama embeddings (free; falls back to lexical) ──
const SEMANTIC_INDEX_FILE = ".jarvis-brain-index.json";
const MAX_EMBED_PER_REQUEST = 60;
type SemanticIndexEntry = { mtime: number; vector: number[] };
type SemanticIndex = Record<string, SemanticIndexEntry>;

const loadSemanticIndex = (vaultDir: string): SemanticIndex => {
  try {
    const parsed = JSON.parse(readFileSync(join(vaultDir, SEMANTIC_INDEX_FILE), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as SemanticIndex) : {};
  } catch {
    return {};
  }
};

const saveSemanticIndex = (vaultDir: string, index: SemanticIndex): void => {
  try {
    writeFileSync(join(vaultDir, SEMANTIC_INDEX_FILE), JSON.stringify(index), "utf8");
  } catch {
    // best-effort cache; ignore write failures
  }
};

const embedTextFor = (content: string, rel: string): string =>
  `${deriveTitle(content, rel)}\n\n${stripFrontmatter(content).slice(0, 800)}`;

export const handleBrainSemanticRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/semantic") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const q = (requestUrl.searchParams.get("q") ?? "").trim();
  const vaultDir = resolveVaultDir();
  if (!vaultDir || q.length === 0) {
    writeJson(
      response,
      200,
      { configured: Boolean(vaultDir), semantic: false, query: q, notes: [] },
      corsOrigin,
    );
    return true;
  }

  const queryVector = await embedViaOllama(q);
  if (!queryVector) {
    // Ollama not running or model not pulled → transparent lexical fallback.
    writeJson(
      response,
      200,
      { configured: true, semantic: false, query: q, notes: lexicalSearchNotes(vaultDir, q, 20) },
      corsOrigin,
    );
    return true;
  }

  const index = loadSemanticIndex(vaultDir);
  const present = new Set<string>();
  let embedded = 0;
  let changed = false;
  for (const rel of listMarkdownFiles(vaultDir)) {
    const relPosix = toPosix(rel);
    present.add(relPosix);
    try {
      const mtime = statSync(join(vaultDir, rel)).mtimeMs;
      const existing = index[relPosix];
      if ((!existing || existing.mtime !== mtime) && embedded < MAX_EMBED_PER_REQUEST) {
        const content = readFileSync(join(vaultDir, rel), "utf8");
        const vector = await embedViaOllama(embedTextFor(content, rel));
        if (vector) {
          index[relPosix] = { mtime, vector };
          embedded += 1;
          changed = true;
        }
      }
    } catch {
      // skip unreadable
    }
  }
  for (const key of Object.keys(index)) {
    if (!present.has(key)) {
      Reflect.deleteProperty(index, key);
      changed = true;
    }
  }
  if (changed) saveSemanticIndex(vaultDir, index);

  const ranked = Object.entries(index)
    .map(([rel, entry]) => ({ rel, score: cosineSimilarity(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const notes: BrainNote[] = [];
  for (const { rel } of ranked) {
    try {
      const full = join(vaultDir, rel);
      const content = readFileSync(full, "utf8");
      notes.push({
        title: deriveTitle(content, rel),
        path: rel,
        modified: new Date(statSync(full).mtimeMs).toISOString(),
        snippet: buildSnippet(stripFrontmatter(content)),
      });
    } catch {
      // skip files removed mid-request
    }
  }
  writeJson(
    response,
    200,
    { configured: true, semantic: true, query: q, indexed: Object.keys(index).length, notes },
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

// Deterministic, agent-free "today" snapshot assembled purely from the vault —
// no model call, no spawned agent. Lets the home show an instant brief cheaply.
export const localDateStamp = (): string => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

const OPEN_TASK = /^\s*[-*]\s+\[ \]\s+(.+?)\s*$/;
const MAX_DIGEST_TASKS = 30;

export type BrainDigest = {
  configured: boolean;
  date: string;
  dailyNote: { exists: boolean; path: string | null };
  recentNotes: BrainNote[];
  tasks: { open: string[]; openCount: number };
  journal: JournalEntry[];
  memory: { factCount: number };
};

// Deterministic digest computation, shared by the GET route and the morning
// brief scheduler. No network, no agent — pure filesystem read of the vault.
export const computeBrainDigest = (): BrainDigest => {
  const date = localDateStamp();
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    return {
      configured: false,
      date,
      dailyNote: { exists: false, path: null },
      recentNotes: [],
      tasks: { open: [], openCount: 0 },
      journal: [],
      memory: { factCount: 0 },
    };
  }

  const dailyRel = `Daily/${date}.md`;
  const dailyExists = existsSync(join(vaultDir, dailyRel));

  // Single pass over markdown: collect recent notes + open tasks
  // (skip the Journal/ and Jarvis/ system files so they don't pollute tasks).
  const scored: Array<{ mtime: number; note: BrainNote }> = [];
  const openTasks: string[] = [];
  for (const rel of listMarkdownFiles(vaultDir)) {
    const relPosix = toPosix(rel);
    try {
      const mtime = statSync(join(vaultDir, rel)).mtimeMs;
      const content = readFileSync(join(vaultDir, rel), "utf8");
      scored.push({
        mtime,
        note: {
          title: deriveTitle(content, rel),
          path: relPosix,
          modified: new Date(mtime).toISOString(),
          snippet: buildSnippet(stripFrontmatter(content)),
        },
      });
      if (!relPosix.startsWith("Journal/") && !relPosix.startsWith("Jarvis/")) {
        for (const line of content.split(/\r?\n/)) {
          if (openTasks.length >= MAX_DIGEST_TASKS) break;
          const match = OPEN_TASK.exec(line);
          if (match?.[1]) openTasks.push(match[1].trim());
        }
      }
    } catch {
      // skip unreadable
    }
  }
  scored.sort((a, b) => b.mtime - a.mtime);

  const journal: JournalEntry[] = [];
  const journalFile = join(vaultDir, JOURNAL_PATH);
  if (existsSync(journalFile)) {
    try {
      for (const line of readFileSync(journalFile, "utf8").split(/\r?\n/)) {
        const entry = parseJournalLine(line);
        if (entry) journal.push(entry);
      }
    } catch {
      // ignore
    }
  }

  let factCount = 0;
  const memoryFile = join(vaultDir, MEMORY_PATH);
  if (existsSync(memoryFile)) {
    try {
      factCount = readFileSync(memoryFile, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trimStart().startsWith("- ")).length;
    } catch {
      // ignore
    }
  }

  return {
    configured: true,
    date,
    dailyNote: { exists: dailyExists, path: dailyExists ? dailyRel : null },
    recentNotes: scored.slice(0, 5).map((entry) => entry.note),
    tasks: { open: openTasks, openCount: openTasks.length },
    journal: journal.reverse().slice(0, 5),
    memory: { factCount },
  };
};

export type BrainTileStats =
  | { configured: false }
  | {
      configured: true;
      noteCount: number;
      openTaskCount: number;
      journalThisWeek: number;
    };

// Lightweight counts for the home tiles — a single bounded vault scan plus the
// journal file. Returns configured:false when no vault is set so the tile can
// honestly show "not configured" rather than a fake zero.
export const computeBrainTileStats = (now: number = Date.now()): BrainTileStats => {
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    return { configured: false };
  }

  let noteCount = 0;
  let openTaskCount = 0;
  for (const rel of listMarkdownFiles(vaultDir)) {
    noteCount += 1;
    const relPosix = toPosix(rel);
    if (relPosix.startsWith("Journal/") || relPosix.startsWith("Jarvis/")) {
      continue;
    }
    try {
      const content = readFileSync(join(vaultDir, rel), "utf8");
      for (const line of content.split(/\r?\n/)) {
        if (OPEN_TASK.test(line)) {
          openTaskCount += 1;
        }
      }
    } catch {
      // skip unreadable
    }
  }

  let journalThisWeek = 0;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const journalFile = join(vaultDir, JOURNAL_PATH);
  if (existsSync(journalFile)) {
    try {
      for (const line of readFileSync(journalFile, "utf8").split(/\r?\n/)) {
        const entry = parseJournalLine(line);
        if (entry) {
          const ts = Date.parse(entry.ts);
          if (!Number.isNaN(ts) && ts >= weekAgo) {
            journalThisWeek += 1;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return { configured: true, noteCount, openTaskCount, journalThisWeek };
};

export const handleBrainDigestRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/digest") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  writeJson(response, 200, computeBrainDigest(), corsOrigin);
  return true;
};

// ── Claude-powered ask (fast path, with optional web search) ────────────────

const getAnthropicApiKey = (): string | null => {
  const v = process.env.ANTHROPIC_API_KEY?.trim();
  return v && v.length > 0 ? v : null;
};

const getOpenAiApiKey = (): string | null => {
  const v = process.env.OPENAI_API_KEY?.trim();
  return v && v.length > 0 ? v : null;
};

// OpenAI's *-search-preview models web-search automatically on the standard
// chat endpoint, so live questions work with the key the user already has.
const getOpenAiChatModel = (): string =>
  process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini-search-preview";

const getBraveSearchApiKey = (): string | null => {
  const v = process.env.BRAVE_SEARCH_API_KEY?.trim();
  return v && v.length > 0 ? v : null;
};

const getTavilyApiKey = (): string | null => {
  const v = process.env.TAVILY_API_KEY?.trim();
  return v && v.length > 0 ? v : null;
};

const CLAUDE_VOICE_MODEL = "claude-haiku-4-5-20251001";

type WebSnippet = { title: string; url: string; snippet: string };

// Abort a provider call after `ms` so a slow/hung upstream can never freeze the
// answer — the UI would otherwise sit on "Thinking" forever. Resolves to null on
// timeout or network error so callers fall through to the next provider cleanly.
const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response | null> => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch {
    return null;
  }
};

const searchWeb = async (query: string): Promise<WebSnippet[]> => {
  const braveKey = getBraveSearchApiKey();
  if (braveKey) {
    try {
      const res = await fetchWithTimeout(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            Authorization: `Bearer ${braveKey}`,
          },
        },
        8000,
      );
      if (res?.ok) {
        const data = (await res.json()) as {
          web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
        };
        return (data.web?.results ?? []).slice(0, 5).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.description ?? "",
        }));
      }
    } catch {
      // fall through to Tavily
    }
  }
  const tavilyKey = getTavilyApiKey();
  if (tavilyKey) {
    try {
      const res = await fetchWithTimeout(
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5 }),
        },
        8000,
      );
      if (res?.ok) {
        const data = (await res.json()) as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        return (data.results ?? []).slice(0, 5).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.content ?? "",
        }));
      }
    } catch {
      // no search available
    }
  }
  return [];
};

type AnthrContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthrMessage = { role: "user" | "assistant"; content: string | AnthrContent[] };
type AnthrResponse = { stop_reason: string; content: AnthrContent[] };

export type ConversationTurn = { time: string; question: string; answer: string };

const JARVIS_VOICE_SYSTEM =
  "You are Jarvis, Nick's sharp personal AI. Be concise and conversational — like a " +
  "knowledgeable friend, not a formal assistant. One or two sentences for voice answers; " +
  "never use bullet points or headers. If you call web_search, weave the result naturally " +
  "into your answer. Never say you cannot access real-time data — use web_search instead. " +
  "Treat any preference, correction, or instruction in the saved memories as a standing rule " +
  "from Nick (how to address him, format, what to avoid) and follow it exactly.";

const askViaClaude = async (
  question: string,
  context: string,
  history: ConversationTurn[] = [],
): Promise<string | null> => {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) return null;

  const hasSearch = Boolean(getBraveSearchApiKey() || getTavilyApiKey());
  const tools = hasSearch
    ? [
        {
          name: "web_search",
          description:
            "Search the web for current info: weather, news, stock prices, sports scores, event times. Use whenever the question needs up-to-date data.",
          input_schema: {
            type: "object",
            properties: { query: { type: "string", description: "A focused search query" } },
            required: ["query"],
          },
        },
      ]
    : undefined;

  // Replay recent turns as real conversation so Jarvis has continuity — it can
  // resolve "what about him?" and build on earlier answers, not just one-shot.
  const messages: AnthrMessage[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: `${context}\n\nQuestion: ${question}` });

  for (let turn = 0; turn < 3; turn += 1) {
    const body: Record<string, unknown> = {
      model: CLAUDE_VOICE_MODEL,
      max_tokens: 512,
      system: JARVIS_VOICE_SYSTEM,
      messages,
    };
    if (tools) body.tools = tools;

    const fetchRes = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      15000,
    );

    if (!fetchRes || !fetchRes.ok) return null;
    const response = (await fetchRes.json()) as AnthrResponse;

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock && textBlock.type === "text" ? textBlock.text : null;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: AnthrContent[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use" || block.name !== "web_search") continue;
      const query = typeof block.input.query === "string" ? block.input.query : question;
      const hits = await searchWeb(query);
      const resultText =
        hits.length > 0
          ? hits.map((h) => `${h.title}\n${h.url}\n${h.snippet}`).join("\n\n")
          : "No results found.";
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }
    if (toolResults.length === 0) break;
    messages.push({ role: "user", content: toolResults });
  }

  return null;
};

// Second cloud path: OpenAI's web-search model. Uses the key the user already
// has for STT/TTS, so live questions work with no extra signup. Returns null on
// any failure (no key, bad params, network) so the caller falls through.
type OpenAiChatMessage = { role: "system" | "user" | "assistant"; content: string };

type OpenAiResult = { answer: string | null; error: string | null };

const askViaOpenAi = async (
  question: string,
  context: string,
  history: ConversationTurn[] = [],
): Promise<OpenAiResult> => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return { answer: null, error: null };

  const messages: OpenAiChatMessage[] = [{ role: "system", content: JARVIS_VOICE_SYSTEM }];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: `${context}\n\nQuestion: ${question}` });

  // Try the web-search model first (live data). If the account can't use it,
  // fall back to a standard model so general questions still answer. Minimal
  // body: search-preview models reject temperature/top_p.
  const primary = getOpenAiChatModel();
  const models = primary === "gpt-4o-mini" ? ["gpt-4o-mini"] : [primary, "gpt-4o-mini"];
  let firstError: string | null = null;

  for (const candidate of models) {
    const fetchRes = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: candidate, messages }),
      },
      25000,
    );
    if (!fetchRes) {
      firstError ??= `${candidate}: request timed out`;
      continue;
    }
    if (!fetchRes.ok) {
      const detail = (await fetchRes.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      const message = `${candidate}: ${fetchRes.status} ${detail}`.trim();
      firstError ??= message;
      console.warn(`[jarvis] OpenAI ask failed — ${message}`);
      continue;
    }
    const data = (await fetchRes.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return { answer: content.trim(), error: null };
    }
    firstError ??= `${candidate}: empty response`;
  }
  return { answer: null, error: firstError };
};

// ── Ask Jarvis: local RAG over the brain (free, via Ollama chat) ────────────
const readMemoryFacts = (vaultDir: string, limit: number): string[] => {
  const file = join(vaultDir, MEMORY_PATH);
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((line) => line.length > 0)
      .slice(0, limit);
  } catch {
    return [];
  }
};

// Read-only retrieval for context: semantic (using the existing index) when
// embeddings are available, else lexical. Does not rebuild the index.
const retrieveContext = async (
  vaultDir: string,
  query: string,
  limit: number,
): Promise<Array<{ rel: string; title: string; body: string }>> => {
  let paths: string[] = [];
  const queryVector = await embedViaOllama(query);
  if (queryVector) {
    const index = loadSemanticIndex(vaultDir);
    const entries = Object.entries(index);
    if (entries.length > 0) {
      paths = entries
        .map(([rel, entry]) => ({ rel, score: cosineSimilarity(queryVector, entry.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((ranked) => ranked.rel);
    }
  }
  if (paths.length === 0) {
    paths = lexicalSearchNotes(vaultDir, query, limit).map((note) => note.path);
  }
  const out: Array<{ rel: string; title: string; body: string }> = [];
  for (const rel of paths) {
    try {
      const content = readFileSync(join(vaultDir, rel), "utf8");
      out.push({
        rel,
        title: deriveTitle(content, rel),
        body: stripFrontmatter(content).slice(0, 1200),
      });
    } catch {
      // skip
    }
  }
  return out;
};

const ASK_SYSTEM_PROMPT =
  "You are Jarvis, Nick's personal AI assistant. Answer his QUESTION helpfully, " +
  "directly, and concisely — no fluff.\n" +
  "- For general questions (facts, how-tos, explanations, advice, casual chat), just " +
  "answer from your own knowledge like a capable assistant would.\n" +
  "- The MEMORY and CONTEXT below are Nick's own notes and saved facts. Use them when " +
  "they're relevant to the question, and when you rely on a note, cite its title in " +
  "brackets like [Note Title].\n" +
  "- IMPORTANT: if a MEMORY entry is a preference, correction, or instruction (e.g. " +
  "'always…', 'never…', 'I prefer…', 'call me…'), treat it as a standing rule from Nick " +
  "and follow it in every answer.\n" +
  "- Do NOT fabricate specifics about Nick, his clients, projects, numbers, or anything " +
  "personal. If he asks about his own information and it isn't in the MEMORY/CONTEXT, " +
  "say you don't have it noted yet and suggest he capture it.\n" +
  "Never refuse a general question just because it isn't in his notes.";

// ── Conversation transcript (Obsidian-stored, for review + continuity) ──────
// Every Q&A is appended to Jarvis/Conversations/<date>.md so the whole thread
// is reviewable in Obsidian ("what worked"), and recent turns are replayed into
// each prompt so Jarvis carries context forward instead of answering blind.
const CONVERSATION_DIR = "Jarvis/Conversations";
const CONVERSATION_HEADER =
  "# Jarvis Conversations\n\nRunning transcript of voice & text chats (newest at the bottom).\n" +
  "Jarvis replays recent turns for continuity — review here to see what works.\n\n";

const conversationRelPath = (): string => `${CONVERSATION_DIR}/${localDateStamp()}.md`;

// Pure parser (unit-tested): pulls You/Jarvis pairs out of a day's markdown log.
export const parseConversationMarkdown = (content: string): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  for (const block of content.split(/\n(?=## )/)) {
    const you = block.match(/\*\*You:\*\*\s*([\s\S]*?)\n\n\*\*Jarvis:\*\*/)?.[1];
    const jarvis = block.match(/\*\*Jarvis:\*\*\s*([\s\S]*)$/)?.[1];
    if (you === undefined || jarvis === undefined) continue;
    const time = block.match(/^##\s*(.+)$/m)?.[1]?.trim() ?? "";
    turns.push({ time, question: you.trim(), answer: jarvis.trim() });
  }
  return turns;
};

const readConversationTurns = (vaultDir: string, limit: number): ConversationTurn[] => {
  const file = join(vaultDir, conversationRelPath());
  if (!existsSync(file)) return [];
  try {
    return parseConversationMarkdown(readFileSync(file, "utf8")).slice(-limit);
  } catch {
    return [];
  }
};

const appendConversationTurn = (vaultDir: string, question: string, answer: string): void => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const block = `## ${hh}:${mm}\n\n**You:** ${oneLine(question)}\n\n**Jarvis:** ${answer.trim()}\n\n`;
  try {
    ensureAndAppend(vaultDir, conversationRelPath(), CONVERSATION_HEADER, block);
  } catch {
    // Best-effort logging; never block the answer if the vault write fails.
  }
};

export const handleBrainConversationRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/conversation") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(response, 200, { configured: false, turns: [] }, corsOrigin);
    return true;
  }
  const limit = Math.min(200, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 50));
  writeJson(
    response,
    200,
    { configured: true, date: localDateStamp(), turns: readConversationTurns(vaultDir, limit) },
    corsOrigin,
  );
  return true;
};

// Lists the local Ollama chat models the user can pick from, plus the default.
export const handleBrainModelsRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/models") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const models = await listOllamaChatModels();
  writeJson(response, 200, { models, default: getChatModel() }, corsOrigin);
  return true;
};

export const handleBrainAskRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/ask") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = asRecord(body.payload);
  const question = typeof payload.question === "string" ? oneLine(payload.question) : "";
  if (question.length === 0) {
    writeJson(response, 400, { error: "question (non-empty string) is required" }, corsOrigin);
    return true;
  }
  const model =
    typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : undefined;

  const vaultDir = resolveVaultDir();
  const notes = vaultDir ? await retrieveContext(vaultDir, question, 6) : [];
  const facts = vaultDir ? readMemoryFacts(vaultDir, 20) : [];
  const history = vaultDir ? readConversationTurns(vaultDir, 6) : [];
  const sources = notes.map((note) => ({ title: note.title, path: note.rel }));

  const memoryBlock = facts.length > 0 ? facts.map((f) => `- ${f}`).join("\n") : "(none)";
  const contextBlock =
    notes.length > 0
      ? notes.map((n) => `### ${n.title} (${n.rel})\n${n.body}`).join("\n\n")
      : "(no matching notes)";

  // Fast path 1: Claude Haiku with optional web search (preferred when keyed).
  const claudeContext = `My saved memories:\n${memoryBlock}\n\nRelevant vault notes:\n${contextBlock}`;
  const claudeAnswer = await askViaClaude(question, claudeContext, history);
  if (claudeAnswer) {
    if (vaultDir) appendConversationTurn(vaultDir, question, claudeAnswer);
    writeJson(response, 200, { available: true, answer: claudeAnswer, sources }, corsOrigin);
    return true;
  }

  // Fast path 2: OpenAI web-search model (uses the existing STT/TTS key).
  const openAi = await askViaOpenAi(question, claudeContext, history);
  if (openAi.answer) {
    if (vaultDir) appendConversationTurn(vaultDir, question, openAi.answer);
    writeJson(response, 200, { available: true, answer: openAi.answer, sources }, corsOrigin);
    return true;
  }
  // Surface the real OpenAI failure (status + message) so it's diagnosable
  // instead of silently blaming a missing Anthropic key.
  const providerNote = openAi.error ? ` (OpenAI: ${openAi.error})` : "";

  // Slow path: local Ollama (requires vault).
  if (!vaultDir) {
    writeJson(
      response,
      400,
      {
        available: false,
        error: "No AI provider could answer.",
        hint: `Your OpenAI key couldn't answer${providerNote}. Enable a web-search model on your OpenAI account, add an Anthropic key, or set OBSIDIAN_VAULT_PATH + run Ollama.`,
      },
      corsOrigin,
    );
    return true;
  }

  const historyBlock =
    history.length > 0
      ? history.map((t) => `You: ${t.question}\nJarvis: ${t.answer}`).join("\n\n")
      : "(none)";
  const prompt = `RECENT CONVERSATION:\n${historyBlock}\n\nMEMORY:\n${memoryBlock}\n\nCONTEXT:\n${contextBlock}\n\nQUESTION: ${question}`;
  const answer = await chatViaOllama(prompt, {
    system: ASK_SYSTEM_PROMPT,
    // Cap the local model so a slow CPU generation can't hang the answer.
    signal: AbortSignal.timeout(30000),
    ...(model ? { model } : {}),
  });
  if (!answer) {
    writeJson(
      response,
      200,
      {
        available: false,
        reason: "no-chat-model",
        hint: `Couldn't reach a cloud model${providerNote}, and the local model didn't respond. Check your OpenAI/Anthropic key, or pull an Ollama model: \`ollama pull qwen2.5:7b\`.`,
        sources,
      },
      corsOrigin,
    );
    return true;
  }
  appendConversationTurn(vaultDir, question, answer);
  writeJson(response, 200, { available: true, answer, sources }, corsOrigin);
  return true;
};
