/**
 * Agent Loop Executor
 *
 * Core loop implementation: Execute -> Reflect -> Record -> Decide -> Adapt -> Wait
 * Orchestrates iterative agent execution with quality tracking and early termination.
 */

import { AGENT_ARCHETYPES } from "../../../agentArsenal";
import type { AgentLoopMetrics, IterationSnapshot } from "../metrics/loopMetricsTypes";
import type { TaskLoopStrategy } from "../taskClassifier";
import { reflectOnIteration } from "./reflectOnIteration";

export interface AgentExecutionContext {
  taskId: string;
  deploymentId: string;
  agentArchetype: string;
  taskDescription: string;
  complexity: string;
  maxDurationMs: number;
}

export interface AgentLoopExecutorResult {
  finalOutput: unknown;
  metrics: AgentLoopMetrics;
  succeeded: boolean;
  earlyTermination: boolean;
  terminationReason: string;
}

/**
 * Execute a single iteration of agent work via Claude API.
 */
async function executeAgentIteration(
  context: AgentExecutionContext,
  iterationNum: number,
  previousOutput?: unknown,
): Promise<{ output: unknown; durationMs: number }> {
  const startTime = Date.now();

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const archetype = AGENT_ARCHETYPES.find((a) => a.id === context.agentArchetype);
  const systemPrompt =
    archetype?.systemPrompt ??
    "You are a helpful AI assistant. Complete the task thoroughly and accurately.";

  let userContent = `Task: ${context.taskDescription}`;
  if (iterationNum > 1 && previousOutput) {
    const prevStr =
      typeof previousOutput === "object" && previousOutput !== null
        ? JSON.stringify(
            (previousOutput as Record<string, unknown>).result ?? previousOutput,
            null,
            2,
          ).slice(0, 1500)
        : String(previousOutput).slice(0, 1500);
    userContent += `\n\nPrevious iteration output:\n${prevStr}\n\nThis is iteration ${iterationNum}. Refine, expand, and improve upon the previous result.`;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Agent API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const resultText = data.content?.find((c) => c.type === "text")?.text ?? "";

  return {
    output: { status: "completed", result: resultText, timestamp: new Date().toISOString() },
    durationMs,
  };
}

/**
 * Record metrics for an iteration.
 */
function recordIterationMetrics(
  iterationNum: number,
  executionTimeMs: number,
  agentOutput: unknown,
  reflection: {
    observation: string;
    qualityScore: number;
    confidenceLevel: number;
    shouldContinue: boolean;
    nextFocus?: string;
  },
  selfCorrections: string[],
  toolsUsed: string[],
): IterationSnapshot {
  return {
    iterationNumber: iterationNum,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    executionTimeMs,
    agentOutput,
    reflection,
    selfCorrections,
    toolsUsed,
  };
}

/**
 * Decide whether to continue looping based on quality metrics.
 */
function shouldContinueLoop(
  iterationNum: number,
  maxIterations: number,
  qualityProgression: number[],
  fallbackThreshold: number,
): boolean {
  if (iterationNum >= maxIterations) {
    return false;
  }

  // Check for quality degradation
  if (qualityProgression.length >= 2) {
    const lastQuality = qualityProgression[qualityProgression.length - 1]!;
    const prevQuality = qualityProgression[qualityProgression.length - 2]!;

    if (lastQuality < prevQuality - 0.15) {
      return false; // Quality dropped significantly
    }

    if (lastQuality < fallbackThreshold) {
      return false; // Quality too low
    }
  }

  return true;
}

/**
 * Adapt loop parameters based on quality trajectory.
 */
function adaptLoopParameters(
  strategy: TaskLoopStrategy,
  qualityProgression: number[],
  _iterationNum: number,
): TaskLoopStrategy {
  // If quality is consistently improving, we could be more aggressive
  if (qualityProgression.length >= 2) {
    const trend = qualityProgression[qualityProgression.length - 1]! - qualityProgression[0]!;
    if (trend > 0.2) {
      // Strong improvement — could continue longer if needed
      return {
        ...strategy,
        maxIterations: Math.min(strategy.maxIterations + 1, 8),
      };
    }
  }

  return strategy;
}

/**
 * Wait for the observation interval before the next iteration.
 */
async function waitForObservationInterval(intervalMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, intervalMs));
}

/**
 * Execute the complete agent loop: Execute → Reflect → Record → Decide → Adapt → Wait
 */
