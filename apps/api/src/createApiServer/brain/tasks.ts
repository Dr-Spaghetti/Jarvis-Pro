import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import {
  asRecord,
  listMarkdownFiles,
  oneLine,
  resolveVaultDir,
  resolveVaultFile,
  toPosix,
} from "./vault";

export const INBOX_PATH = "Inbox.md";
export const INBOX_HEADER = `# Inbox

Tasks without a home. File these into a project note when you can.

`;

export const OPEN_TASK_RE = /^\s*[-*]\s+\[ \]\s+(.+?)\s*$/;
const CHECKBOX_RE = /^(\s*[-*]\s+)\[([ xX])\](\s+)(.+?)\s*$/;

const SKIP_DIRS = ["Journal/", "Jarvis/"];
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TASKS = 80;

export type VaultTask = {
  text: string;
  done: boolean;
  path: string;
  line: number;
  stale: boolean;
  source: "inbox" | "vault";
};

export const parseOpenTask = (line: string): string | null => {
  const match = OPEN_TASK_RE.exec(line);
  return match?.[1]?.trim() ?? null;
};

const shouldSkipPath = (relPosix: string): boolean =>
  SKIP_DIRS.some((prefix) => relPosix.startsWith(prefix));

export const listVaultTasks = (vaultDir: string, now = Date.now()): VaultTask[] => {
  const tasks: VaultTask[] = [];
  for (const rel of listMarkdownFiles(vaultDir)) {
    const relPosix = toPosix(rel);
    if (shouldSkipPath(relPosix)) continue;
    const full = join(vaultDir, rel);
    let content: string;
    let mtime = now;
    try {
      content = readFileSync(full, "utf8");
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    const source: VaultTask["source"] = relPosix === INBOX_PATH ? "inbox" : "vault";
    const stale = source === "vault" && now - mtime > STALE_MS;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = CHECKBOX_RE.exec(lines[i] ?? "");
      if (!parsed) continue;
      const done = parsed[2] !== " ";
      const text = parsed[4]?.trim() ?? "";
      if (!text) continue;
      tasks.push({
        text,
        done,
        path: relPosix,
        line: i,
        stale: !done && stale,
        source,
      });
      if (tasks.length >= MAX_TASKS) return tasks;
    }
  }
  return tasks;
};

export const addInboxTask = (vaultDir: string, text: string): { path: string; line: number } => {
  const file = join(vaultDir, INBOX_PATH);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, INBOX_HEADER, "utf8");
  const existing = readFileSync(file, "utf8");
  const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  writeFileSync(file, `${existing}${prefix}- [ ] ${text}\n`, "utf8");
  const line = `${existing}${prefix}`.split(/\n/).length - 1;
  return { path: toPosix(INBOX_PATH), line: Math.max(0, line) };
};

export const toggleVaultTask = (
  vaultDir: string,
  relPath: string,
  line: number,
  done: boolean,
  expectedText?: string,
): VaultTask | null => {
  const target = resolveVaultFile(vaultDir, relPath);
  if (!target || !existsSync(target)) return null;
  let content: string;
  try {
    content = readFileSync(target, "utf8");
  } catch {
    return null;
  }
  const lines = content.split(/\n/);
  if (line < 0 || line >= lines.length) return null;
  const current = lines[line] ?? "";
  const parsed = CHECKBOX_RE.exec(current.replace(/\r$/, ""));
  if (!parsed) return null;
  const text = parsed[4]?.trim() ?? "";
  if (expectedText && text !== expectedText) return null;
  const mark = done ? "x" : " ";
  lines[line] = `${parsed[1]}[${mark}]${parsed[3]}${text}`;
  const joined = lines.join("\n");
  try {
    writeFileSync(target, joined.endsWith("\n") ? joined : `${joined}\n`, "utf8");
  } catch {
    return null;
  }
  const relPosix = toPosix(relPath);
  return {
    text,
    done,
    path: relPosix,
    line,
    stale: false,
    source: relPosix === INBOX_PATH ? "inbox" : "vault",
  };
};

export const handleBrainTasksRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/tasks") return false;

  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    if (request.method === "GET") {
      writeJson(response, 200, { configured: false, tasks: [] }, corsOrigin);
      return true;
    }
    writeJson(
      response,
      400,
      { error: "No vault configured (set OBSIDIAN_VAULT_PATH)." },
      corsOrigin,
    );
    return true;
  }

  if (request.method === "GET") {
    const includeDone = requestUrl.searchParams.get("done") === "1";
    const tasks = listVaultTasks(vaultDir).filter((task) => includeDone || !task.done);
    writeJson(response, 200, { configured: true, tasks }, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);
    const text = typeof payload.text === "string" ? oneLine(payload.text) : "";
    if (text.length === 0) {
      writeJson(response, 400, { error: "text (non-empty string) is required" }, corsOrigin);
      return true;
    }
    try {
      const added = addInboxTask(vaultDir, text);
      writeJson(
        response,
        201,
        {
          ok: true,
          path: added.path,
          task: {
            text,
            done: false,
            path: added.path,
            line: added.line,
            stale: false,
            source: "inbox",
          },
        },
        corsOrigin,
      );
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "task add failed" },
        corsOrigin,
      );
    }
    return true;
  }

  if (request.method === "PATCH") {
    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);
    const path = typeof payload.path === "string" ? payload.path : "";
    const line = typeof payload.line === "number" ? payload.line : Number(payload.line);
    const done = payload.done === true;
    const expectedText = typeof payload.text === "string" ? payload.text : undefined;
    if (!path || !Number.isInteger(line)) {
      writeJson(response, 400, { error: "path and line are required" }, corsOrigin);
      return true;
    }
    const updated = toggleVaultTask(vaultDir, path, line, done, expectedText);
    if (!updated) {
      writeJson(response, 404, { error: "Task not found" }, corsOrigin);
      return true;
    }
    writeJson(response, 200, { ok: true, task: updated }, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};
