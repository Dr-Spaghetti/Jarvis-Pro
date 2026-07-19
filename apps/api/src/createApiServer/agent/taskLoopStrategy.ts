/**
 * Task Loop Strategy Module
 *
 * Determines if a task requires iterative execution and configures loop parameters.
 * Provides auto-tuning based on task characteristics and domain patterns.
 */

import type { TaskClassification, TaskLoopStrategy } from "./taskClassifier";

/**
 * Domain-specific loop parameter overrides.
 * Used to fine-tune loop behavior for known domain patterns.
 */
const DOMAIN_LOOP_PROFILES: Record<string, Partial<TaskLoopStrategy>> = {
  research: {
    reflectionDepth: "deep",
    maxIterations: 5,
    fallbackThreshold: 0.2,
    selfCorrectionMode: "automatic",
  },
  analysis: {
    reflectionDepth: "deep",
    maxIterations: 4,
    fallbackThreshold: 0.25,
    selfCorrectionMode: "automatic",
  },
  engineering: {
    reflectionDepth: "medium",
    maxIterations: 3,
    fallbackThreshold: 0.3,
    selfCorrectionMode: "automatic",
  },
  content: {
    reflectionDepth: "medium",
    maxIterations: 2,
    fallbackThreshold: 0.4,
    selfCorrectionMode: "prompted",
  },
  strategy: {
    reflectionDepth: "deep",
    maxIterations: 3,
    fallbackThreshold: 0.3,
    selfCorrectionMode: "prompted",
  },
  operations: {
    reflectionDepth: "shallow",
    maxIterations: 2,
    fallbackThreshold: 0.5,
    selfCorrectionMode: "disabled",
  },
  creative: {
    reflectionDepth: "medium",
    maxIterations: 3,
    fallbackThreshold: 0.35,
    selfCorrectionMode: "prompted",
  },
  planning: {
    reflectionDepth: "medium",
    maxIterations: 2,
    fallbackThreshold: 0.4,
    selfCorrectionMode: "prompted",
  },
};

/**
 * Complexity-based max iteration adjustments.
 * Applied as multipliers to domain base values.
 */
const COMPLEXITY_ITERATION_MULTIPLIERS: Record<string, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.5,
  expert: 2.0,
};

/**
 * Time constraint adjustments to observation intervals.
 */
const TIME_CONSTRAINT_MULTIPLIERS: Record<string, number> = {
  immediate: 0.5, // Fast feedback loop
  standard: 1.0,
  flexible: 2.0, // Slower, more thorough reflection
  unknown: 1.0,
};

/**
 * Determine if a task requires iterative execution.
 * Tasks requiring iteration have multiple rounds of execution, reflection, and adaptation.
 */
export function requiresIterativeExecution(classification: TaskClassification): boolean {
  const { complexity, domain, requiresIteration } = classification;

  // High/expert complexity with iterative-friendly domains
  const iterativeDomains = ["research", "analysis", "engineering"];
  const domainMatch = iterativeDomains.includes(domain);

  if ((complexity === "high" || complexity === "expert") && domainMatch) {
    return true;
  }

  // Explicit iteration requirement from classification
  if (requiresIteration) {
    return true;
  }

  // Production-critical quality bar implies higher iteration threshold
  if (classification.qualityBar === "production-critical" && complexity !== "low") {
    return true;
  }

  return false;
}

/**
 * Get domain-specific loop parameters.
 */
function getDomainProfile(domain: string): Partial<TaskLoopStrategy> {
  return DOMAIN_LOOP_PROFILES[domain] || {};
}

/**
 * Apply complexity adjustments to iteration count.
 */
function applyComplexityAdjustment(
  baseIterations: number,
  complexity: string,
): number {
  const multiplier = COMPLEXITY_ITERATION_MULTIPLIERS[complexity] || 1.0;
  return Math.ceil(baseIterations * multiplier);
}

/**
 * Apply time constraint adjustments to observation interval.
 */
function applyTimeConstraintAdjustment(
  baseIntervalMs: number,
  timeConstraint: string,
): number {
  const multiplier = TIME_CONSTRAINT_MULTIPLIERS[timeConstraint] || 1.0;
  return Math.round(baseIntervalMs * multiplier);
}

/**
 * Calculate quality-based fallback threshold.
 * Lower threshold = more aggressive continuation despite quality dips.
 */
