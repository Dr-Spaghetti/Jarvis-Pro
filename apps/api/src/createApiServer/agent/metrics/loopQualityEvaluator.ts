/**
 * Loop Quality Evaluator
 *
 * Implements the agent-loop-efficacy gate (weight 0.15) that validates loop execution.
 * Checks: didn't exceed maxIterations, quality improved >0.1/iteration, confidence stable/improved.
 */

import type { AgentLoopMetrics } from "./loopMetricsTypes";

export interface QualityGateResult {
  passed: boolean;
  score: number; // 0-1
  checks: {
    name: string;
    passed: boolean;
    score: number;
    reason: string;
  }[];
}

const GATE_WEIGHT = 0.15; // Weight in overall quality evaluation

/**
 * Check if loop stayed within max iteration limit.
 */
function checkIterationLimit(
  metrics: AgentLoopMetrics,
): { passed: boolean; score: number; reason: string } {
  const maxAllowed = metrics.strategy.maxIterations;
  const actual = metrics.totalIterations;
  const passed = actual <= maxAllowed;

  return {
    passed,
    score: passed ? 1.0 : Math.max(0, 1 - (actual - maxAllowed) / maxAllowed),
    reason: `Used ${ actual }/${ maxAllowed } iterations (limit: ${ passed ? "OK" : "EXCEEDED" })`,
  };
}

/**
 * Check if quality improved throughout loop.
 */
function checkQualityImprovement(
  metrics: AgentLoopMetrics,
): { passed: boolean; score: number; reason: string } {
  const progression = metrics.qualityProgression;

  if (progression.length < 2) {
    return {
      passed: true,
      score: 0.5,
      reason: "Single iteration — no improvement baseline",
    };
  }

  // Calculate average improvement per iteration
  const totalImprovement = progression[progression.length - 1] - progression[0];
  const avgImprovementPerIteration = totalImprovement / (progression.length - 1);

  // Require at least 0.1 improvement per iteration on average (or flat/slight decline if starting high)
  const minAcceptableImprovement =
    progression[0] > 0.7 ? -0.05 : 0.1;
  const passed = avgImprovementPerIteration >= minAcceptableImprovement;

  const improvementScore = Math.min(
    1.0,
    Math.max(0, avgImprovementPerIteration * 5), // Scale to 0-1
  );

  return {
    passed,
    score: improvementScore,
    reason: `Quality improvement: +${ avgImprovementPerIteration.toFixed(3) }/iteration (threshold: ${ minAcceptableImprovement })`,
  };
}

/**
 * Check if confidence level remained stable or improved.
 */
function checkConfidenceStability(
  metrics: AgentLoopMetrics,
): { passed: boolean; score: number; reason: string } {
  const progression = metrics.confidenceLevelProgression;

  if (progression.length < 2) {
    return {
      passed: true,
      score: 0.5,
      reason: "Single iteration — no stability baseline",
    };
  }

  // Check for dramatic confidence drops (>0.3)
  let maxDrop = 0;
  for (let i = 1; i < progression.length; i++) {
    const drop = progression[i - 1] - progression[i];
    if (drop > maxDrop) {
      maxDrop = drop;
    }
  }

  const passed = maxDrop < 0.3; // Allow up to 0.3 drop
  const stabilityScore = Math.max(0, 1 - maxDrop);

  return {
    passed,
    score: stabilityScore,
    reason: `Max confidence drop: -${ maxDrop.toFixed(2) } (threshold: 0.3)`,
  };
}

/**
 * Check for excessive self-corrections (indicates instability).
 */
function checkSelfCorrectionRate(
  metrics: AgentLoopMetrics,
): { passed: boolean; score: number; reason: string } {
  const maxAcceptableCorrectionRate = 0.5; // Max 50% of iterations
  const correctionRate = metrics.totalSelfCorrections / Math.max(1, metrics.totalIterations);

  const passed = correctionRate <= maxAcceptableCorrectionRate;
  const score = Math.max(0, 1 - correctionRate * 2);

  return {
    passed,
    score,
    reason: `Self-correction rate: ${ (correctionRate * 100).toFixed(0) }% (threshold: 50%)`,
  };
}

/**
 * Evaluate loop against efficacy gate.
 * Returns passed/failed and detailed check results.
 */
export function evaluateLoopEfficacyGate(
  metrics: AgentLoopMetrics,
): QualityGateResult {
  const checks = [
    {
      name: "Iteration Limit",
      ...checkIterationLimit(metrics),
    },
    {
      name: "Quality Improvement",
      ...checkQualityImprovement(metrics),
    },
    {
      name: "Confidence Stability",
      ...checkConfidenceStability(metrics),
    },
    {
      name: "Self-Correction Rate",
      ...checkSelfCorrectionRate(metrics),
    },
  ];

  // Gate passes if all critical checks pass
  const passed = checks.every(c => c.passed);

  // Score is weighted average of all checks
  const avgScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;

  return {
    passed,
    score: avgScore,
    checks,
  };
}

/**
 * Describe gate results in human-readable format.
 */
export function describeGateResult(result: QualityGateResult): string {
  const status = result.passed ? "PASSED" : "FAILED";
  const scoreStr = `${ (result.score * 100).toFixed(0) }%`;

  const checkSummary = result.checks
    .map(c => `  ${ c.passed ? "✓" : "✗" } ${ c.name }: ${ c.reason }`)
    .join("\n");

  return `Loop Efficacy Gate [${ status }] ${ scoreStr }\n${ checkSummary }`;
}

/**
 * Apply gate weight to overall quality score.
 */
export function applyGateWeight(
  gateScore: number,
  otherFactorsScore: number,
  otherFactorsWeight: number,
): number {
  // Weighted average: gateScore * GATE_WEIGHT + otherFactorsScore * otherFactorsWeight
  const totalWeight = GATE_WEIGHT + otherFactorsWeight;
  return (gateScore * GATE_WEIGHT + otherFactorsScore * otherFactorsWeight) / totalWeight;
}

export { GATE_WEIGHT };
