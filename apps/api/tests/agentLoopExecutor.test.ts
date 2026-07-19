import { describe, it, expect, beforeEach } from "vitest";
import {
  executeAgentLoop,
  type AgentExecutionContext,
} from "../src/createApiServer/agent/execution/agentLoopExecutor";
import { reflectOnIteration } from "../src/createApiServer/agent/execution/reflectOnIteration";
import { globalLoopMetricsCollector } from "../src/createApiServer/agent/metrics/loopMetricsCollector";
import type { TaskLoopStrategy } from "../src/createApiServer/agent/taskClassifier";

const mockContext: AgentExecutionContext = {
  taskId: "test-task",
  deploymentId: "test-deployment-001",
  agentArchetype: "research-analyst",
  taskDescription: "Test research task",
  complexity: "high",
  maxDurationMs: 60000,
};

const mockStrategy: TaskLoopStrategy = {
  requiresLoop: true,
  maxIterations: 3,
  fallbackThreshold: 0.3,
  observationIntervalMs: 100,
  reflectionDepth: "medium",
  selfCorrectionMode: "automatic",
};

describe("Agent Loop Executor", () => {
  beforeEach(() => {
    globalLoopMetricsCollector.clear();
  });

  describe("executeAgentLoop", () => {
    it("executes single-pass loop when requiresLoop is false", async () => {
      const nonLoopStrategy: TaskLoopStrategy = {
        ...mockStrategy,
        requiresLoop: false,
        maxIterations: 1,
      };

      const result = await executeAgentLoop(mockContext, nonLoopStrategy);

      expect(result.succeeded).toBe(true);
      expect(result.metrics.totalIterations).toBe(1);
      expect(result.earlyTermination).toBe(false);
    });

    it("executes multi-iteration loop", async () => {
      const result = await executeAgentLoop(mockContext, mockStrategy);

      expect(result.metrics.totalIterations).toBeGreaterThan(1);
      expect(result.metrics.qualityProgression).toBeDefined();
      expect(result.metrics.qualityProgression.length).toBeGreaterThan(0);
    });

    it("tracks quality progression across iterations", async () => {
      const result = await executeAgentLoop(mockContext, mockStrategy);

      const { qualityProgression } = result.metrics;
      expect(qualityProgression.length).toBe(result.metrics.totalIterations);
      expect(qualityProgression.every(q => q >= 0 && q <= 1)).toBe(true);
    });

    it("returns metrics with proper structure", async () => {
      const result = await executeAgentLoop(mockContext, mockStrategy);

      expect(result.metrics).toHaveProperty("strategy");
      expect(result.metrics).toHaveProperty("totalIterations");
      expect(result.metrics).toHaveProperty("iterations");
      expect(result.metrics).toHaveProperty("qualityProgression");
      expect(result.metrics).toHaveProperty("confidenceLevelProgression");
      expect(result.metrics).toHaveProperty("finalQuality");
      expect(result.metrics).toHaveProperty("finalConfidence");
    });

    it("records final output", async () => {
      const result = await executeAgentLoop(mockContext, mockStrategy);

      expect(result.finalOutput).toBeDefined();
      expect(result.finalOutput).not.toBeNull();
    });

    it("indicates success based on final quality score", async () => {
      const result = await executeAgentLoop(mockContext, mockStrategy);

      const finalQuality = result.metrics.qualityProgression[
        result.metrics.qualityProgression.length - 1
      ];
      const expectedSuccess = finalQuality > 0.6;
      expect(result.succeeded).toBe(expectedSuccess);
    });

    it("respects max iteration limit", async () => {
      const strategyWithLimit: TaskLoopStrategy = {
        ...mockStrategy,
        maxIterations: 2,
      };

      const result = await executeAgentLoop(mockContext, strategyWithLimit);

      expect(result.metrics.totalIterations).toBeLessThanOrEqual(2);
    });

    it("can terminate early with reason", async () => {
      const result = await executeAgentLoop(mockContext, mockStrategy);

      if (result.earlyTermination) {
        expect(result.terminationReason).toBeTruthy();
        expect(result.terminationReason).toMatch(/early termination|Completed/);
      }
    });
  });
});

