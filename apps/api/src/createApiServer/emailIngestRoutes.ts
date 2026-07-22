import { readEmailIngestState, writeEmailIngestState } from "./emailIngestProcessor.js";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

export const handleEmailIngestStatusRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/email-ingest/status") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  writeJson(response, 200, readEmailIngestState(projectStateDir), corsOrigin);
  return true;
};

export const handleEmailIngestSettingsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/email-ingest/settings") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const bodyResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyResult.ok) return true;
  const patch = bodyResult.payload as { enabled?: boolean };
  const current = readEmailIngestState(projectStateDir);
  if (typeof patch.enabled === "boolean") current.enabled = patch.enabled;
  writeEmailIngestState(projectStateDir, current);
  writeJson(response, 200, current, corsOrigin);
  return true;
};
