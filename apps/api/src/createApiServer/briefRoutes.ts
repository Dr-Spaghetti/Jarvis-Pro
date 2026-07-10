import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { computeBrainDigest, resolveVaultDir } from "./brainRoutes";
import {
  parseBriefConfigPatch,
  readBriefConfig,
  renderBriefMarkdown,
  writeBriefConfig,
} from "./briefScheduler";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

export const handleBriefRunRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/brief/run") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const now = new Date();
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(response, 503, { error: "No vault configured." }, corsOrigin);
    return true;
  }

  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const date = `${now.getFullYear()}-${month}-${day}`;
  const noteRel = join("Journal", `Daily Brief - ${date}.md`);
  const notePath = join(vaultDir, noteRel);

  const digest = computeBrainDigest();
  const markdown = renderBriefMarkdown(digest, now.toISOString());
  try {
    mkdirSync(dirname(notePath), { recursive: true });
    writeFileSync(notePath, markdown, "utf8");
  } catch {
    writeJson(response, 500, { error: "Could not write brief note." }, corsOrigin);
    return true;
  }

  const config = readBriefConfig(projectStateDir);
  const saved = writeBriefConfig(projectStateDir, {
    ...config,
    lastBriefDate: date,
    lastBriefAt: now.toISOString(),
  });
  writeJson(response, 200, saved, corsOrigin);
  return true;
};

// GET/PATCH /api/brief/config — the morning-brief schedule. GET returns the
// persisted config including lastBriefAt/lastBriefDate so the UI can show an
// honest status line. PATCH updates enabled/time; the running scheduler reads
// config fresh on each tick, so no restart is needed.
export const handleBriefConfigRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/brief/config") {
    return false;
  }

  if (request.method === "GET") {
    writeJson(response, 200, readBriefConfig(projectStateDir), corsOrigin);
    return true;
  }

  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const current = readBriefConfig(projectStateDir);
  const result = parseBriefConfigPatch(current, bodyReadResult.payload);
  if ("error" in result) {
    writeJson(response, 400, { error: result.error }, corsOrigin);
    return true;
  }

  const saved = writeBriefConfig(projectStateDir, result.config);
  writeJson(response, 200, saved, corsOrigin);
  return true;
};