describe("Reflection Module", () => {
  describe("reflectOnIteration", () => {
    it("returns valid reflection result", async () => {
      const result = await reflectOnIteration(
        "Test task",
        { status: "completed" },
        mockContext,
        1,
        3,
      );

      expect(result).toHaveProperty("observation");
      expect(result).toHaveProperty("qualityScore");
      expect(result).toHaveProperty("confidenceLevel");
      expect(result).toHaveProperty("shouldContinue");
    });

    it("returns quality score in valid range", async () => {
      const result = await reflectOnIteration(
        "Test task",
        { status: "completed" },
        mockContext,
        1,
        3,
      );

      expect(result.qualityScore).toBeGreaterThanOrEqual(0);
      expect(result.qualityScore).toBeLessThanOrEqual(1);
    });

    it("returns confidence level in valid range", async () => {
      const result = await reflectOnIteration(
        "Test task",
        { status: "completed" },
        mockContext,
        2,
        3,
      );

      expect(result.confidenceLevel).toBeGreaterThanOrEqual(0);
      expect(result.confidenceLevel).toBeLessThanOrEqual(1);
    });

    it("provides observation text", async () => {
      const result = await reflectOnIteration(
        "Test task",
        { status: "completed" },
        mockContext,
        1,
        3,
      );

      expect(result.observation).toBeTruthy();
      expect(result.observation.length).toBeGreaterThan(0);
    });

    it("handles different iteration numbers", async () => {
      const result1 = await reflectOnIteration(
        "Test task",
        { status: "in progress" },
        mockContext,
        1,
        3,
      );

      const result2 = await reflectOnIteration(
        "Test task",
        { status: "refined" },
        mockContext,
        2,
        3,
      );

      expect(result1.qualityScore).not.toEqual(result2.qualityScore);
    });
  });
});

describe("Loop Metrics Collector", () => {
  beforeEach(() => {
    globalLoopMetricsCollector.clear();
  });

  it("records loop start", () => {
    globalLoopMetricsCollector.recordLoopStart("deployment-1");
    const stats = globalLoopMetricsCollector.getStatistics();

    expect(stats.activeCount).toBe(1);
  });

  it("records loop completion", async () => {
    const result = await executeAgentLoop(mockContext, mockStrategy);

    globalLoopMetricsCollector.recordLoopStart(mockContext.deploymentId);
    globalLoopMetricsCollector.recordLoopComplete(
      mockContext.deploymentId,
      result.metrics,
    );

    const stats = globalLoopMetricsCollector.getStatistics();
    expect(stats.completedCount).toBe(1);
  });

  it("calculates average iterations", async () => {
    const result = await executeAgentLoop(mockContext, mockStrategy);

    globalLoopMetricsCollector.recordLoopComplete(
      mockContext.deploymentId,
      result.metrics,
    );

    const stats = globalLoopMetricsCollector.getStatistics();
    expect(stats.averageIterations).toBeGreaterThan(0);
  });

  it("calculates average quality", async () => {
    const result = await executeAgentLoop(mockContext, mockStrategy);

    globalLoopMetricsCollector.recordLoopComplete(
      mockContext.deploymentId,
      result.metrics,
    );

    const stats = globalLoopMetricsCollector.getStatistics();
    expect(stats.averageQuality).toBeGreaterThan(0);
    expect(stats.averageQuality).toBeLessThanOrEqual(1);
  });

  it("clears metrics", () => {
    globalLoopMetricsCollector.recordLoopStart("deployment-1");
    globalLoopMetricsCollector.clear();

    const stats = globalLoopMetricsCollector.getStatistics();
    expect(stats.activeCount).toBe(0);
    expect(stats.completedCount).toBe(0);
  });
});
