import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed, writeNoContent, writeText } from "./routeHelpers";

const CONVERSATION_SEARCH_PATH = "/api/conversations/search";
const CONVERSATION_ITEM_PATH_PATTERN = /^\/api\/conversations\/([^/]+)$/;
const CONVERSATION_EXPORT_PATH_PATTERN = /^\/api\/conversations\/([^/]+)\/export$/;
const CONVERSATION_META_PATH_PATTERN = /^\/api\/conversations\/([^/]+)\/meta$/;

// ── Vault Jarvis conversation bridge ──────────────────────────────────────────
// Jarvis HQ stores conversations as vault markdown files under
// Jarvis/Conversations/YYYY-MM-DD.md. These are bridged into the
// /api/conversations system so the Conversations tab shows them.

const VAULT_SESSION_PREFIX = "jarvis-vault-";

type VaultTurn = { time: string; question: string; answer: string };

const parseVaultConversationFile = (filePath: string): VaultTurn[] => {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const turns: VaultTurn[] = [];
  const blocks = content.split(/^## /m).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n");
    const time = lines[0]?.trim() ?? "";
    const youMatch = block.match(/\*\*You:\*\*\s*([\s\S]*?)(?=\*\*Jarvis:\*\*)/);
    const jarvisMatch = block.match(/\*\*Jarvis:\*\*\s*([\s\S]*?)(?=\n## |\n*$)/);
    const question = youMatch?.[1]?.trim() ?? "";
    const answer = jarvisMatch?.[1]?.trim() ?? "";
    if (question && answer) {
      turns.push({ time, question, answer });
    }
  }
  return turns;
};

const getVaultConvDir = (): string | null => {
  const vaultDir = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultDir) return null;
  const convDir = join(vaultDir, "Jarvis", "Conversations");
  if (!existsSync(convDir)) return null;
  return convDir;
};

const listVaultSessions = () => {
  const convDir = getVaultConvDir();
  if (!convDir) return [];

  let files: string[];
  try {
    files = readdirSync(convDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, 60);
  } catch {
    return [];
  }

  return files.map((file) => {
    const dateStr = file.replace(/\.md$/, "");
    const sessionId = `${VAULT_SESSION_PREFIX}${dateStr}`;
    const filePath = join(convDir, file);
    const turns = parseVaultConversationFile(filePath);
    let mtime: string | undefined;
    try {
      mtime = statSync(filePath).mtime.toISOString();
    } catch {
      mtime = undefined;
    }
    return {
      sessionId,
      tentacleId: "jarvis-hq",
      startedAt: `${dateStr}T00:00:00.000Z`,
      endedAt: mtime ?? `${dateStr}T23:59:59.000Z`,
      lastEventAt: mtime,
      eventCount: turns.length * 2,
      turnCount: turns.length * 2,
      userTurnCount: turns.length,
      assistantTurnCount: turns.length,
      firstUserTurnPreview: turns[0]?.question?.slice(0, 120),
      lastUserTurnPreview: turns[turns.length - 1]?.question?.slice(0, 120),
      lastAssistantTurnPreview: turns[turns.length - 1]?.answer?.slice(0, 120),
      tags: ["jarvis"],
    };
  });
};

const readVaultSession = (sessionId: string) => {
  if (!sessionId.startsWith(VAULT_SESSION_PREFIX)) return null;
  const dateStr = sessionId.slice(VAULT_SESSION_PREFIX.length);
  const convDir = getVaultConvDir();
  if (!convDir) return null;
  const filePath = join(convDir, `${dateStr}.md`);
  if (!existsSync(filePath)) return null;

  const vaultTurns = parseVaultConversationFile(filePath);
  const turns = vaultTurns.flatMap((t, i) => {
    const ts = `${dateStr}T${t.time.length === 5 ? t.time : "00:00"}:00.000Z`;
    return [
      {
        turnId: `${sessionId}-${i}-user`,
        role: "user" as const,
        content: t.question,
        startedAt: ts,
        endedAt: ts,
      },
      {
        turnId: `${sessionId}-${i}-assistant`,
        role: "assistant" as const,
        content: t.answer,
        startedAt: ts,
        endedAt: ts,
      },
    ];
  });

  const summary = listVaultSessions().find((s) => s.sessionId === sessionId);
  if (!summary) return null;
  return { ...summary, turns, events: [] };
};

// ── Route handlers ─────────────────────────────────────────────────────────────

export const handleConversationsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/conversations") {
    return false;
  }

  if (request.method === "DELETE") {
    runtime.deleteAllConversationSessions();
    writeNoContent(response, 204, corsOrigin);
    return true;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const runtimeSessions = runtime.listConversationSessions();
  const vaultSessions = listVaultSessions();
  // Vault sessions come first (most recent day first), then runtime sessions
  writeJson(response, 200, [...vaultSessions, ...runtimeSessions], corsOrigin);
  return true;
};

