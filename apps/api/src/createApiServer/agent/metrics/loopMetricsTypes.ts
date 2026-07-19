/**
 * Loop Metrics Types
 *
 * Core types for tracking iteration snapshots and aggregate loop metrics.
 */

import type { TaskLoopStrategy } from "../taskClassifier";

/**
 * Snapshot of a single iteration within a loop.
 */
export interface IterationSnapshot {
  iterationNumber: number;
  startedAt: string; // ISO8601
  completedAt: string; // ISO8601
  executionTimeMs: number;
  agentOutput: unknown;
  reflection: {
    observation: string;
    qualityScore: number; // 0-1
    confidenceLevel: number; // 0-1
    shouldContinue: boolean;
    nextFocus?: string;
  };
  selfCorrections: string[];
  toolsUsed: string[];
}

/**
 * Aggregate metrics for a complete loop execution.
 */
export interface AgentLoopMetrics {
  strategy: TaskLoopStrategy;
  totalIterations: number;
  iterations: IterationSnapshot[];
  totalSelfCorrections: number;
  reflectionQualityAvg: number; // Average of all iteration reflection qualities
  confidenceLevelProgression: number[];
  qualityProgression: number[];
  finalConfidence: number;
  finalQuality: number;
}

/**
 * Extended agent deployment metrics including loop data.
 */
export interface AgentDeploymentMetricsWithLoops {
  deploymentId: string;
  agentId: string;
  taskId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  agentLoopMetrics?: AgentLoopMetrics;
}
