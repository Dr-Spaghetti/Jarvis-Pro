/**
 * Orchestration Routes - Loop-Aware Task Routing
 *
 * Routes tasks based on classification: if loop strategy required, execute loop;
 * otherwise single-pass deployment.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteHandlerContext } from "./routeHelpers";
import { writeJson } from "./routeHelpers";
import { classifyTask } from "./agent/taskClassifier";
import { executeAgentLoop } from "./agent/execution/agentLoopExecutor";
import { globalLoopMetricsCollector } from "./agent/metrics/loopMetricsCollector";
import type { TaskInput } from "./agent/taskClassifier";

/**
 * Handle orchestration requests.
 * Route tasks through classification -> loop execution (if needed) -> metrics.
 */
export async function handleOrchestrateRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteHandlerContext,
): Promise<boolean> {
  if (request.method !== "POST") {
    response.writeHead(405);
    response.end();
    return true;
  }

  if (!request.url?.startsWith("/api/orchestrate")) {
    return false;
  }

  try {
    // Parse request body
    let body = "";
    await new Promise<void>((resolve, reject) => {
      request.on("data", chunk => {
        body += chunk;
      });
      request.on("end", resolve);
      request.on("error", reject);
    });

    const payload = JSON.parse(body) as unknown;
    if (!payload || typeof payload !== "object") {
      writeJson(response, { error: "Invalid payload" }, 400);
      return true;
    }

    const taskPayload = payload as Record<string, unknown>;
    const task: TaskInput = {
      title: String(taskPayload.title || ""),
      description: taskPayload.description ? String(taskPayload.description) : undefined,
      domain: taskPayload.domain ? String(taskPayload.domain) : undefined,
      complexity: taskPayload.complexity ? String(taskPayload.complexity) : undefined,
      timeConstraint: taskPayload.timeConstraint ? String(taskPayload.timeConstraint) : undefined,
      qualityBar: taskPayload.qualityBar ? String(taskPayload.qualityBar) : undefined,
      estimatedDurationMinutes: taskPayload.estimatedDurationMinutes
        ? Number(taskPayload.estimatedDurationMinutes)
        : undefined,
      context: taskPayload.context ? (taskPayload.context as Record<string, unknown>) : undefined,
    };

    if (!task.title) {
      writeJson(response, { error: "Missing required field: title" }, 400);
      return true;
    }

    // Classify task
    const classification = classifyTask(task);

    // Generate deployment ID
    const deploymentId = `deploy-${ Date.now() }-${ Math.random().toString(36).slice(2, 9) }`;

    // Start metrics collection
    globalLoopMetricsCollector.recordLoopStart(deploymentId);

    // Determine execution strategy
    const requiresLoop = classification.loopStrategy?.requiresLoop ?? false;

    let executionResult: unknown;
    let executionMetrics: unknown;

    if (requiresLoop) {
      // Execute with loop
      const agentContext = {
        taskId: classification.taskId,
        deploymentId,
        agentArchetype: "research-analyst", // Default; would be determined by agent matching
        taskDescription: task.description || task.title,
        complexity: classification.complexity,
        maxDurationMs: classification.estimatedDurationMinutes * 60 * 1000,
      };

      const loopResult = await executeAgentLoop(
        agentContext,
        classification.loopStrategy,
      );

      executionResult = {
        type: "loop-execution",
        finalOutput: loopResult.finalOutput,
        succeeded: loopResult.succeeded,
        iterationCount: loopResult.metrics.totalIterations,
        earlyTermination: loopResult.earlyTermination,
        terminationReason: loopResult.terminationReason,
      };

      executionMetrics = loopResult.metrics;

      globalLoopMetricsCollector.recordLoopComplete(deploymentId, loopResult.metrics);
    } else {
      // Single-pass execution
      executionResult = {
        type: "single-pass-execution",
        result: "Single-pass execution placeholder",
        succeeded: true,
      };

      executionMetrics = null;
    }

    // Build response
    const responsePayload = {
      deploymentId,
      classification,
      execution: executionResult,
      metrics: executionMetrics,
      timestamp: new Date().toISOString(),
    };

    writeJson(response, responsePayload, 200);
    return true;
  } catch (error) {
    console.error("Orchestration error:", error);
    writeJson(
      response,
      {
        error: "Orchestration failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
    return true;
  }
}
