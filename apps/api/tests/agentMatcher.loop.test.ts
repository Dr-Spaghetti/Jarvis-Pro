import { describe, it, expect } from "vitest";
import {
  matchAgentToTask,
  rankAgentsForTask,
  findBestAgent,
  type AgentProfile,
  type AgentArchetype,
} from "../src/createApiServer/agent/agentMatcher";
import { classifyTask } from "../src/createApiServer/agent/taskClassifier";
import { getLoopCapability, rankByLoopCapability, isSuitableForIterativeExecution } from "../src/createApiServer/agent/domainLoopCapability";
import type { TaskInput } from "../src/createApiServer/agent/taskClassifier";

const createMockAgent = (
  archetype: AgentArchetype,
  overrides?: Partial<AgentProfile>,
): AgentProfile => ({
  id: `agent-${ archetype }`,
  name: `Mock ${ archetype }`,
  archetype,
  specialties: [archetype],
  loopCapabilityScore: 0.75,
  reliabilityScore: 0.85,
  speedScore: 0.70,
  ...overrides,
});

describe("Agent Matcher", () => {
  describe("matchAgentToTask", () => {
    it("matches engineering task to senior developer", () => {
      const agent = createMockAgent("senior-developer");
      const task: TaskInput = {
        title: "Implement API endpoint",
        description: "Build REST API",
      };
      const classification = classifyTask(task);

      const result = matchAgentToTask(agent, classification);

      expect(result.finalScore).toBeGreaterThan(0.7);
      expect(result.domainScore).toBeGreaterThan(0.8);
    });

    it("matches research task to research analyst", () => {
      const agent = createMockAgent("research-analyst");
      const task: TaskInput = {
        title: "Research new technology",
        description: "Explore distributed systems",
      };
      const classification = classifyTask(task);

      const result = matchAgentToTask(agent, classification);

      expect(result.finalScore).toBeGreaterThan(0.8);
    });

    it("applies loop capability bonus for iterative tasks", () => {
      const agent = createMockAgent("research-analyst");
      const task: TaskInput = {
        title: "Research task",
        domain: "research",
        complexity: "high",
      };
      const classification = classifyTask(task);

      const result = matchAgentToTask(agent, classification);

      expect(result.loopCapabilityBonus).toBeGreaterThan(0);
    });

    it("does not apply loop bonus for non-iterative tasks", () => {
      const agent = createMockAgent("research-analyst");
      const task: TaskInput = {
        title: "Simple task",
        complexity: "low",
      };
      const classification = classifyTask(task);

      const result = matchAgentToTask(agent, classification);

      expect(result.loopCapabilityBonus).toBe(0);
    });

    it("sets recommendedForLoop flag appropriately", () => {
      const loopAgent = createMockAgent("research-analyst", {
        loopCapabilityScore: 0.8,
      });
      const nonLoopAgent = createMockAgent("operations-lead", {
        loopCapabilityScore: 0.3,
      });

      const task: TaskInput = {
        title: "Research task",
        domain: "research",
        complexity: "high",
      };
      const classification = classifyTask(task);

      const loopResult = matchAgentToTask(loopAgent, classification);
      const nonLoopResult = matchAgentToTask(nonLoopAgent, classification);

      expect(loopResult.recommendedForLoop).toBe(true);
      expect(nonLoopResult.recommendedForLoop).toBe(false);
    });

    it("returns normalized final score 0-1", () => {
      const agent = createMockAgent("senior-developer");
      const task: TaskInput = { title: "Test task" };
      const classification = classifyTask(task);

      const result = matchAgentToTask(agent, classification);

      expect(result.finalScore).toBeGreaterThanOrEqual(0);
      expect(result.finalScore).toBeLessThanOrEqual(1);
    });
  });

  describe("rankAgentsForTask", () => {
    it("returns agents sorted by final score", () => {
      const agents = [
        createMockAgent("junior-developer"),
        createMockAgent("senior-developer"),
        createMockAgent("research-analyst"),
      ];

      const task: TaskInput = {
        title: "Implement API",
        domain: "engineering",
      };
      const classification = classifyTask(task);

      const ranked = rankAgentsForTask(agents, classification);

      expect(ranked.length).toBe(3);
      expect(ranked[0].finalScore).toBeGreaterThanOrEqual(ranked[1].finalScore);
      expect(ranked[1].finalScore).toBeGreaterThanOrEqual(ranked[2].finalScore);
    });

    it("ranks best agent first", () => {
      const agents = [
        createMockAgent("operations-lead"),
        createMockAgent("senior-developer"),
      ];

      const task: TaskInput = {
        title: "Fix bug in code",
        domain: "engineering",
        complexity: "high",
      };
      const classification = classifyTask(task);

      const ranked = rankAgentsForTask(agents, classification);

      expect(ranked[0].agent.archetype).toBe("senior-developer");
    });
  });

  describe("findBestAgent", () => {
    it("returns best agent", () => {
      const agents = [
        createMockAgent("junior-developer"),
        createMockAgent("senior-developer"),
      ];

      const task: TaskInput = {
        title: "Complex engineering task",
        complexity: "high",
      };
      const classification = classifyTask(task);

      const best = findBestAgent(agents, classification);

      expect(best).not.toBeNull();
      expect(best?.agent.archetype).toBe("senior-developer");
    });

    it("returns null for empty agent list", () => {
      const task: TaskInput = { title: "Task" };
      const classification = classifyTask(task);

      const best = findBestAgent([], classification);

      expect(best).toBeNull();
    });
  });
});

describe("Domain Loop Capability", () => {
  describe("getLoopCapability", () => {
    it("returns capability for valid domain-archetype pair", () => {
      const capability = getLoopCapability("research", "research-analyst");

      expect(capability).not.toBeNull();
      expect(capability?.iterationCapability).toBeGreaterThan(0.9);
    });

    it("returns null for invalid domain", () => {
      const capability = getLoopCapability("invalid-domain", "research-analyst");

      expect(capability).toBeNull();
    });
  });

  describe("rankByLoopCapability", () => {
    it("returns archetypes ranked by iteration capability", () => {
      const ranked = rankByLoopCapability("research");

      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].iterationCapability).toBeGreaterThanOrEqual(
        ranked[ranked.length - 1].iterationCapability,
      );
    });

    it("research-analyst ranks first for research domain", () => {
      const ranked = rankByLoopCapability("research");

      expect(ranked[0].archetype).toBe("research-analyst");
    });

    it("senior-developer ranks first for engineering domain", () => {
      const ranked = rankByLoopCapability("engineering");

      expect(ranked[0].archetype).toBe("senior-developer");
    });
  });

  describe("isSuitableForIterativeExecution", () => {
    it("returns true for suitable archetype-domain pairs", () => {
      const suitable = isSuitableForIterativeExecution("research", "research-analyst");

      expect(suitable).toBe(true);
    });

    it("returns false for unsuitable pairs", () => {
      const suitable = isSuitableForIterativeExecution(
        "engineering",
        "content-creator",
      );

      expect(suitable).toBe(false);
    });

    it("respects custom threshold", () => {
      const suitable = isSuitableForIterativeExecution(
        "research",
        "research-analyst",
        0.99,
      );

      expect(suitable).toBe(false);
    });
  });
});
