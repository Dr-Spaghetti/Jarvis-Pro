/**
 * Orchestration Routes - Loop-Aware Task Routing
 *
 * Routes tasks based on classification: if loop strategy required, execute loop;
 * otherwise single-pass deployment.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteHandlerContext } from "../routeHelpers";
import { writeJson } from "../routeHelpers";
import { classifyTask } from "./taskClassifier";
import { executeAgentLoop } from "./execution/agentLoopExecutor";
import { globalLoopMetricsCollector } from "./metrics/loopMetricsCollector";
import type { TaskInput } from "./taskClassifier";

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
      writeJson(response, 400, { error: "Invalid payload" }, context.corsOrigin);
      return true;
    }

    const taskPayload = payload as Record<string, unknown>;
    const task: TaskInput = {
      title: String(taskPayload.title || ""),
      ...(taskPayload.description ? { description: String(taskPayload.description) } : {}),
      ...(taskPayload.domain ? { domain: String(taskPayload.domain) } : {}),
      ...(taskPayload.complexity ? { complexity: String(taskPayload.complexity) } : {}),
      ...(taskPayload.timeConstraint ? { timeConstraint: String(taskPayload.timeConstraint) } : {}),
      ...(taskPayload.qualityBar ? { qualityBar: String(taskPayload.qualityBar) } : {}),
      ...(taskPayload.estimatedDurationMinutes ? { estimatedDurationMinutes: Number(taskPayload.estimatedDurationMinutes) } : {}),
      ...(taskPayload.context ? { context: taskPayload.context as Record<string, unknown> } : {}),
    };

    if (!task.title) {
      writeJson(response, 400, { error: "Missing required field: title" }, context.corsOrigin);
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
        classification.loopStrategy!,
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

    writeJson(response, 200, responsePayload, context.corsOrigin);
    return true;
  } catch (error) {
    console.error("Orchestration error:", error);
    writeJson(
      response,
      500,
      {
        error: "Orchestration failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      context.corsOrigin,
    );
    return true;
  }
}
