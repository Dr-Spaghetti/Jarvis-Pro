import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const TASK_PLAN_PROMPT = (goal: string) =>
  `Break down the following goal into a concrete, actionable task list. Return ONLY a JSON object (no markdown, no code fence) with this shape:
{"tasks": [{"title": "...", "detail": "...", "priority": "high"|"medium"|"low"}]}

Rules:
- 3-10 tasks, ordered by logical execution sequence
- Each title is a short imperative (≤12 words)
- Each detail is one sentence of clarification (optional; omit if obvious)
- Assign priority based on impact and urgency
- Be specific to the goal — no generic tasks

Goal: ${goal}`;

export const handleTaskPlanRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/tasks/plan") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicKey) {
    writeJson(response, 503, { error: "ANTHROPIC_API_KEY is required for Task Planning." }, corsOrigin);
    return true;
  }

  const bodyResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyResult.ok) return true;
  const body = (typeof bodyResult.payload === "object" && bodyResult.payload !== null
    ? bodyResult.payload
    : {}) as Record<string, unknown>;

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) {
    writeJson(response, 400, { error: "goal is required." }, corsOrigin);
    return true;
  }
  if (goal.length > 2000) {
    writeJson(response, 400, { error: "goal must be ≤2000 characters." }, corsOrigin);
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: TASK_PLAN_PROMPT(goal) }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      writeJson(response, 502, { error: `Claude API error: ${errText}` }, corsOrigin);
      return true;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === "text")?.text ?? "";
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();

    let tasks: Array<{ title: string; detail?: string; priority: string }> = [];
    try {
      const parsed = JSON.parse(cleaned) as { tasks?: unknown[] };
      if (Array.isArray(parsed.tasks)) {
        tasks = parsed.tasks
          .filter(
            (t): t is Record<string, unknown> =>
              typeof t === "object" && t !== null && !Array.isArray(t),
          )
          .map((t) => ({
            title: String(t.title ?? "").trim(),
            ...(t.detail ? { detail: String(t.detail).trim() } : {}),
            priority: ["high", "medium", "low"].includes(String(t.priority))
              ? String(t.priority)
              : "medium",
          }))
          .filter((t) => t.title.length > 0);
      }
    } catch {
      writeJson(response, 502, { error: "Claude returned an unparseable plan. Try rephrasing the goal." }, corsOrigin);
      return true;
    }

    if (tasks.length === 0) {
      writeJson(response, 502, { error: "No tasks generated. Try a more specific goal." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, { tasks }, corsOrigin);
  } catch (e) {
    writeJson(
      response,
      500,
      { error: e instanceof Error ? e.message : "Planning request failed." },
      corsOrigin,
    );
  } finally {
    clearTimeout(timer);
  }
  return true;
};
