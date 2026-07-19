import { describe, it, expect } from "vitest";
import {
  evaluateLoopEfficacyGate,
  describeGateResult,
  applyGateWeight,
  GATE_WEIGHT,
} from "../createApiServer/agent/metrics/loopQualityEvaluator";
import type { AgentLoopMetrics } from "../createApiServer/agent/metrics/loopMetricsTypes";

const createMockMetrics = (overrides?: Partial<AgentLoopMetrics>): AgentLoopMetrics => ({
  strategy: {
    requiresLoop: true,
    maxIterations: 3,
    fallbackThreshold: 0.3,
    observationIntervalMs: 5000,
    reflectionDepth: "medium",
    selfCorrectionMode: "automatic",
  },
  totalIterations: 2,
  iterations: [],
  totalSelfCorrections: 0,
  reflectionQualityAvg: 0.75,
  confidenceLevelProgression: [0.5, 0.6],
  qualityProgression: [0.7, 0.8],
  finalConfidence: 0.6,
  finalQuality: 0.8,
  ...overrides,
});

describe("Loop Quality Evaluator", () => {
  describe("evaluateLoopEfficacyGate", () => {
    it("passes when all checks pass", () => {
      const metrics = createMockMetrics({
        totalIterations: 2,
        qualityProgression: [0.7, 0.8], // Improving
        confidenceLevelProgression: [0.5, 0.6], // Improving
        totalSelfCorrections: 0,
      });

      const result = evaluateLoopEfficacyGate(metrics);

      expect(result.passed).toBe(true);
      expect(result.checks.every(c => c.passed)).toBe(true);
    });

    it("fails when exceeding max iterations", () => {
      const metrics = createMockMetrics({
        totalIterations: 5, // Exceeds max of 3
        qualityProgression: [0.7, 0.75, 0.8, 0.82, 0.85],
        confidenceLevelProgression: [0.5, 0.55, 0.6, 0.65, 0.7],
      });

      const result = evaluateLoopEfficacyGate(metrics);

      const iterationCheck = result.checks.find(c => c.name === "Iteration Limit");
      expect(iterationCheck?.passed).toBe(false);
    });

    it("fails with poor quality improvement", () => {
      const metrics = createMockMetrics({
        qualityProgression: [0.7, 0.65, 0.62], // Decreasing
      });

      const result = evaluateLoopEfficacyGate(metrics);

      const qualityCheck = result.checks.find(c => c.name === "Quality Improvement");
      expect(qualityCheck?.passed).toBe(false);
    });

    it("fails with unstable confidence", () => {
      const metrics = createMockMetrics({
        confidenceLevelProgression: [0.8, 0.4, 0.5], // Large drop (0.4)
      });

      const result = evaluateLoopEfficacyGate(metrics);

      const confidenceCheck = result.checks.find(c => c.name === "Confidence Stability");
      expect(confidenceCheck?.passed).toBe(false);
    });

    it("fails with excessive self-corrections", () => {
      const metrics = createMockMetrics({
        totalIterations: 3,
        totalSelfCorrections: 2, // 66% correction rate > 50% threshold
      });

      const result = evaluateLoopEfficacyGate(metrics);

      const correctionCheck = result.checks.find(c => c.name === "Self-Correction Rate");
      expect(correctionCheck?.passed).toBe(false);
    });

    it("returns numeric score between 0 and 1", () => {
      const metrics = createMockMetrics();
      const result = evaluateLoopEfficacyGate(metrics);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("includes all required checks", () => {
      const metrics = createMockMetrics();
      const result = evaluateLoopEfficacyGate(metrics);

      const checkNames = result.checks.map(c => c.name);
      expect(checkNames).toContain("Iteration Limit");
      expect(checkNames).toContain("Quality Improvement");
      expect(checkNames).toContain("Confidence Stability");
      expect(checkNames).toContain("Self-Correction Rate");
    });

    it("allows quality decline if starting from high baseline", () => {
      const metrics = createMockMetrics({
        qualityProgression: [0.85, 0.82], // Slight decline from high baseline
      });

      const result = evaluateLoopEfficacyGate(metrics);

      const qualityCheck = result.checks.find(c => c.name === "Quality Improvement");
      expect(qualityCheck?.passed).toBe(true);
    });

    it("tolerates small confidence drops", () => {
      const metrics = createMockMetrics({
        confidenceLevelProgression: [0.8, 0.75, 0.7], // Max drop 0.1 < 0.3 threshold
      });

      const result = evaluateLoopEfficacyGate(metrics);

      const confidenceCheck = result.checks.find(c => c.name === "Confidence Stability");
      expect(confidenceCheck?.passed).toBe(true);
    });
  });

  describe("describeGateResult", () => {
    it("returns string with PASSED status", () => {
      const metrics = createMockMetrics();
      const result = evaluateLoopEfficacyGate(metrics);
      const description = describeGateResult(result);

      if (result.passed) {
        expect(description).toContain("PASSED");
      }
    });

    it("returns string with FAILED status when appropriate", () => {
      const metrics = createMockMetrics({
        totalIterations: 10, // Exceed limit
      });
      const result = evaluateLoopEfficacyGate(metrics);
      const description = describeGateResult(result);

      expect(description).toContain("FAILED");
    });

    it("includes all check results", () => {
      const metrics = createMockMetrics();
      const result = evaluateLoopEfficacyGate(metrics);
      const description = describeGateResult(result);

      expect(description).toContain("Iteration Limit");
      expect(description).toContain("Quality Improvement");
      expect(description).toContain("Confidence Stability");
      expect(description).toContain("Self-Correction Rate");
    });

    it("includes score percentage", () => {
      const metrics = createMockMetrics();
      const result = evaluateLoopEfficacyGate(metrics);
      const description = describeGateResult(result);

      expect(description).toMatch(/\d+%/);
    });
  });

  describe("applyGateWeight", () => {
    it("weights gate score appropriately", () => {
      const gateScore = 1.0;
      const otherScore = 0.5;
      const otherWeight = 0.85;

      const result = applyGateWeight(gateScore, otherScore, otherWeight);

      expect(result).toBeGreaterThan(0.5); // Should be above other score due to gate weight
      expect(result).toBeLessThan(1.0);
    });

    it("applies GATE_WEIGHT constant", () => {
      expect(GATE_WEIGHT).toBe(0.15);

      const result1 = applyGateWeight(1.0, 0.5, 0.85);
      const result2 = applyGateWeight(0.0, 0.5, 0.85);

      expect(result1).toBeGreaterThan(result2);
    });

    it("handles edge cases", () => {
      const result1 = applyGateWeight(0, 0, 1);
      const result2 = applyGateWeight(1, 1, 1);

      expect(result1).toBe(0);
      expect(result2).toBe(1);
    });
  });
});
