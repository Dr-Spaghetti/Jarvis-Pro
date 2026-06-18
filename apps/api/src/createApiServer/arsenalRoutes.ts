import { AGENT_ARCHETYPES } from "../agentArsenal";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

export const handleArsenalListRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  _deps,
) => {
  if (requestUrl.pathname !== "/api/arsenal") return false;

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const archetypes = AGENT_ARCHETYPES.map(({ id, name, role, icon, category, skills }) => ({
    id,
    name,
    role,
    icon,
    category,
    skills,
  }));

  writeJson(response, 200, archetypes, corsOrigin);
  return true;
};

export const handleArsenalDeployRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/arsenal/deploy") return false;

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;

  const body = bodyReadResult.payload as Record<string, unknown> | null;
  const archetypeId = body && typeof body.archetypeId === "string" ? body.archetypeId.trim() : "";
  const task = body && typeof body.task === "string" ? body.task.trim() : "";

  if (archetypeId.length === 0) {
    writeJson(response, 400, { error: "archetypeId is required" }, corsOrigin);
    return true;
  }

  const archetype = AGENT_ARCHETYPES.find((a) => a.id === archetypeId);
  if (!archetype) {
    writeJson(response, 404, { error: `Unknown archetype: "${archetypeId}"` }, corsOrigin);
    return true;
  }

  const initialPrompt =
    task.length > 0 ? `${archetype.systemPrompt}\n\n## Your Task\n${task}` : archetype.systemPrompt;

  try {
    const snapshot = runtime.createTerminal({
      workspaceMode: "shared",
      tentacleName: archetype.name,
      initialPrompt,
    });
    writeJson(
      response,
      200,
      { terminalId: snapshot.terminalId, tentacleId: snapshot.tentacleId, archetypeId },
      corsOrigin,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to deploy agent";
    writeJson(response, 500, { error: message }, corsOrigin);
  }

  return true;
};
