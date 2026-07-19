import { describe, it, expect, beforeEach } from "vitest";
import { classifyTask } from "../createApiServer/agent/taskClassifier";
import { executeAgentLoop } from "../createApiServer/agent/execution/agentLoopExecutor";
import { globalLoopMetricsCollector } from "../createApiServer/agent/metrics/loopMetricsCollector";
import { evaluateLoopEfficacyGate } from "../createApiServer/agent/metrics/loopQualityEvaluator";
import type { TaskInput } from "../createApiServer/agent/taskClassifier";

describe("Orchestration Loop E2E", () => {
  beforeEach(() => {
    globalLoopMetricsCollector.clear();
  });

  describe("Task Classification -> Loop Execution -> Metrics", () => {
    it("classifies task and executes loop if needed", async () => {
      const task: TaskInput = {
        title: "Research new framework",
        description: "Investigate distributed systems",
        domain: "research",
        complexity: "high",
      };

      const classification = classifyTask(task);
      expect(classification.loopStrategy?.requiresLoop).toBe(true);

      const context = {
        taskId: classification.taskId,
        deploymentId: "test-deployment",
        agentArchetype: "research-analyst" as const,
        taskDescription: task.description || task.title,
        complexity: classification.complexity,
        maxDurationMs: 60000,
      };

      const result = await executeAgentLoop(context, classification.loopStrategy!);

      expect(result.succeeded).toBe(true);
      expect(result.metrics.totalIterations).toBeGreaterThan(1);
    });

    it("skips loop for simple tasks", async () => {
      const task: TaskInput = {
        title: "Simple fix",
        description: "Minor change",
        complexity: "low",
      };

      const classification = classifyTask(task);
      expect(classification.loopStrategy?.requiresLoop).toBe(false);
      expect(classification.loopStrategy?.maxIterations).toBe(1);
    });

    it("records metrics through full pipeline", async () => {
      const task: TaskInput = {
        title: "Analysis task",
        domain: "analysis",
        complexity: "high",
      };

      const classification = classifyTask(task);

      const deploymentId = "metrics-test-deployment";
      globalLoopMetricsCollector.recordLoopStart(deploymentId);

      const context = {
        taskId: classification.taskId,
        deploymentId,
        agentArchetype: "research-analyst" as const,
        taskDescription: task.description || task.title,
        complexity: classification.complexity,
        maxDurationMs: 60000,
      };

      const result = await executeAgentLoop(context, classification.loopStrategy!);
      globalLoopMetricsCollector.recordLoopComplete(deploymentId, result.metrics);

      const stats = globalLoopMetricsCollector.getStatistics();
      expect(stats.completedCount).toBe(1);
      expect(stats.averageIterations).toBeGreaterThan(0);
    });

    it("evaluates quality gate on completed loop", async () => {
      const task: TaskInput = {
        title: "Engineering task",
        domain: "engineering",
        complexity: "high",
      };

      const classification = classifyTask(task);

      const context = {
        taskId: classification.taskId,
        deploymentId: "gate-test-deployment",
        agentArchetype: "senior-developer" as const,
        taskDescription: task.description || task.title,
        complexity: classification.complexity,
        maxDurationMs: 60000,
      };

      const result = await executeAgentLoop(context, classification.loopStrategy!);

      const gateResult = evaluateLoopEfficacyGate(result.metrics);

      expect(gateResult).toHaveProperty("passed");
      expect(gateResult).toHaveProperty("score");
      expect(gateResult).toHaveProperty("checks");
      expect(gateResult.score).toBeGreaterThanOrEqual(0);
      expect(gateResult.score).toBeLessThanOrEqual(1);
    });
  });

  describe("End-to-End Task Flow", () => {
    it("processes research task through full pipeline", async () => {
      const task: TaskInput = {
        title: "Investigate blockchain scalability",
        description: "Evaluate different blockchain scaling solutions",
        domain: "research",
        complexity: "expert",
        timeConstraint: "flexible",
        qualityBar: "excellent",
      };

      // Step 1: Classify
      const classification = classifyTask(task);

      expect(classification.domain).toBe("research");
      expect(classification.complexity).toBe("expert");
      expect(classification.loopStrategy?.requiresLoop).toBe(true);
      expect(classification.loopStrategy?.maxIterations).toBeGreaterThanOrEqual(3);

      // Step 2: Execute loop
      const deploymentId = `pipeline-test-${ Date.now() }`;
      const context = {
        taskId: classification.taskId,
        deploymentId,
        agentArchetype: "research-analyst" as const,
        taskDescription: task.description || task.title,
        complexity: classification.complexity,
        maxDurationMs: 120000,
      };

      globalLoopMetricsCollector.recordLoopStart(deploymentId);

      const executionResult = await executeAgentLoop(context, classification.loopStrategy!);

      // Step 3: Record metrics
      globalLoopMetricsCollector.recordLoopComplete(deploymentId, executionResult.metrics);

      // Step 4: Evaluate quality
      const gateResult = evaluateLoopEfficacyGate(executionResult.metrics);

      // Verify results
      expect(executionResult.succeeded).toBe(true);
      expect(executionResult.metrics.totalIterations).toBeGreaterThan(1);
      expect(executionResult.metrics.qualityProgression.length).toBe(
        executionResult.metrics.totalIterations,
      );

      const stats = globalLoopMetricsCollector.getStatistics();
      expect(stats.completedCount).toBe(1);
      expect(stats.averageIterations).toBeGreaterThan(1);
      expect(stats.averageQuality).toBeGreaterThan(0.5);

      expect(gateResult.score).toBeGreaterThan(0);
    });

    it("processes engineering task through full pipeline", async () => {
      const task: TaskInput = {
        title: "Refactor critical API module",
        description: "Refactor authentication module for microservices",
        domain: "engineering",
        complexity: "high",
        timeConstraint: "standard",
        qualityBar: "production-critical",
      };

      const classification = classifyTask(task);

      expect(classification.domain).toBe("engineering");
      expect(classification.complexity).toBe("high");

      if (classification.loopStrategy?.requiresLoop) {
        const deploymentId = "engineering-e2e-test";
        globalLoopMetricsCollector.recordLoopStart(deploymentId);

        const context = {
          taskId: classification.taskId,
          deploymentId,
          agentArchetype: "senior-developer" as const,
          taskDescription: task.description || task.title,
          complexity: classification.complexity,
          maxDurationMs: 60000,
        };

        const result = await executeAgentLoop(context, classification.loopStrategy);
        globalLoopMetricsCollector.recordLoopComplete(deploymentId, result.metrics);

        const gateResult = evaluateLoopEfficacyGate(result.metrics);
        expect(gateResult).toBeDefined();
      }
    });
  });

  describe("Multi-Task Pipeline", () => {
    it("processes multiple tasks with independent metrics", async () => {
      const tasks: TaskInput[] = [
        {
          title: "Task 1 - Research",
          domain: "research",
          complexity: "high",
        },
        {
          title: "Task 2 - Engineering",
          domain: "engineering",
          complexity: "medium",
        },
        {
          title: "Task 3 - Analysis",
          domain: "analysis",
          complexity: "high",
        },
      ];

      for (const task of tasks) {
        const classification = classifyTask(task);
        const deploymentId = `multi-task-${ task.title.replace(/\s/g, "-") }`;

        globalLoopMetricsCollector.recordLoopStart(deploymentId);

        const context = {
          taskId: classification.taskId,
          deploymentId,
          agentArchetype: "research-analyst" as const,
          taskDescription: task.description || task.title,
          complexity: classification.complexity,
          maxDurationMs: 60000,
        };

        if (classification.loopStrategy?.requiresLoop) {
          const result = await executeAgentLoop(context, classification.loopStrategy);
          globalLoopMetricsCollector.recordLoopComplete(deploymentId, result.metrics);
        }
      }

      const stats = globalLoopMetricsCollector.getStatistics();
      expect(stats.completedCount).toBeGreaterThan(0);
      expect(stats.completedCount).toBeLessThanOrEqual(tasks.length);
    });
  });
});
