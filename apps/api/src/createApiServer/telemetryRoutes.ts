import { readTokenTelemetry } from "../terminalRuntime/tokenTelemetry";
import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed } from "./routeHelpers";

// GET /api/telemetry/tokens — real per-session token usage, newest first.
// Returns an empty list (not an error) when no telemetry has been collected
// yet, so the UI can show an honest "collecting from now" empty state.
export const handleTokenTelemetryRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/telemetry/tokens") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const document = readTokenTelemetry(projectStateDir);
  const sessions = Object.values(document.sessions).sort((a, b) =>
    b.lastRecordedAt.localeCompare(a.lastRecordedAt),
  );

  writeJson(response, 200, { sessions }, corsOrigin);
  return true;
};
