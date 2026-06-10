import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed, writeNoContent, writeText } from "./routeHelpers";

const CONVERSATION_SEARCH_PATH = "/api/conversations/search";
const CONVERSATION_ITEM_PATH_PATTERN = /^\/api\/conversations\/([^/]+)$/;
const CONVERSATION_EXPORT_PATH_PATTERN = /^\/api\/conversations\/([^/]+)\/export$/;
const CONVERSATION_META_PATH_PATTERN = /^\/api\/conversations\/([^/]+)\/meta$/;

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

  const payload = runtime.listConversationSessions();
  writeJson(response, 200, payload, corsOrigin);
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
    runtime.deleteConversationSession(sessionId);
    writeNoContent(response, 204, corsOrigin);
    return true;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
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
