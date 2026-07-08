import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { asRecord, ensureAndAppend, oneLine, resolveVaultDir } from "./vault";

export const JOURNAL_PATH = "Journal/Activity Log.md";
export const JOURNAL_HEADER =
  "# Jarvis Activity Log\n\nAppend-only record of what Jarvis did and whether it worked.\n\n";

type JournalStatus = "ok" | "warn" | "error";
const JOURNAL_STATUSES: readonly JournalStatus[] = ["ok", "warn", "error"];
const isJournalStatus = (value: unknown): value is JournalStatus =>
  typeof value === "string" && (JOURNAL_STATUSES as readonly string[]).includes(value);

export type JournalEntry = {
  ts: string;
  status: JournalStatus;
  skill: string | null;
  action: string;
  detail: string | null;
};

const formatJournalLine = (entry: JournalEntry): string => {
  const skill = entry.skill ? ` (${entry.skill})` : "";
  const detail = entry.detail ? ` — ${entry.detail}` : "";
  return `- [${entry.ts}] [${entry.status}]${skill} ${entry.action}${detail}\n`;
};

const JOURNAL_LINE = /^- \[([^\]]+)\] \[(ok|warn|error)\](?: \(([^)]+)\))? (.+)$/;
export const parseJournalLine = (line: string): JournalEntry | null => {
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
