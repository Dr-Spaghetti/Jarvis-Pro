import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";
import { withCors } from "./security";

type Workflow = {
  id: string;
  name: string;
  description: string;
  steps: string;
  created: string;
  updated: string;
};

export type WorkflowRunStep = {
  step: string;
  answer: string;
  durationMs: number;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  completedAt: string;
  status: "ok" | "error";
  steps: WorkflowRunStep[];
};

const WORKFLOWS_SUBDIR = join("state", "workflows");
const WORKFLOW_RUNS_SUBDIR = join("state", "workflow-runs");

const STEP_TIMEOUT_MS = 30_000;
const MAX_RUNS_PER_WORKFLOW = 20;
const MAX_RECENT_RUNS = 20;

const workflowsDir = (projectStateDir: string) => join(projectStateDir, WORKFLOWS_SUBDIR);
const workflowRunsDir = (projectStateDir: string) => join(projectStateDir, WORKFLOW_RUNS_SUBDIR);

const safeWorkflowPath = (dir: string, id: string): string | null => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const target = resolve(join(dir, `${id}.json`));
  const root = resolve(dir);
  if (!target.startsWith(root + sep)) return null;
  return target;
};

const listWorkflows = (dir: string): Workflow[] => {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir) as string[];
  } catch {
    return [];
  }
  const workflows: Workflow[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const content = readFileSync(join(dir, entry), "utf8");
      const parsed = JSON.parse(content) as Workflow;
      if (parsed.id && parsed.name) workflows.push(parsed);
    } catch {
      // skip malformed files
    }
  }
  return workflows.sort((a, b) => b.created.localeCompare(a.created));
};

