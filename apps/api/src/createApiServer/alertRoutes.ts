import type { AgentAlert, AgentAlertConfig } from "./agentAlerts";
import {
  evaluateAgentAlerts,
  parseAgentAlertConfigPatch,
  readAgentAlertConfig,
  writeAgentAlertConfig,
} from "./agentAlerts";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

// Build a human-readable Markdown report of the current alert state.
export const buildAlertExportMarkdown = (
  config: AgentAlertConfig,
  alerts: AgentAlert[],
  generatedAt: string,
): string => {
  const lines: string[] = [];
  lines.push("# Octogent — Agent Alerts Export");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  lines.push(
    config.agentStuckMinutes === null
      ? "- Stuck-agent alerts: **off**"
      : `- Stuck-agent alerts: fire after **${config.agentStuckMinutes} min** blocked`,
  );
  lines.push("");
  lines.push(`## Active alerts (${alerts.length})`);
  lines.push("");
  if (alerts.length === 0) {
    lines.push("_No active alerts at export time._");
  } else {
    for (const alert of alerts) {
      lines.push(`- **${alert.label}** — ${alert.message} (since ${alert.since})`);
    }
  }
  lines.push("");
  return lines.join("\n");
};

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

// GET /api/monitor/export?format=json|md — download the current alert rules
// and the alerts active at export time. Honest point-in-time snapshot (alerts
// are live-derived, not a persisted history log).
export const handleMonitorExportRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/monitor/export") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const config = readAgentAlertConfig(projectStateDir);
  const alerts = evaluateAgentAlerts(runtime.listTerminalSnapshots(), config, Date.now());
  const generatedAt = new Date().toISOString();
  const format = requestUrl.searchParams.get("format") === "md" ? "md" : "json";

  const headers: Record<string, string> = {};
  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
  }

  if (format === "md") {
    headers["Content-Type"] = "text/markdown";
    headers["Content-Disposition"] = 'attachment; filename="octogent-alerts.md"';
    response.writeHead(200, headers);
    response.end(buildAlertExportMarkdown(config, alerts, generatedAt));
    return true;
  }

  headers["Content-Type"] = "application/json";
  headers["Content-Disposition"] = 'attachment; filename="octogent-alerts.json"';
  response.writeHead(200, headers);
  response.end(`${JSON.stringify({ generatedAt, config, alerts }, null, 2)}\n`);
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