export const handleConversationSearchRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== CONVERSATION_SEARCH_PATH) {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const query = requestUrl.searchParams.get("q") ?? "";
  if (query.trim().length === 0) {
    writeJson(response, 400, { error: "Missing search query parameter 'q'." }, corsOrigin);
    return true;
  }

  const payload = runtime.searchConversations(query);
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

export const handleConversationItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(CONVERSATION_ITEM_PATH_PATTERN);
  if (!match) {
    return false;
  }

  const sessionId = decodeURIComponent(match[1] ?? "");

  if (request.method === "DELETE") {
    if (!sessionId.startsWith(VAULT_SESSION_PREFIX)) {
      runtime.deleteConversationSession(sessionId);
    }
    writeNoContent(response, 204, corsOrigin);
    return true;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  // Check vault sessions first
  if (sessionId.startsWith(VAULT_SESSION_PREFIX)) {
    const vaultSession = readVaultSession(sessionId);
    if (!vaultSession) {
      writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
      return true;
    }
    writeJson(response, 200, vaultSession, corsOrigin);
    return true;
  }

  const payload = runtime.readConversationSession(sessionId);
  if (!payload) {
    writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, payload, corsOrigin);
  return true;
};

export const handleConversationExportRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(CONVERSATION_EXPORT_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const sessionId = decodeURIComponent(match[1] ?? "");
  const format = requestUrl.searchParams.get("format");
  if (format !== "json" && format !== "md") {
    writeJson(response, 400, { error: "Unsupported conversation export format." }, corsOrigin);
    return true;
  }

  if (sessionId.startsWith(VAULT_SESSION_PREFIX)) {
    const vaultSession = readVaultSession(sessionId);
    if (!vaultSession) {
      writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
      return true;
    }
    if (format === "json") {
      writeJson(response, 200, vaultSession, corsOrigin);
    } else {
      const md = vaultSession.turns
        .map((t) => `**${t.role === "user" ? "You" : "Jarvis"}:** ${t.content}`)
        .join("\n\n");
      writeText(response, 200, md, "text/markdown; charset=utf-8", corsOrigin);
    }
    return true;
  }

  if (format === "json") {
    const payload = runtime.readConversationSession(sessionId);
    if (!payload) {
      writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, payload, corsOrigin);
    return true;
  }

  const payload = runtime.exportConversationSession(sessionId, "md");
  if (payload === null) {
    writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
    return true;
  }

  writeText(response, 200, payload, "text/markdown; charset=utf-8", corsOrigin);
  return true;
};

export const handleConversationMetaRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(CONVERSATION_META_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const sessionId = decodeURIComponent(match[1] ?? "");

  // Vault sessions are read-only — silently succeed on meta patch
  if (sessionId.startsWith(VAULT_SESSION_PREFIX)) {
    writeNoContent(response, 204, corsOrigin);
    return true;
  }

  let body: unknown;
  try {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", resolve);
      request.on("error", reject);
    });
    body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    writeJson(response, 400, { error: "Invalid JSON body." }, corsOrigin);
    return true;
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    writeJson(response, 400, { error: "Body must be a JSON object." }, corsOrigin);
    return true;
  }

  const rec = body as Record<string, unknown>;

  const hasTags = "tags" in rec;
  const hasPinned = "pinned" in rec;

  if (
    (hasTags &&
      (!Array.isArray(rec.tags) || !(rec.tags as unknown[]).every((t) => typeof t === "string"))) ||
    (hasPinned && typeof rec.pinned !== "boolean")
  ) {
    writeJson(
      response,
      400,
      { error: "Invalid patch: tags must be string[] and pinned must be boolean." },
      corsOrigin,
    );
    return true;
  }

  const patch: { tags?: string[]; pinned?: boolean } = {};
  if (hasTags) patch.tags = rec.tags as string[];
  if (hasPinned) patch.pinned = rec.pinned as boolean;

  const ok = runtime.patchConversationMeta(sessionId, patch);
  if (!ok) {
    writeJson(response, 404, { error: "Conversation session not found." }, corsOrigin);
    return true;
  }

  writeNoContent(response, 204, corsOrigin);
  return true;
};
