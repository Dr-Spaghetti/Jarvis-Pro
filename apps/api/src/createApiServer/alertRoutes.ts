import {
  evaluateAgentAlerts,
  parseAgentAlertConfigPatch,
  readAgentAlertConfig,
  writeAgentAlertConfig,
} from "./agentAlerts";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

// GET /api/monitor/alerts — current alert rules plus the alerts active right
// now (derived live from terminal snapshots, never persisted/fabricated).
export const handleAgentAlertsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/monitor/alerts") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const config = readAgentAlertConfig(projectStateDir);
  const alerts = evaluateAgentAlerts(runtime.listTerminalSnapshots(), config, Date.now());
  writeJson(response, 200, { config, alerts }, corsOrigin);
  return true;
};

// GET/PATCH /api/monitor/alerts/config — read or update the persisted rules.
export const handleAgentAlertConfigRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/monitor/alerts/config") {
    return false;
  }

  if (request.method === "GET") {
    writeJson(response, 200, readAgentAlertConfig(projectStateDir), corsOrigin);
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

  const current = readAgentAlertConfig(projectStateDir);
  const result = parseAgentAlertConfigPatch(current, bodyReadResult.payload);
  if ("error" in result) {
    writeJson(response, 400, { error: result.error }, corsOrigin);
    return true;
  }

  const saved = writeAgentAlertConfig(projectStateDir, result.config);
  writeJson(response, 200, saved, corsOrigin);
  return true;
};