function calculateFallbackThreshold(
  classification: TaskClassification,
): number {
  const { qualityBar, complexity } = classification;

  // Production-critical tasks are more tolerant of quality dips (continue longer)
  if (qualityBar === "production-critical") {
    return complexity === "expert" ? 0.1 : 0.2;
  }

  // Excellent quality bar is less tolerant (stop earlier)
  if (qualityBar === "excellent") {
    return complexity === "expert" ? 0.3 : 0.4;
  }

  // Default based on complexity
  if (complexity === "expert") return 0.2;
  if (complexity === "high") return 0.3;
  if (complexity === "medium") return 0.4;
  return 0.5;
}

/**
 * Build a complete loop strategy for a task.
 * Combines domain profiles, complexity adjustments, and time constraints.
 */
export function buildLoopStrategy(
  classification: TaskClassification,
): TaskLoopStrategy {
  const domainProfile = getDomainProfile(classification.domain);
  const baseMaxIterations = domainProfile.maxIterations || 2;
  const adjustedMaxIterations = applyComplexityAdjustment(
    baseMaxIterations,
    classification.complexity,
  );

  const baseObservationMs = 5000; // 5 seconds default
  const adjustedObservationMs = applyTimeConstraintAdjustment(
    baseObservationMs,
    classification.timeConstraint,
  );

  const fallbackThreshold = calculateFallbackThreshold(classification);

  return {
    requiresLoop: requiresIterativeExecution(classification),
    maxIterations: Math.max(1, adjustedMaxIterations),
    fallbackThreshold,
    observationIntervalMs: Math.max(1000, adjustedObservationMs), // Min 1 second
    reflectionDepth: domainProfile.reflectionDepth || "medium",
    selfCorrectionMode: domainProfile.selfCorrectionMode || "prompted",
  };
}

/**
 * Calculate the total estimated time for a looped task.
 */
export function estimateLoopTotalTime(
  baseEstimateMinutes: number,
  loopStrategy: TaskLoopStrategy,
): number {
  // Iterative tasks take longer due to reflection overhead
  if (!loopStrategy.requiresLoop) {
    return baseEstimateMinutes;
  }

  // Each iteration adds reflection time (~30-50% of base execution time per iteration)
  const reflectionOverhead =
    loopStrategy.reflectionDepth === "deep"
      ? 0.5
      : loopStrategy.reflectionDepth === "medium"
        ? 0.35
        : 0.2;

  const totalIterations = loopStrategy.maxIterations;
  const iterationCost = baseEstimateMinutes * (1 + reflectionOverhead);

  return iterationCost * totalIterations;
}

/**
 * Determine if loop should terminate early based on quality progression.
 */
export function shouldTerminateLoopEarly(
  iteration: number,
  maxIterations: number,
  qualityProgression: number[], // Array of quality scores 0-1 per iteration
  fallbackThreshold: number,
): boolean {
  if (iteration >= maxIterations) {
    return true;
  }

  if (qualityProgression.length < 2) {
    return false;
  }

  // If quality is decreasing significantly, stop
  const recentQualityDelta = qualityProgression[qualityProgression.length - 1] - qualityProgression[qualityProgression.length - 2];
  if (recentQualityDelta < -0.15) {
    return true;
  }

  // If we've hit the fallback threshold (quality too low), stop
  const currentQuality = qualityProgression[qualityProgression.length - 1];
  if (currentQuality < fallbackThreshold) {
    return true;
  }

  // If quality is high and stable (>0.85 for 2 iterations), stop
  if (qualityProgression.length >= 2) {
    const recent = qualityProgression.slice(-2);
    if (recent.every(q => q > 0.85) && Math.abs(recent[1] - recent[0]) < 0.05) {
      return true;
    }
  }

  return false;
}

/**
 * Get a human-readable description of the loop strategy.
 */
export function describeLoopStrategy(strategy: TaskLoopStrategy): string {
  if (!strategy.requiresLoop) {
    return "No iteration required (single-pass execution)";
  }

  const lines = [
    `Iterative execution with up to ${ strategy.maxIterations } iterations`,
    `Reflection depth: ${ strategy.reflectionDepth }`,
    `Self-correction: ${ strategy.selfCorrectionMode }`,
    `Observation interval: ${ strategy.observationIntervalMs }ms`,
    `Quality fallback threshold: ${ (strategy.fallbackThreshold * 100).toFixed(0) }%`,
  ];

  return lines.join(" | ");
}
