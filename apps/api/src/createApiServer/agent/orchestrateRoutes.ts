/**
 * Orchestration Routes - Loop-Aware Task Routing
 *
 * Routes tasks based on classification: if loop strategy required, execute loop;
 * otherwise single-pass deployment.
 */

import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { executeAgentLoop } from "./execution/agentLoopExecutor";
import { globalLoopMetricsCollector } from "./metrics/loopMetricsCollector";
import { classifyTask } from "./taskClassifier";
import type { TaskInput } from "./taskClassifier";

/**
 * Handle agent loop requests at POST /api/agent-loop.
 * Classifies the task, runs it through the iterative loop executor, and returns the result.
 */
export const handleAgentLoopRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  _dependencies,
) => {
  if (!requestUrl.pathname.startsWith("/api/agent-loop")) {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  try {
    const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyReadResult.ok) return true;

    const taskPayload = bodyReadResult.payload as Record<string, unknown> | null;
    if (!taskPayload || typeof taskPayload !== "object") {
      writeJson(response, 400, { error: "Invalid payload" }, corsOrigin);
      return true;
    }

    const task: TaskInput = {
      title: String(taskPayload.title || ""),
      ...(taskPayload.description ? { description: String(taskPayload.description) } : {}),
      ...(taskPayload.domain ? { domain: String(taskPayload.domain) } : {}),
      ...(taskPayload.complexity ? { complexity: String(taskPayload.complexity) } : {}),
      ...(taskPayload.timeConstraint ? { timeConstraint: String(taskPayload.timeConstraint) } : {}),
      ...(taskPayload.qualityBar ? { qualityBar: String(taskPayload.qualityBar) } : {}),
      ...(taskPayload.estimatedDurationMinutes
        ? { estimatedDurationMinutes: Number(taskPayload.estimatedDurationMinutes) }
        : {}),
      ...(taskPayload.context ? { context: taskPayload.context as Record<string, unknown> } : {}),
    };

    if (!task.title) {
      writeJson(response, 400, { error: "Missing required field: title" }, corsOrigin);
      return true;
    }

    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      writeJson(response, 503, { error: "ANTHROPIC_API_KEY not configured" }, corsOrigin);
      return true;
    }

    // Classify task to determine loop strategy
    const classification = classifyTask(task);

    const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    globalLoopMetricsCollector.recordLoopStart(deploymentId);

    const agentContext = {
      taskId: classification.taskId,
      deploymentId,
      agentArchetype: (taskPayload.agentArchetype as string | undefined) ?? "research-analyst",
      taskDescription: task.description ?? task.title,
      complexity: classification.complexity,
      maxDurationMs: classification.estimatedDurationMinutes * 60 * 1000,
    };

    // Always go through executeAgentLoop — it handles single-pass vs multi-iteration internally
    const strategy = classification.loopStrategy ?? {
      requiresLoop: false,
      maxIterations: 1,
      fallbackThreshold: 0.5,
      observationIntervalMs: 0,
      reflectionDepth: "shallow" as const,
      selfCorrectionMode: "disabled" as const,
    };

    const loopResult = await executeAgentLoop(agentContext, strategy);

    globalLoopMetricsCollector.recordLoopComplete(deploymentId, loopResult.metrics);

    writeJson(
      response,
      200,
      {
        deploymentId,
        classification,
        execution: {
          type: strategy.requiresLoop ? "loop-execution" : "single-pass-execution",
          finalOutput: loopResult.finalOutput,
          succeeded: loopResult.succeeded,
          iterationCount: loopResult.metrics.totalIterations,
          earlyTermination: loopResult.earlyTermination,
          terminationReason: loopResult.terminationReason,
        },
        metrics: loopResult.metrics,
        timestamp: new Date().toISOString(),
      },
      corsOrigin,
    );
    return true;
  } catch (error) {
    console.error("Agent loop error:", error);
    writeJson(
      response,
      500,
      {
        error: "Agent loop failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      corsOrigin,
    );
    return true;
  }
};
