/**
 * Agent Matcher with Loop Awareness
 *
 * Matches agents to tasks while considering loop strategy requirements.
 * Applies archetype bonuses for loop-capable agents.
 */

import type { TaskClassification } from "./taskClassifier";

export type AgentArchetype =
  | "research-analyst"
  | "senior-developer"
  | "ceo-strategist"
  | "content-creator"
  | "data-scientist"
  | "operations-lead"
  | "junior-developer"
  | "generalist";

export interface AgentProfile {
  id: string;
  name: string;
  archetype: AgentArchetype;
  specialties: string[];
  loopCapabilityScore: number; // 0-1
  reliabilityScore: number; // 0-1
  speedScore: number; // 0-1
}

export interface MatchResult {
  agentId: string;
  agent: AgentProfile;
  domainScore: number; // 0-1
  complexityScore: number; // 0-1
  loopCapabilityBonus: number; // 0-0.15
  timeConstraintScore: number; // 0-1
  finalScore: number; // 0-1
  recommendedForLoop: boolean;
}

/**
 * Domain-to-archetype affinity scores.
 */
const DOMAIN_AFFINITY: Record<string, Record<AgentArchetype, number>> = {
  engineering: {
    "senior-developer": 0.95,
    "junior-developer": 0.70,
    "data-scientist": 0.60,
    "research-analyst": 0.70,
    "ceo-strategist": 0.40,
    "content-creator": 0.20,
    "operations-lead": 0.50,
    generalist: 0.50,
  },
  analysis: {
    "research-analyst": 0.95,
    "data-scientist": 0.90,
    "senior-developer": 0.70,
    "ceo-strategist": 0.65,
    "operations-lead": 0.60,
    "content-creator": 0.40,
    "junior-developer": 0.50,
    generalist: 0.50,
  },
  research: {
    "research-analyst": 0.95,
    "data-scientist": 0.85,
    "ceo-strategist": 0.60,
    "senior-developer": 0.70,
    "operations-lead": 0.40,
    "content-creator": 0.50,
    "junior-developer": 0.40,
    generalist: 0.50,
  },
  content: {
    "content-creator": 0.95,
    "ceo-strategist": 0.65,
    "research-analyst": 0.50,
    "senior-developer": 0.40,
    "operations-lead": 0.50,
    "data-scientist": 0.30,
    "junior-developer": 0.35,
    generalist: 0.60,
  },
  strategy: {
    "ceo-strategist": 0.95,
    "research-analyst": 0.70,
    "senior-developer": 0.60,
    "operations-lead": 0.70,
    "content-creator": 0.40,
    "data-scientist": 0.50,
    "junior-developer": 0.30,
    generalist: 0.50,
  },
  operations: {
    "operations-lead": 0.95,
    "ceo-strategist": 0.65,
    "senior-developer": 0.70,
    "data-scientist": 0.50,
    "research-analyst": 0.40,
    "content-creator": 0.30,
    "junior-developer": 0.40,
    generalist: 0.50,
  },
  creative: {
    "content-creator": 0.90,
    "ceo-strategist": 0.60,
    "research-analyst": 0.40,
    "senior-developer": 0.50,
    "operations-lead": 0.30,
    "data-scientist": 0.35,
    "junior-developer": 0.40,
    generalist: 0.60,
  },
  planning: {
    "ceo-strategist": 0.85,
    "operations-lead": 0.75,
    "senior-developer": 0.55,
    "research-analyst": 0.50,
    "content-creator": 0.45,
    "data-scientist": 0.45,
    "junior-developer": 0.35,
    generalist: 0.60,
  },
};

/**
 * Loop capability bonuses by archetype.
 * Higher scores = better at iterative execution.
 */
const LOOP_CAPABILITY_BONUSES: Record<AgentArchetype, number> = {
  "research-analyst": 0.15, // Excellent at iterative analysis
  "senior-developer": 0.10, // Good at debugging/refining
  "ceo-strategist": 0.12, // Strong iterative strategy
  "data-scientist": 0.12, // Iterative model improvement
  "content-creator": 0.05, // Limited iteration capability
  "operations-lead": 0.03, // Prefers single-pass
  "junior-developer": 0.02, // Lacks iteration discipline
  generalist: 0.06, // Moderate iteration ability
};

/**
 * Complexity tolerance by archetype.
 */
const COMPLEXITY_TOLERANCE: Record<AgentArchetype, number> = {
  "research-analyst": 0.95, // Handles expert complexity
  "senior-developer": 0.90,
  "ceo-strategist": 0.85,
  "data-scientist": 0.90,
  "content-creator": 0.50,
  "operations-lead": 0.60,
  "junior-developer": 0.50,
  generalist: 0.60,
};

/**
 * Time constraint preferences (speed suitability).
 */
