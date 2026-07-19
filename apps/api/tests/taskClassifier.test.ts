import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyTask,
  generateTaskHash,
  clearClassificationCache,
  getClassificationCacheStats,
  determineLoopStrategy,
  type TaskInput,
} from "../src/createApiServer/agent/taskClassifier";
import {
  buildLoopStrategy,
  requiresIterativeExecution,
  estimateLoopTotalTime,
  shouldTerminateLoopEarly,
  describeLoopStrategy,
} from "../src/createApiServer/agent/taskLoopStrategy";

describe("Task Classifier", () => {
  beforeEach(() => {
    clearClassificationCache();
  });

  describe("generateTaskHash", () => {
    it("generates consistent hashes for same input", () => {
      const task: TaskInput = {
        title: "Implement API endpoint",
        description: "Build REST API for user management",
      };

      const hash1 = generateTaskHash(task);
      const hash2 = generateTaskHash(task);

      expect(hash1).toBe(hash2);
    });

    it("generates different hashes for different inputs", () => {
      const task1: TaskInput = { title: "Task 1" };
      const task2: TaskInput = { title: "Task 2" };

      const hash1 = generateTaskHash(task1);
      const hash2 = generateTaskHash(task2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("classifyTask - domain detection", () => {
    it("detects engineering domain", () => {
      const task: TaskInput = {
        title: "Implement API endpoint",
        description: "Build REST API for user management",
      };

      const classification = classifyTask(task);

      expect(classification.domain).toBe("engineering");
    });

    it("detects analysis domain", () => {
      const task: TaskInput = {
        title: "Analyze performance metrics",
        description: "Evaluate system performance data",
      };

      const classification = classifyTask(task);

      expect(classification.domain).toBe("analysis");
    });

    it("detects content domain", () => {
      const task: TaskInput = {
        title: "Write blog post",
        description: "Create documentation article",
      };

      const classification = classifyTask(task);

      expect(classification.domain).toBe("content");
    });

    it("detects research domain", () => {
      const task: TaskInput = {
        title: "Explore new technology",
        description: "Investigate proof of concept for blockchain",
      };

      const classification = classifyTask(task);

      expect(classification.domain).toBe("research");
    });

    it("respects explicit domain override", () => {
      const task: TaskInput = {
        title: "Generic task",
        domain: "strategy",
      };

      const classification = classifyTask(task);

      expect(classification.domain).toBe("strategy");
    });
  });

  describe("classifyTask - complexity detection", () => {
    it("detects low complexity", () => {
      const task: TaskInput = {
        title: "Simple minor fix",
        description: "Quick straightforward change",
      };

      const classification = classifyTask(task);

      expect(classification.complexity).toBe("low");
    });

    it("detects medium complexity", () => {
      const task: TaskInput = {
        title: "Add new feature",
        description: "Moderate scope feature with some dependencies",
      };

      const classification = classifyTask(task);

      expect(classification.complexity).toBe("medium");
    });

    it("detects high complexity", () => {
      const task: TaskInput = {
        title: "Refactor architecture",
        description: "Complex integration across multiple services with dependencies",
      };

      const classification = classifyTask(task);

      expect(classification.complexity).toBe("high");
    });

    it("detects expert complexity", () => {
      const task: TaskInput = {
        title: "Build distributed system",
        description:
          "Implement machine learning pipeline with cross-service integration in an unclear and ambiguous domain",
      };

      const classification = classifyTask(task);

      expect(classification.complexity).toBe("expert");
    });
  });

  describe("classifyTask - time constraint detection", () => {
    it("detects immediate constraint", () => {
      const task: TaskInput = {
        title: "Critical blocker",
        description: "Fix this ASAP, urgent production issue",
      };

      const classification = classifyTask(task);

      expect(classification.timeConstraint).toBe("immediate");
    });

    it("detects standard constraint", () => {
      const task: TaskInput = {
        title: "Sprint task",
        description: "Complete by end of day",
      };

      const classification = classifyTask(task);

      expect(classification.timeConstraint).toBe("standard");
    });

    it("detects flexible constraint", () => {
      const task: TaskInput = {
        title: "Backlog item",
        description: "Complete whenever ready, no deadline",
      };

      const classification = classifyTask(task);

      expect(classification.timeConstraint).toBe("flexible");
    });
  });

  describe("classifyTask - quality bar detection", () => {
    it("detects production-critical", () => {
      const task: TaskInput = {
        title: "Security compliance task",
        description: "Production security release with critical implications",
      };

      const classification = classifyTask(task);

      expect(classification.qualityBar).toBe("production-critical");
    });

    it("detects excellent quality bar", () => {
      const task: TaskInput = {
        title: "Polish UI",
        description: "Create excellent refined design",
      };

      const classification = classifyTask(task);

      expect(classification.qualityBar).toBe("excellent");
    });

    it("detects acceptable quality bar", () => {
      const task: TaskInput = {
        title: "Quick fix",
        description: "Simple task",
      };

      const classification = classifyTask(task);

      expect(classification.qualityBar).toBe("acceptable");
    });
  });

  describe("classifyTask - caching", () => {
    it("caches classification results", () => {
      const task: TaskInput = { title: "Test task" };

      const classification1 = classifyTask(task);
      const cacheStatsBefore = getClassificationCacheStats();

      const classification2 = classifyTask(task);
      const cacheStatsAfter = getClassificationCacheStats();

      expect(cacheStatsBefore.size).toBe(1);
      expect(cacheStatsAfter.size).toBe(1);
      expect(classification1).toBe(classification2); // Same object from cache
    });

    it("clears cache", () => {
      classifyTask({ title: "Task 1" });
      classifyTask({ title: "Task 2" });

      let stats = getClassificationCacheStats();
      expect(stats.size).toBe(2);

      clearClassificationCache();

      stats = getClassificationCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("determineLoopStrategy", () => {
    it("recommends loops for high-complexity research tasks", () => {
      const task: TaskInput = {
        title: "Research new framework",
        description: "Investigate distributed systems",
        complexity: "high",
      };

      const classification = classifyTask(task);
      const loopStrategy = determineLoopStrategy(classification);

      expect(loopStrategy.requiresLoop).toBe(true);
      expect(loopStrategy.maxIterations).toBeGreaterThan(1);
    });

    it("recommends no loops for low-complexity tasks", () => {
      const task: TaskInput = {
        title: "Simple fix",
        description: "Minor change",
        complexity: "low",
      };

      const classification = classifyTask(task);
      const loopStrategy = determineLoopStrategy(classification);

      expect(loopStrategy.requiresLoop).toBe(false);
      expect(loopStrategy.maxIterations).toBe(1);
    });

    it("increases max iterations for expert complexity", () => {
      const task: TaskInput = {
        title: "Complex research",
        description: "Investigate distributed systems in an uncertain domain",
        complexity: "expert",
      };

      const classification = classifyTask(task);
      const loopStrategy = determineLoopStrategy(classification);

      expect(loopStrategy.maxIterations).toBe(5);
    });

    it("adjusts observation interval based on time constraint", () => {
      const immediateTask: TaskInput = {
        title: "Urgent task",
        description: "ASAP",
      };
      const flexibleTask: TaskInput = {
        title: "Flexible task",
        description: "Whenever ready",
      };

      const immediateCls = classifyTask(immediateTask);
      const flexibleCls = classifyTask(flexibleTask);

      const immediateLoop = determineLoopStrategy(immediateCls);
      const flexibleLoop = determineLoopStrategy(flexibleCls);

      expect(immediateLoop.observationIntervalMs).toBeLessThan(flexibleLoop.observationIntervalMs);
    });
  });
});

describe("Task Loop Strategy", () => {
  describe("buildLoopStrategy", () => {
    it("builds complete loop strategy from classification", () => {
      const task: TaskInput = {
        title: "Research task",
        complexity: "high",
      };

      const classification = classifyTask(task);
      const strategy = buildLoopStrategy(classification);

      expect(strategy).toHaveProperty("requiresLoop");
      expect(strategy).toHaveProperty("maxIterations");
      expect(strategy).toHaveProperty("fallbackThreshold");
      expect(strategy).toHaveProperty("observationIntervalMs");
      expect(strategy).toHaveProperty("reflectionDepth");
      expect(strategy).toHaveProperty("selfCorrectionMode");
    });

    it("applies domain-specific profiles", () => {
      const researchTask: TaskInput = {
        title: "Research something",
        domain: "research",
        complexity: "high",
      };
      const operationsTask: TaskInput = {
        title: "Deploy application",
        domain: "operations",
        complexity: "high",
      };

      const researchCls = classifyTask(researchTask);
      const operationsCls = classifyTask(operationsTask);

      const researchStrategy = buildLoopStrategy(researchCls);
      const operationsStrategy = buildLoopStrategy(operationsCls);

      expect(researchStrategy.reflectionDepth).toBe("deep");
      expect(operationsStrategy.reflectionDepth).toBe("shallow");
    });
  });

  describe("requiresIterativeExecution", () => {
    it("returns true for high-complexity analysis tasks", () => {
      const task: TaskInput = {
        title: "Analyze metrics",
        domain: "analysis",
        complexity: "high",
      };

      const classification = classifyTask(task);
      const requiresIteration = requiresIterativeExecution(classification);

      expect(requiresIteration).toBe(true);
    });

    it("returns true for production-critical high-complexity tasks", () => {
      const task: TaskInput = {
        title: "Critical deployment",
        complexity: "high",
        qualityBar: "production-critical",
      };

      const classification = classifyTask(task);
      const requiresIteration = requiresIterativeExecution(classification);

      expect(requiresIteration).toBe(true);
    });

    it("returns false for low-complexity tasks", () => {
      const task: TaskInput = {
        title: "Simple task",
        complexity: "low",
      };

      const classification = classifyTask(task);
      const requiresIteration = requiresIterativeExecution(classification);

      expect(requiresIteration).toBe(false);
    });
  });

  describe("estimateLoopTotalTime", () => {
    it("returns base time for non-iterative tasks", () => {
      const task: TaskInput = {
        title: "Simple task",
        complexity: "low",
      };

      const classification = classifyTask(task);
      const strategy = buildLoopStrategy(classification);

      const totalTime = estimateLoopTotalTime(60, strategy);

      expect(totalTime).toBe(60);
    });

    it("multiplies time for iterative tasks", () => {
      const task: TaskInput = {
        title: "Research task",
        domain: "research",
        complexity: "high",
      };

      const classification = classifyTask(task);
      const strategy = buildLoopStrategy(classification);

      const totalTime = estimateLoopTotalTime(60, strategy);

      expect(totalTime).toBeGreaterThan(60);
    });

    it("adds more time for deep reflection", () => {
      const task: TaskInput = {
        title: "Research task",
        domain: "research",
        complexity: "high",
      };

      const classification = classifyTask(task);
      const deepStrategy = buildLoopStrategy(classification);

      const totalTime = estimateLoopTotalTime(60, deepStrategy);

      expect(totalTime).toBeGreaterThan(90); // Expects significant overhead
    });
  });

  describe("shouldTerminateLoopEarly", () => {
    it("terminates when max iterations reached", () => {
      const should = shouldTerminateLoopEarly(
        5,
        5,
        [0.7, 0.75, 0.8, 0.82, 0.83],
        0.3,
      );

      expect(should).toBe(true);
    });

    it("terminates when quality decreases significantly", () => {
      const should = shouldTerminateLoopEarly(
        3,
        5,
        [0.8, 0.75, 0.5],
        0.3,
      );

      expect(should).toBe(true);
    });

    it("terminates when quality falls below fallback threshold", () => {
      const should = shouldTerminateLoopEarly(
        2,
        5,
        [0.8, 0.25],
        0.3,
      );

      expect(should).toBe(true);
    });

    it("terminates when quality is stable and high", () => {
      const should = shouldTerminateLoopEarly(
        3,
        5,
        [0.7, 0.88, 0.87],
        0.3,
      );

      expect(should).toBe(true);
    });

    it("continues when quality is improving", () => {
      const should = shouldTerminateLoopEarly(
        2,
        5,
        [0.7, 0.8],
        0.3,
      );

      expect(should).toBe(false);
    });
  });

  describe("describeLoopStrategy", () => {
    it("returns appropriate description for non-iterative strategy", () => {
      const task: TaskInput = {
        title: "Simple task",
        complexity: "low",
      };

      const classification = classifyTask(task);
      const strategy = buildLoopStrategy(classification);
      const description = describeLoopStrategy(strategy);

      expect(description).toContain("single-pass execution");
    });

    it("returns iteration count in description", () => {
      const task: TaskInput = {
        title: "Research task",
        domain: "research",
        complexity: "high",
      };

      const classification = classifyTask(task);
      const strategy = buildLoopStrategy(classification);
      const description = describeLoopStrategy(strategy);

      expect(description).toContain("iterations");
      expect(description).toContain("Iterative execution");
    });
  });
});