export async function executeAgentLoop(
  context: AgentExecutionContext,
  strategy: TaskLoopStrategy,
): Promise<AgentLoopExecutorResult> {
  const startTime = Date.now();
  const iterations: IterationSnapshot[] = [];
  const qualityProgression: number[] = [];
  let currentStrategy = { ...strategy };
  let finalOutput: unknown = null;
  let selfCorrectionCount = 0;

  if (!strategy.requiresLoop) {
    // Single-pass execution — skip reflection API call, use static pass score
    const { output, durationMs } = await executeAgentIteration(context, 1, undefined);
    const reflection = {
      observation: "single-pass execution completed",
      qualityScore: 0.7,
      confidenceLevel: 0.65,
      shouldContinue: false,
    };

    iterations.push(recordIterationMetrics(1, durationMs, output, reflection, [], []));

    qualityProgression.push(reflection.qualityScore);
    finalOutput = output;

    return {
      finalOutput,
      metrics: buildAgentLoopMetrics(strategy, iterations, selfCorrectionCount, 0),
      succeeded: true,
      earlyTermination: false,
      terminationReason: "single-pass execution completed",
    };
  }

  // Multi-iteration loop
  for (let iterNum = 1; iterNum <= currentStrategy.maxIterations; iterNum++) {
    // === EXECUTE ===
    const { output, durationMs } = await executeAgentIteration(context, iterNum, finalOutput);

    // === REFLECT — skip iteration 1, no baseline to compare against yet ===
    const reflection =
      iterNum === 1
        ? {
            observation: "initial iteration complete — awaiting next pass for quality assessment",
            qualityScore: 0.6,
            confidenceLevel: 0.5,
            shouldContinue: true,
          }
        : await reflectOnIteration(
            context.taskDescription,
            output,
            context,
            iterNum,
            currentStrategy.maxIterations,
          );

    qualityProgression.push(reflection.qualityScore);

    // Track self-corrections
    let selfCorrections: string[] = [];
    if (
      currentStrategy.selfCorrectionMode === "automatic" &&
      iterNum > 1 &&
      reflection.qualityScore > qualityProgression[iterNum - 2]!
    ) {
      selfCorrections = ["quality improved — continuation justified"];
      selfCorrectionCount += 1;
    }

    // === RECORD ===
    const snapshot = recordIterationMetrics(
      iterNum,
      durationMs,
      output,
      reflection,
      selfCorrections,
      [],
    );
    iterations.push(snapshot);

    finalOutput = output;

    // === DECIDE ===
    const shouldContinue = shouldContinueLoop(
      iterNum,
      currentStrategy.maxIterations,
      qualityProgression,
      currentStrategy.fallbackThreshold,
    );

    if (!shouldContinue && iterNum < currentStrategy.maxIterations) {
      return {
        finalOutput,
        metrics: buildAgentLoopMetrics(strategy, iterations, selfCorrectionCount, 0),
        succeeded: reflection.qualityScore > 0.6,
        earlyTermination: true,
        terminationReason: `Quality-based early termination at iteration ${iterNum}`,
      };
    }

    if (iterNum < currentStrategy.maxIterations) {
      // === ADAPT ===
      currentStrategy = adaptLoopParameters(currentStrategy, qualityProgression, iterNum);

      // === WAIT ===
      await waitForObservationInterval(currentStrategy.observationIntervalMs);
    }
  }

  return {
    finalOutput,
    metrics: buildAgentLoopMetrics(strategy, iterations, selfCorrectionCount, 0),
    succeeded: (qualityProgression[qualityProgression.length - 1] ?? 0) > 0.6,
    earlyTermination: false,
    terminationReason: `Completed all ${currentStrategy.maxIterations} iterations`,
  };
}

/**
 * Build metrics object from loop execution data.
 */
function buildAgentLoopMetrics(
  strategy: TaskLoopStrategy,
  iterations: IterationSnapshot[],
  selfCorrectionCount: number,
  _reflectionQualityAvg: number,
): AgentLoopMetrics {
  const qualityProgression = iterations.map((it) => it.reflection.qualityScore);
  const confidenceProgression = iterations.map((it) => it.reflection.confidenceLevel);

  return {
    strategy,
    totalIterations: iterations.length,
    iterations,
    totalSelfCorrections: selfCorrectionCount,
    reflectionQualityAvg:
      qualityProgression.reduce((a, b) => a + b, 0) / Math.max(1, qualityProgression.length),
    confidenceLevelProgression: confidenceProgression,
    qualityProgression,
    finalConfidence: confidenceProgression[confidenceProgression.length - 1] || 0,
    finalQuality: qualityProgression[qualityProgression.length - 1] || 0,
  };
}
