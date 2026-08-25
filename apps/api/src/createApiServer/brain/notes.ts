import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { type MemorySection, appendMemoryFact, isMemorySection } from "./memory";
import { addInboxTask } from "./tasks";
import {
  type BrainNote,
  asRecord,
  buildSnippet,
  deriveTitle,
  listMarkdownFiles,
  oneLine,
  readNote,
  resolveVaultDir,
  stripFrontmatter,
  toPosix,
} from "./vault";

const CAPTURE_KINDS = ["note", "remember", "task"] as const;
type CaptureKind = (typeof CAPTURE_KINDS)[number];

const isCaptureKind = (value: unknown): value is CaptureKind =>
  typeof value === "string" && (CAPTURE_KINDS as readonly string[]).includes(value);

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
  const payload = asRecord(body.payload);
  const text = typeof payload.text === "string" ? oneLine(payload.text) : "";
  if (text.length === 0) {
    writeJson(response, 400, { error: "text (non-empty string) is required" }, corsOrigin);
    return true;
  }
  const kind: CaptureKind = isCaptureKind(payload.kind) ? payload.kind : "note";
  try {
    if (kind === "remember") {
      const section: MemorySection = isMemorySection(payload.section) ? payload.section : "Facts";
      const path = appendMemoryFact(vaultDir, text, section);
      writeJson(response, 201, { ok: true, kind, path, section }, corsOrigin);
      return true;
    }
    if (kind === "task") {
      const added = addInboxTask(vaultDir, text);
      writeJson(response, 201, { ok: true, kind, path: added.path }, corsOrigin);
      return true;
    }
    const inboxDir = join(vaultDir, "Inbox");
    if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });
    const file = join(inboxDir, "Quick Capture.md");
    if (!existsSync(file)) appendFileSync(file, "# Quick Capture\n\n", "utf8");
    appendFileSync(file, `- ${text}\n`, "utf8");
    writeJson(response, 201, { ok: true, kind, path: "Inbox/Quick Capture.md" }, corsOrigin);
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
