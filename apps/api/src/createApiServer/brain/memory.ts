import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { asRecord, ensureAndAppend, oneLine, resolveVaultDir } from "./vault";

export const MEMORY_PATH = "Jarvis/Memory.md";
export const MEMORY_HEADER =
  '# Jarvis Memory\n\nLong-lived context Jarvis should remember about Nick and his work.\nSkills read this for context; the web "remember" action appends here.\n\n## Facts\n\n';

export const readMemoryFacts = (vaultDir: string, limit: number): string[] => {
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
