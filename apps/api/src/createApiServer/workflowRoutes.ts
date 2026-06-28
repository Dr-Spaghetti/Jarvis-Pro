import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

type Workflow = {
  id: string;
  name: string;
  description: string;
  steps: string;
  created: string;
  updated: string;
};

const WORKFLOWS_SUBDIR = join("state", "workflows");

const STEP_TIMEOUT_MS = 30_000;

const workflowsDir = (projectStateDir: string) => join(projectStateDir, WORKFLOWS_SUBDIR);

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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

  const brainAskUrl = `${getApiBaseUrl()}/api/brain/ask`;
  const results: Array<{ step: string; answer: string }> = [];
  const accumulated: Array<{ step: string; answer: string }> = [];

  for (const step of steps) {
    // Build the prompt: for step 1 use the raw step text; for steps 2+ prepend all prior
    // step questions + answers so each step has full context of what came before.
    let question = step;
    if (accumulated.length > 0) {
      const priorContext = accumulated
        .map((r, i) => `Step ${i + 1} — "${r.step}":\n${r.answer}`)
        .join("\n\n");
      question = `Context from prior steps:\n\n${priorContext}\n\nCurrent step: ${step}`;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
    let answer: string;

    try {
      const askRes = await fetch(brainAskUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      const data = (await askRes.json()) as { answer?: string };
      answer = typeof data.answer === "string" ? data.answer : "(no answer)";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        answer = `[timed out after ${STEP_TIMEOUT_MS / 1000}s]`;
      } else {
        answer = `Error: ${err instanceof Error ? err.message : "unknown"}`;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Push to accumulated first so the next step's context includes this result,
    // even if it was a timeout or error — the next step should know what happened.
    accumulated.push({ step, answer });
    results.push({ step, answer });
  }

  writeJson(response, 200, { ok: true, workflowId: id, results }, corsOrigin);
  return true;
};