const TIME_CONSTRAINT_SUITABILITY: Record<string, Record<AgentArchetype, number>> = {
  immediate: {
    "senior-developer": 0.95, // Fast on urgent fixes
    "operations-lead": 0.90,
    "ceo-strategist": 0.70,
    "research-analyst": 0.50,
    "data-scientist": 0.40,
    "content-creator": 0.30,
    "junior-developer": 0.50,
    generalist: 0.60,
  },
  standard: {
    "senior-developer": 0.90,
    "research-analyst": 0.80,
    "ceo-strategist": 0.85,
    "operations-lead": 0.85,
    "data-scientist": 0.75,
    "content-creator": 0.80,
    "junior-developer": 0.70,
    generalist: 0.75,
  },
  flexible: {
    "research-analyst": 0.95, // Thrives with time
    "data-scientist": 0.90,
    "ceo-strategist": 0.80,
    "senior-developer": 0.75,
    "content-creator": 0.85,
    "operations-lead": 0.70,
    "junior-developer": 0.65,
    generalist: 0.70,
  },
  unknown: {
    "senior-developer": 0.70,
    "research-analyst": 0.70,
    "ceo-strategist": 0.70,
    "data-scientist": 0.70,
    "content-creator": 0.70,
    "operations-lead": 0.70,
    "junior-developer": 0.60,
    generalist: 0.70,
  },
};

/**
 * Calculate domain score for an agent.
 */
function calculateDomainScore(
  agent: AgentProfile,
  classification: TaskClassification,
): number {
  const affinityMap = DOMAIN_AFFINITY[classification.domain];
  if (!affinityMap) return 0.5;

  return affinityMap[agent.archetype] || 0.5;
}

/**
 * Calculate complexity score for an agent.
 */
function calculateComplexityScore(
  agent: AgentProfile,
  classification: TaskClassification,
): number {
  const tolerance = COMPLEXITY_TOLERANCE[agent.archetype] || 0.5;
  const complexityMap: Record<string, number> = {
    low: 1.0,
    medium: 0.8,
    high: 0.6,
    expert: 0.3,
  };

  const complexityDifficulty = complexityMap[classification.complexity] || 0.5;

  // Score decreases if agent tolerance < task difficulty
  const agentCanHandle = tolerance >= complexityDifficulty ? 1.0 : tolerance / complexityDifficulty;

  return agentCanHandle * 0.9 + 0.1; // Floor at 0.1
}

/**
 * Calculate time constraint score for an agent.
 */
function calculateTimeConstraintScore(
  agent: AgentProfile,
  classification: TaskClassification,
): number {
  const suitabilityMap = TIME_CONSTRAINT_SUITABILITY[classification.timeConstraint];
  if (!suitabilityMap) return 0.5;

  return suitabilityMap[agent.archetype] || 0.5;
}

/**
 * Calculate loop capability bonus based on agent archetype.
 */
function calculateLoopCapabilityBonus(
  agent: AgentProfile,
  classification: TaskClassification,
): number {
  // Only apply bonus if task actually requires looping
  if (!classification.loopStrategy?.requiresLoop) {
    return 0;
  }

  const bonus = LOOP_CAPABILITY_BONUSES[agent.archetype] || 0;
  const agentCanReflect = agent.loopCapabilityScore > 0.5;

  return agentCanReflect ? bonus : bonus * 0.3; // Reduce bonus if agent isn't reflection-capable
}

/**
 * Match an agent to a task classification.
 */
export function matchAgentToTask(
  agent: AgentProfile,
  classification: TaskClassification,
): MatchResult {
  const domainScore = calculateDomainScore(agent, classification);
  const complexityScore = calculateComplexityScore(agent, classification);
  const timeConstraintScore = calculateTimeConstraintScore(agent, classification);
  const loopBonus = calculateLoopCapabilityBonus(agent, classification);

  // Final score: weighted average of factors
  const baseScore =
    domainScore * 0.4 +
    complexityScore * 0.35 +
    timeConstraintScore * 0.25;

  const finalScore = Math.min(1.0, baseScore + loopBonus);
  const recommendedForLoop =
    (classification.loopStrategy?.requiresLoop ?? false) &&
    agent.loopCapabilityScore > 0.6;

  return {
    agentId: agent.id,
    agent,
    domainScore,
    complexityScore,
    loopCapabilityBonus: loopBonus,
    timeConstraintScore,
    finalScore,
    recommendedForLoop,
  };
}

/**
 * Match multiple agents and rank by suitability.
 */
export function rankAgentsForTask(
  agents: AgentProfile[],
  classification: TaskClassification,
): MatchResult[] {
  return agents
    .map(agent => matchAgentToTask(agent, classification))
    .sort((a, b) => b.finalScore - a.finalScore);
}

/**
 * Find best agent for a task.
 */
export function findBestAgent(
  agents: AgentProfile[],
  classification: TaskClassification,
): MatchResult | null {
  const ranked = rankAgentsForTask(agents, classification);
  return ranked.length > 0 ? ranked[0] : null;
}