const loadRuns = (runsDir: string, workflowId?: string): WorkflowRun[] => {
  if (!existsSync(runsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(runsDir) as string[];
  } catch {
    return [];
  }
  const runs: WorkflowRun[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(runsDir, entry), "utf8")) as WorkflowRun;
      if (!parsed.id || !parsed.workflowId) continue;
      if (workflowId && parsed.workflowId !== workflowId) continue;
      runs.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

const saveRun = (runsDir: string, run: WorkflowRun): void => {
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${run.id}.json`), JSON.stringify(run, null, 2), "utf8");

  // Prune old runs for this workflow beyond MAX_RUNS_PER_WORKFLOW
  const all = loadRuns(runsDir, run.workflowId);
  if (all.length > MAX_RUNS_PER_WORKFLOW) {
    for (const old of all.slice(MAX_RUNS_PER_WORKFLOW)) {
      try {
        rmSync(join(runsDir, `${old.id}.json`));
      } catch {
        /* ignore */
      }
    }
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// --- Collection route: GET/POST /api/workflows ---

export const handleWorkflowsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/workflows") return false;

  const dir = workflowsDir(projectStateDir);

  if (request.method === "GET") {
    writeJson(response, 200, { workflows: listWorkflows(dir) }, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);

    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const description = typeof payload.description === "string" ? payload.description.trim() : "";
    const steps = typeof payload.steps === "string" ? payload.steps.trim() : "";

    if (!name) {
      writeJson(response, 400, { error: "name is required" }, corsOrigin);
      return true;
    }

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const now = new Date().toISOString();
    const id = `wf-${Date.now()}`;
    const workflow: Workflow = { id, name, description, steps, created: now, updated: now };

    try {
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(workflow, null, 2), "utf8");
      writeJson(response, 201, { ok: true, workflow }, corsOrigin);
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "write failed" },
        corsOrigin,
      );
    }
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

// --- Item route: GET/PATCH/DELETE /api/workflows/:id ---

export const handleWorkflowItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  const match = /^\/api\/workflows\/([^/]+)$/.exec(requestUrl.pathname);
  if (!match) return false;
  const id = match[1] ?? "";

  const dir = workflowsDir(projectStateDir);
  const filePath = safeWorkflowPath(dir, id);
  if (!filePath) {
    writeJson(response, 400, { error: "Invalid workflow ID." }, corsOrigin);
    return true;
  }

  if (request.method === "GET") {
    if (!existsSync(filePath)) {
      writeJson(response, 404, { error: "Workflow not found." }, corsOrigin);
      return true;
    }
    try {
      const content = readFileSync(filePath, "utf8");
      writeJson(response, 200, { workflow: JSON.parse(content) }, corsOrigin);
    } catch {
      writeJson(response, 500, { error: "Failed to read workflow." }, corsOrigin);
    }
    return true;
  }

  if (request.method === "PATCH") {
    if (!existsSync(filePath)) {
      writeJson(response, 404, { error: "Workflow not found." }, corsOrigin);
      return true;
    }
    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);

    try {
      const existing = JSON.parse(readFileSync(filePath, "utf8")) as Workflow;
      if (typeof payload.name === "string" && payload.name.trim()) {
        existing.name = payload.name.trim();
      }
      if (typeof payload.description === "string") {
        existing.description = payload.description.trim();
      }
      if (typeof payload.steps === "string") {
        existing.steps = payload.steps.trim();
      }
      existing.updated = new Date().toISOString();
      writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf8");
      writeJson(response, 200, { ok: true, workflow: existing }, corsOrigin);
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "write failed" },
        corsOrigin,
      );
    }
    return true;
  }

  if (request.method === "DELETE") {
    if (!existsSync(filePath)) {
      writeJson(response, 404, { error: "Workflow not found." }, corsOrigin);
      return true;
    }
    try {
      rmSync(filePath);
      writeJson(response, 200, { ok: true }, corsOrigin);
    } catch (error) {
      writeJson(
        response,
        500,
        { error: error instanceof Error ? error.message : "delete failed" },
        corsOrigin,
      );
    }
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

// --- Run history for a workflow: GET /api/workflows/:id/runs ---

export const handleWorkflowRunHistoryRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  const match = /^\/api\/workflows\/([^/]+)\/runs$/.exec(requestUrl.pathname);
  if (!match) return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const workflowId = match[1] ?? "";
  if (!/^[a-zA-Z0-9_-]+$/.test(workflowId)) {
    writeJson(response, 400, { error: "Invalid workflow ID." }, corsOrigin);
    return true;
  }

  const runsDir = workflowRunsDir(projectStateDir);
  const runs = loadRuns(runsDir, workflowId).slice(0, MAX_RUNS_PER_WORKFLOW);
  writeJson(response, 200, { runs }, corsOrigin);
  return true;
};

// --- Recent runs across all workflows: GET /api/workflow-runs/recent ---

export const handleWorkflowRunsRecentRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/workflow-runs/recent") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const runsDir = workflowRunsDir(projectStateDir);
  const runs = loadRuns(runsDir).slice(0, MAX_RECENT_RUNS);
  writeJson(response, 200, { runs }, corsOrigin);
  return true;
};

// --- AI improvement suggestions: POST /api/workflows/:id/improve ---

export const handleWorkflowImproveRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir, getApiBaseUrl, authToken },
) => {
  const match = /^\/api\/workflows\/([^/]+)\/improve$/.exec(requestUrl.pathname);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const id = match[1] ?? "";
  const dir = workflowsDir(projectStateDir);
  const filePath = safeWorkflowPath(dir, id);
  if (!filePath || !existsSync(filePath)) {
    writeJson(response, 404, { error: "Workflow not found." }, corsOrigin);
    return true;
  }

  let workflow: Workflow;
  try {
    workflow = JSON.parse(readFileSync(filePath, "utf8")) as Workflow;
  } catch {
    writeJson(response, 500, { error: "Failed to read workflow." }, corsOrigin);
    return true;
  }

  const runsDir = workflowRunsDir(projectStateDir);
  const recentRuns = loadRuns(runsDir, id).slice(0, 5);

  if (recentRuns.length === 0) {
    writeJson(
      response,
      400,
      { error: "Run the workflow at least once before improving." },
      corsOrigin,
    );
    return true;
  }

  const runsContext = recentRuns
    .map((run, ri) => {
      const stepSummary = run.steps
        .map((s, si) => {
          const snippet = s.answer.length > 280 ? `${s.answer.slice(0, 280)}…` : s.answer;
          return `  Step ${si + 1} ("${s.step}"): ${snippet}`;
        })
        .join("\n");
      return `Run ${ri + 1} (${run.status}):\n${stepSummary}`;
    })
    .join("\n\n");

  const question = `You are optimizing a multi-step AI workflow. Analyze the current steps and recent run results, then rewrite each step prompt to produce more specific, actionable, and valuable output.

Workflow: "${workflow.name}"
Description: "${workflow.description}"

Current steps (one per line):
${workflow.steps}

Recent run results:
${runsContext}

Respond in EXACTLY this format (no extra text before or after):
IMPROVED_STEPS:
[rewritten step 1]
[rewritten step 2]
[... same count as original steps]
RATIONALE: [one sentence explaining the key improvement]`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/brain/ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question }),
    });
    if (!res.ok) {
      writeJson(response, 502, { error: "AI improvement request failed" }, corsOrigin);
      return true;
    }
    const data = (await res.json()) as { answer?: string };
    const answer = typeof data.answer === "string" ? data.answer : "";

    const improvedMatch = /IMPROVED_STEPS:\s*\n([\s\S]+?)(?:\nRATIONALE:|$)/i.exec(answer);
    const rationaleMatch = /RATIONALE:\s*(.+)/i.exec(answer);

    const improvedSteps = improvedMatch ? (improvedMatch[1] ?? "").trim() : workflow.steps;
    const rationale = rationaleMatch
      ? (rationaleMatch[1] ?? "").trim()
      : "Steps refined based on run history.";

    writeJson(response, 200, { improvedSteps, rationale }, corsOrigin);
  } catch (error) {
    writeJson(
      response,
      500,
      { error: error instanceof Error ? error.message : "Improvement failed" },
      corsOrigin,
    );
  }
  return true;
};

// --- Run a workflow with SSE streaming: POST /api/workflows/:id/run ---

export const handleWorkflowRunRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir, getApiBaseUrl, authToken },
) => {
  const match = /^\/api\/workflows\/([^/]+)\/run$/.exec(requestUrl.pathname);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const id = match[1] ?? "";
  const dir = workflowsDir(projectStateDir);
  const filePath = safeWorkflowPath(dir, id);
  if (!filePath || !existsSync(filePath)) {
    writeJson(response, 404, { error: "Workflow not found." }, corsOrigin);
    return true;
  }

  let workflow: Workflow;
  try {
    workflow = JSON.parse(readFileSync(filePath, "utf8")) as Workflow;
  } catch {
    writeJson(response, 500, { error: "Failed to read workflow." }, corsOrigin);
    return true;
  }

  const steps = workflow.steps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (steps.length === 0) {
    writeJson(response, 400, { error: "Workflow has no steps to run." }, corsOrigin);
    return true;
  }

  // Start SSE stream
  const sseHeaders = withCors(
    {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
    corsOrigin,
  );
  response.writeHead(200, sseHeaders);

  const sendEvent = (data: unknown): void => {
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const brainAskUrl = `${getApiBaseUrl()}/api/brain/ask`;
  const runSteps: WorkflowRunStep[] = [];
  const accumulated: Array<{ step: string; answer: string }> = [];
  const startedAt = new Date().toISOString();
  const runId = `run-${Date.now()}`;
  let runStatus: "ok" | "error" = "ok";

  let aborted = false;
  const requestController = new AbortController();
  request.on("close", () => {
    aborted = true;
    requestController.abort();
  });

  // Signal first step is running
  if (!aborted) sendEvent({ type: "step-start", stepIndex: 0, step: steps[0] });

  for (let i = 0; i < steps.length; i++) {
    if (aborted) break;
    const step = steps[i] ?? "";
    const stepStart = Date.now();

    let question = step;
    if (accumulated.length > 0) {
      const priorContext = accumulated
        .map((r, idx) => `Step ${idx + 1} — "${r.step}":\n${r.answer}`)
        .join("\n\n");
      question = `Context from prior steps:\n\n${priorContext}\n\nCurrent step: ${step}`;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const timeoutId = setTimeout(() => requestController.abort(), STEP_TIMEOUT_MS);
    let answer: string;

    try {
      const askRes = await fetch(brainAskUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ question }),
        signal: requestController.signal,
      });
      const data = (await askRes.json()) as { answer?: string };
      answer = typeof data.answer === "string" ? data.answer : "(no answer)";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        answer = `[timed out after ${STEP_TIMEOUT_MS / 1000}s]`;
      } else {
        answer = `Error: ${err instanceof Error ? err.message : "unknown"}`;
      }
      runStatus = "error";
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - stepStart;
    accumulated.push({ step, answer });
    runSteps.push({ step, answer, durationMs });

    const isError = answer.startsWith("[timed out") || answer.startsWith("Error:");
    if (!aborted)
      sendEvent({
        type: "step-done",
        stepIndex: i,
        step,
        answer,
        durationMs,
        error: isError,
      });

    // Signal next step starting
    if (!aborted && i + 1 < steps.length) {
      sendEvent({ type: "step-start", stepIndex: i + 1, step: steps[i + 1] });
    }
  }

  if (!aborted) {
    const completedAt = new Date().toISOString();
    const run: WorkflowRun = {
      id: runId,
      workflowId: id,
      workflowName: workflow.name,
      startedAt,
      completedAt,
      status: runStatus,
      steps: runSteps,
    };

    try {
      saveRun(workflowRunsDir(projectStateDir), run);
    } catch {
      // don't fail the run if persistence fails
    }

    sendEvent({ type: "done", runId, status: runStatus });
    response.end();
  }
  return true;
};
