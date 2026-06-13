import { parseBriefConfigPatch, readBriefConfig, writeBriefConfig } from "./briefScheduler";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

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
