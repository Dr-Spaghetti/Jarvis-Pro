/**
 * Domain Loop Capability Matrix
 *
 * Per-archetype capability for iterative task execution by domain.
 * Higher scores indicate better suited for multi-iteration workflows.
 */

import type { AgentArchetype } from "./agentMatcher";

export interface DomainLoopCapability {
  domain: string;
  archetype: AgentArchetype;
  iterationCapability: number; // 0-1
  reflectionDepthSuitability: number; // 0-1
  selfCorrectionSkill: number; // 0-1
  convergenceSpeed: number; // 0-1 (how quickly quality improves)
}

/**
 * Loop capability matrix: domain x archetype.
 */
const DOMAIN_LOOP_CAPABILITIES: Record<string, Record<AgentArchetype, DomainLoopCapability>> = {
  research: {
    "research-analyst": {
      domain: "research",
      archetype: "research-analyst",
      iterationCapability: 0.95,
      reflectionDepthSuitability: 0.9,
      selfCorrectionSkill: 0.85,
      convergenceSpeed: 0.8,
    },
    "data-scientist": {
      domain: "research",
      archetype: "data-scientist",
      iterationCapability: 0.9,
      reflectionDepthSuitability: 0.85,
      selfCorrectionSkill: 0.8,
      convergenceSpeed: 0.85,
    },
    "senior-developer": {
      domain: "research",
      archetype: "senior-developer",
      iterationCapability: 0.7,
      reflectionDepthSuitability: 0.65,
      selfCorrectionSkill: 0.75,
      convergenceSpeed: 0.7,
    },
    "ceo-strategist": {
      domain: "research",
      archetype: "ceo-strategist",
      iterationCapability: 0.65,
      reflectionDepthSuitability: 0.75,
      selfCorrectionSkill: 0.6,
      convergenceSpeed: 0.55,
    },
    "content-creator": {
      domain: "research",
      archetype: "content-creator",
      iterationCapability: 0.45,
      reflectionDepthSuitability: 0.5,
      selfCorrectionSkill: 0.4,
      convergenceSpeed: 0.35,
    },
    "operations-lead": {
      domain: "research",
      archetype: "operations-lead",
      iterationCapability: 0.3,
      reflectionDepthSuitability: 0.35,
      selfCorrectionSkill: 0.25,
      convergenceSpeed: 0.3,
    },
    "junior-developer": {
      domain: "research",
      archetype: "junior-developer",
      iterationCapability: 0.4,
      reflectionDepthSuitability: 0.35,
      selfCorrectionSkill: 0.3,
      convergenceSpeed: 0.4,
    },
    generalist: {
      domain: "research",
      archetype: "generalist",
      iterationCapability: 0.55,
      reflectionDepthSuitability: 0.5,
      selfCorrectionSkill: 0.45,
      convergenceSpeed: 0.5,
    },
  },
  analysis: {
    "research-analyst": {
      domain: "analysis",
      archetype: "research-analyst",
      iterationCapability: 0.95,
      reflectionDepthSuitability: 0.9,
      selfCorrectionSkill: 0.85,
      convergenceSpeed: 0.85,
    },
    "data-scientist": {
      domain: "analysis",
      archetype: "data-scientist",
      iterationCapability: 0.92,
      reflectionDepthSuitability: 0.88,
      selfCorrectionSkill: 0.85,
      convergenceSpeed: 0.9,
    },
    "senior-developer": {
      domain: "analysis",
      archetype: "senior-developer",
      iterationCapability: 0.75,
      reflectionDepthSuitability: 0.7,
      selfCorrectionSkill: 0.78,
      convergenceSpeed: 0.72,
    },
    "ceo-strategist": {
      domain: "analysis",
      archetype: "ceo-strategist",
      iterationCapability: 0.7,
      reflectionDepthSuitability: 0.75,
      selfCorrectionSkill: 0.65,
      convergenceSpeed: 0.6,
    },
    "content-creator": {
      domain: "analysis",
      archetype: "content-creator",
      iterationCapability: 0.5,
      reflectionDepthSuitability: 0.55,
      selfCorrectionSkill: 0.45,
      convergenceSpeed: 0.4,
    },
    "operations-lead": {
      domain: "analysis",
      archetype: "operations-lead",
      iterationCapability: 0.55,
      reflectionDepthSuitability: 0.5,
      selfCorrectionSkill: 0.45,
      convergenceSpeed: 0.5,
    },
    "junior-developer": {
      domain: "analysis",
      archetype: "junior-developer",
      iterationCapability: 0.45,
      reflectionDepthSuitability: 0.4,
      selfCorrectionSkill: 0.35,
      convergenceSpeed: 0.42,
    },
    generalist: {
      domain: "analysis",
      archetype: "generalist",
      iterationCapability: 0.6,
      reflectionDepthSuitability: 0.55,
      selfCorrectionSkill: 0.5,
      convergenceSpeed: 0.55,
    },
  },
  engineering: {
    "senior-developer": {
      domain: "engineering",
      archetype: "senior-developer",
      iterationCapability: 0.92,
      reflectionDepthSuitability: 0.85,
      selfCorrectionSkill: 0.9,
      convergenceSpeed: 0.88,
    },
    "junior-developer": {
      domain: "engineering",
      archetype: "junior-developer",
      iterationCapability: 0.65,
      reflectionDepthSuitability: 0.55,
      selfCorrectionSkill: 0.5,
      convergenceSpeed: 0.6,
    },
    "data-scientist": {
      domain: "engineering",
      archetype: "data-scientist",
      iterationCapability: 0.7,
      reflectionDepthSuitability: 0.65,
      selfCorrectionSkill: 0.6,
      convergenceSpeed: 0.68,
    },
    "research-analyst": {
      domain: "engineering",
      archetype: "research-analyst",
      iterationCapability: 0.65,
      reflectionDepthSuitability: 0.7,
      selfCorrectionSkill: 0.6,
      convergenceSpeed: 0.6,
    },
    "ceo-strategist": {
      domain: "engineering",
      archetype: "ceo-strategist",
      iterationCapability: 0.4,
      reflectionDepthSuitability: 0.45,
      selfCorrectionSkill: 0.3,
      convergenceSpeed: 0.25,
    },
    "operations-lead": {
      domain: "engineering",
      archetype: "operations-lead",
      iterationCapability: 0.45,
      reflectionDepthSuitability: 0.4,
      selfCorrectionSkill: 0.35,
      convergenceSpeed: 0.4,
    },
    "content-creator": {
      domain: "engineering",
      archetype: "content-creator",
      iterationCapability: 0.2,
      reflectionDepthSuitability: 0.2,
      selfCorrectionSkill: 0.15,
      convergenceSpeed: 0.15,
    },
    generalist: {
      domain: "engineering",
      archetype: "generalist",
      iterationCapability: 0.55,
      reflectionDepthSuitability: 0.5,
      selfCorrectionSkill: 0.45,
      convergenceSpeed: 0.5,
    },
  },
};

/**
 * Get loop capability for a specific domain-archetype pair.
 */
export function getLoopCapability(
  domain: string,
  archetype: AgentArchetype,
): DomainLoopCapability | null {
  return DOMAIN_LOOP_CAPABILITIES[domain]?.[archetype] || null;
}

/**
 * Get all archetypes ranked by loop capability in a domain.
 */
export function rankByLoopCapability(domain: string): DomainLoopCapability[] {
  const capabilities = DOMAIN_LOOP_CAPABILITIES[domain];
  if (!capabilities) return [];

  return Object.values(capabilities).sort((a, b) => b.iterationCapability - a.iterationCapability);
}

/**
 * Check if an archetype is suitable for iterative execution in a domain.
 */
export function isSuitableForIterativeExecution(
  domain: string,
  archetype: AgentArchetype,
  minThreshold = 0.6,
): boolean {
  const capability = getLoopCapability(domain, archetype);
  if (!capability) return false;

  return capability.iterationCapability >= minThreshold;
}
