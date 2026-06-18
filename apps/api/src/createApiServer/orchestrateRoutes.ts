import { randomUUID } from "node:crypto";

import { AGENT_ARCHETYPES } from "../agentArsenal";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

type PlanItem = {
  archetypeId: string;
  subtask: string;
};

type DeployedAgent = {
  terminalId: string;
  tentacleId: string;
  archetypeId: string;
  subtask: string;
};

const ARCHETYPE_SUMMARY = AGENT_ARCHETYPES.map(({ id, role }) => `${id}: ${role}`).join("\n");

const DECOMPOSE_SYSTEM = `You are Jarvis's task orchestrator. Given a task, return a JSON deployment plan.

Available agents:
${ARCHETYPE_SUMMARY}

Rules:
- Choose 2–5 agents that together cover all aspects of the task
- Each agent gets one focused subtask (one sentence)
- Prefer specialists over generalists for the given domain
- Respond with ONLY valid JSON, no other text

JSON schema:
{"plan":[{"archetypeId":"<id from list>","subtask":"<one sentence task>"}]}`;

const parseJsonPlan = (text: string): PlanItem[] | null => {
  // Extract JSON even if Claude adds preamble/postamble
  const match = /\{[\s\S]*"plan"[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { plan?: unknown };
    if (!Array.isArray(parsed.plan)) return null;
    const validItems: PlanItem[] = [];
    for (const item of parsed.plan) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).archetypeId === "string" &&
        typeof (item as Record<string, unknown>).subtask === "string"
      ) {
        validItems.push({
          archetypeId: (item as Record<string, unknown>).archetypeId as string,
          subtask: (item as Record<string, unknown>).subtask as string,
        });
      }
    }
    return validItems.length > 0 ? validItems : null;
  } catch {
    return null;
  }
};

type OrchestrateResult =
  | { ok: true; jobId: string; summary: string; agents: DeployedAgent[] }
  | { ok: false; error: string };

export const orchestrateTask = async (
  task: string,
  runtime: Parameters<ApiRouteHandler>[1]["runtime"],
  context = "",
): Promise<OrchestrateResult> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not configured" };

  let planItems: PlanItem[];
  try {
    const userContent =
      context.length > 0 ? `Task: ${task}\n\nContext: ${context}` : `Task: ${task}`;
    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: DECOMPOSE_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!apiResponse.ok) return { ok: false, error: `Model error: ${apiResponse.status}` };
    const apiData = (await apiResponse.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = apiData.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = parseJsonPlan(text);
    if (!parsed) return { ok: false, error: "Orchestrator returned unparseable plan" };
    planItems = parsed;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Orchestration failed" };
  }

  const archetypeMap = new Map(AGENT_ARCHETYPES.map((a) => [a.id, a]));
  const validPlan = planItems.filter((item) => archetypeMap.has(item.archetypeId));
  if (validPlan.length === 0) return { ok: false, error: "No valid agents in plan" };

  const jobId = randomUUID();
  const coordDir = `.octogent/orchestration/${jobId}`;
  const deployed: DeployedAgent[] = [];

  for (const item of validPlan) {
    const archetype = archetypeMap.get(item.archetypeId);
    if (!archetype) continue;
    const initialPrompt = `${archetype.systemPrompt}

## Your Task (Orchestration Job: ${jobId})
${item.subtask}

## Coordination
Write your key findings to: ${coordDir}/${archetype.id}-results.md (first line: "## COMPLETE").
Other agents: ${validPlan
      .filter((p) => p.archetypeId !== item.archetypeId)
      .map((p) => archetypeMap.get(p.archetypeId)?.name ?? p.archetypeId)
      .join(", ")}`;

    try {
      const snapshot = runtime.createTerminal({
        workspaceMode: "shared",
        tentacleName: archetype.name,
        initialPrompt,
      });
      deployed.push({
        terminalId: snapshot.terminalId,
        tentacleId: snapshot.tentacleId,
        archetypeId: item.archetypeId,
        subtask: item.subtask,
      });
    } catch {
      /* skip */
    }
  }

  if (deployed.length === 0) return { ok: false, error: "Failed to deploy any agents" };

  return {
    ok: true,
    jobId,
    agents: deployed,
    summary: `Deployed ${deployed.length} agent${deployed.length !== 1 ? "s" : ""}: ${deployed.map((d) => archetypeMap.get(d.archetypeId)?.name ?? d.archetypeId).join(", ")}. Results will be written to ${coordDir}/.`,
  };
};

export const handleOrchestrateRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/brain/orchestrate") return false;

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;

  const body = bodyReadResult.payload as Record<string, unknown> | null;
  const task = body && typeof body.task === "string" ? body.task.trim() : "";
  const context = body && typeof body.context === "string" ? body.context.trim() : "";

  if (task.length === 0) {
    writeJson(response, 400, { error: "task is required" }, corsOrigin);
    return true;
  }

  const result = await orchestrateTask(task, runtime, context);
  if (!result.ok) {
    const statusCode = result.error.includes("not configured") ? 503 : 502;
    writeJson(response, statusCode, { error: result.error }, corsOrigin);
    return true;
  }

  writeJson(
    response,
    200,
    {
      jobId: result.jobId,
      agents: result.agents,
      summary: result.summary,
    },
    corsOrigin,
  );
  return true;
};
