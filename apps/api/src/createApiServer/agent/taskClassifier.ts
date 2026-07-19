import crypto from "node:crypto";

/**
 * Task Classification System
 *
 * Automatically detects task domain, complexity, time constraints, and data needs.
 * Provides loop strategy recommendations for agentic iteration.
 */

export type TaskDomain =
  | "engineering"
  | "analysis"
  | "content"
  | "strategy"
  | "operations"
  | "creative"
  | "research"
  | "planning";

export type ComplexityLevel = "low" | "medium" | "high" | "expert";

export type TimeConstraint = "immediate" | "standard" | "flexible" | "unknown";

export type DataRequirement = "minimal" | "moderate" | "substantial" | "unknown";

export type QualityBar = "acceptable" | "good" | "excellent" | "production-critical";

export interface TaskClassification {
  taskId: string;
  taskHash: string;
  domain: TaskDomain;
  complexity: ComplexityLevel;
  timeConstraint: TimeConstraint;
  dataRequirement: DataRequirement;
  qualityBar: QualityBar;
  estimatedDurationMinutes: number;
  requiresIteration: boolean;
  requiresSelfCorrection: boolean;
  loopStrategy?: TaskLoopStrategy;
  classifiedAt: string;
  confidence: number;
}

export interface TaskLoopStrategy {
  requiresLoop: boolean;
  maxIterations: number;
  fallbackThreshold: number;
  observationIntervalMs: number;
  reflectionDepth: "shallow" | "medium" | "deep";
  selfCorrectionMode: "automatic" | "prompted" | "disabled";
}

export interface TaskInput {
  title: string;
  description?: string;
  domain?: string;
  complexity?: string;
  timeConstraint?: string;
  qualityBar?: string;
  estimatedDurationMinutes?: number;
  context?: Record<string, unknown>;
}

// Cache: taskHash -> TaskClassification
const classificationCache = new Map<string, TaskClassification>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cacheTimestamps = new Map<string, number>();

/**
 * Generate a hash of the task for caching purposes.
 * Includes title, description, and domain for cache invalidation.
 */
export function generateTaskHash(task: TaskInput): string {
  const key = JSON.stringify({
    title: task.title,
    description: task.description || "",
    domain: task.domain || "",
  });
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Check if a cached classification is still valid (within TTL).
 */
function isCacheValid(hash: string): boolean {
  const timestamp = cacheTimestamps.get(hash);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL_MS;
}

/**
 * Detect the task domain from task title and description.
 */
function detectDomain(task: TaskInput): TaskDomain {
  if (task.domain) {
    const normalized = task.domain.toLowerCase();
    if (
      [
        "engineering",
        "analysis",
        "content",
        "strategy",
        "operations",
        "creative",
        "research",
        "planning",
      ].includes(normalized)
    ) {
      return normalized as TaskDomain;
    }
  }

  const text = `${ task.title } ${ task.description || "" }`.toLowerCase();

  if (
    text.match(/code|implement|debug|refactor|api|database|backend|frontend|architecture/)
  ) {
    return "engineering";
  }
  if (text.match(/analyze|evaluate|assess|metrics|performance|data|report|insight/)) {
    return "analysis";
  }
  if (text.match(/write|document|blog|article|copy|email|presentation|marketing/)) {
    return "content";
  }
  if (text.match(/strategy|roadmap|planning|vision|goals|objectives|scope/)) {
    return "strategy";
  }
  if (text.match(/process|workflow|automation|deploy|release|operations|infrastructure/)) {
    return "operations";
  }
  if (text.match(/design|creative|visual|ux|ui|brand|concept|brainstorm/)) {
    return "creative";
  }
  if (text.match(/research|investigate|explore|discovery|proof|poc|experiment/)) {
    return "research";
  }

  return "planning";
}

/**
 * Detect complexity level from task characteristics.
 */
function detectComplexity(task: TaskInput): ComplexityLevel {
  if (task.complexity) {
    const normalized = task.complexity.toLowerCase();
    if (["low", "medium", "high", "expert"].includes(normalized)) {
      return normalized as ComplexityLevel;
    }
  }

  const text = `${ task.title } ${ task.description || "" }`.toLowerCase();
  const hasMultipleDependencies = (text.match(/depend|integration|cross|multi-/g) || []).length >= 2;
  const hasAdvancedTech = text.match(
    /machine.learning|ai|distributed|blockchain|quantum|microservices/,
  );
  const hasUnknownScope = text.match(/unclear|ambiguous|undefined|unknown|fuzzy/);

  if (hasAdvancedTech || (hasMultipleDependencies && hasUnknownScope)) {
    return "expert";
  }
  if (hasMultipleDependencies || text.length > 500) {
    return "high";
  }
  if (text.match(/simple|basic|straightforward|minor|small|quick/)) {
    return "low";
  }

  return "medium";
}

/**
 * Detect time constraints from task characteristics.
 */
function detectTimeConstraint(task: TaskInput): TimeConstraint {
  if (task.timeConstraint) {
    const normalized = task.timeConstraint.toLowerCase();
    if (["immediate", "standard", "flexible", "unknown"].includes(normalized)) {
      return normalized as TimeConstraint;
    }
  }

  const text = `${ task.title } ${ task.description || "" }`.toLowerCase();

  if (text.match(/urgent|asap|critical|blocker|now|immediately/)) {
    return "immediate";
  }
  if (text.match(/eod|today|tomorrow|this week|sprint/)) {
    return "standard";
  }
  if (text.match(/whenever|when ready|no deadline|flexible|backlog/)) {
    return "flexible";
  }

  return "unknown";
}

/**
 * Detect data requirements.
 */
function detectDataRequirement(task: TaskInput): DataRequirement {
  const context = task.context || {};
  const contextKeys = Object.keys(context).length;

  if (contextKeys > 10 || JSON.stringify(context).length > 10000) {
    return "substantial";
  }
  if (contextKeys > 3) {
    return "moderate";
  }

  return "minimal";
}

/**
 * Detect quality bar from task characteristics.
 */
function detectQualityBar(task: TaskInput): QualityBar {
  if (task.qualityBar) {
    const normalized = task.qualityBar.toLowerCase();
    if (["acceptable", "good", "excellent", "production-critical"].includes(normalized)) {
      return normalized as QualityBar;
    }
  }

  const text = `${ task.title } ${ task.description || "" }`.toLowerCase();

  if (text.match(/production|critical|security|compliance|release|ship/)) {
    return "production-critical";
  }
  if (text.match(/excellent|polished|professional|refined/)) {
    return "excellent";
  }
  if (text.match(/good|solid|quality|well-crafted/)) {
    return "good";
  }

  return "acceptable";
}

/**
 * Determine loop strategy based on task classification.
 */
export function determineLoopStrategy(classification: TaskClassification): TaskLoopStrategy {
  const { domain, complexity, requiresIteration, requiresSelfCorrection } = classification;

  // Research and analysis tasks benefit most from iteration
  const highIterationDomains = ["research", "analysis"];
  const isHighIterationDomain = highIterationDomains.includes(domain);

  // Determine max iterations based on complexity
  let maxIterations = 1;
  if (complexity === "expert") maxIterations = 5;
  else if (complexity === "high") maxIterations = 4;
  else if (complexity === "medium") maxIterations = 3;
  else if (complexity === "low" && requiresIteration) maxIterations = 2;

  // Research and analysis always benefit from multiple iterations
  if (isHighIterationDomain && maxIterations < 3) {
    maxIterations = 3;
  }

  const reflectionDepth =
    complexity === "expert"
      ? "deep"
      : complexity === "high"
        ? "medium"
        : complexity === "medium"
          ? "medium"
          : "shallow";

  const selfCorrectionMode =
    complexity === "expert"
      ? "automatic"
      : complexity === "high"
        ? "automatic"
        : requiresSelfCorrection
          ? "prompted"
          : "disabled";

  // Observation interval: faster for urgent tasks, slower for flexible ones
  const baseObservationMs = 5000; // 5 seconds
  const timeMultiplier =
    classification.timeConstraint === "immediate"
      ? 0.5
      : classification.timeConstraint === "flexible"
        ? 2.0
        : 1.0;
  const observationIntervalMs = Math.floor(baseObservationMs * timeMultiplier);

  return {
    requiresLoop:
      requiresIteration || (isHighIterationDomain && complexity !== "low"),
    maxIterations,
    fallbackThreshold:
      complexity === "expert"
        ? 0.15
        : complexity === "high"
          ? 0.25
          : complexity === "medium"
            ? 0.35
            : 0.5,
    observationIntervalMs,
    reflectionDepth,
    selfCorrectionMode,
  };
}

/**
 * Estimate task duration in minutes based on characteristics.
 */
function estimateDurationMinutes(task: TaskInput, complexity: ComplexityLevel): number {
  if (task.estimatedDurationMinutes && task.estimatedDurationMinutes > 0) {
    return task.estimatedDurationMinutes;
  }

  const textLength = `${ task.title } ${ task.description || "" }`.length;
  const baseDuration =
    complexity === "expert"
      ? 120
      : complexity === "high"
        ? 60
        : complexity === "medium"
          ? 30
          : 15;

  // Adjust based on text length (heuristic: longer descriptions = more complex)
  const lengthFactor = Math.min(2, 1 + textLength / 1000);

  return Math.round(baseDuration * lengthFactor);
}

/**
 * Classify a task into domain, complexity, time constraint, and data needs.
 * Returns cached result if available and valid.
 */
export function classifyTask(task: TaskInput, _context?: Record<string, unknown>): TaskClassification {
  const taskHash = generateTaskHash(task);

  // Check cache
  if (classificationCache.has(taskHash) && isCacheValid(taskHash)) {
    return classificationCache.get(taskHash)!;
  }

  // Detect characteristics
  const domain = detectDomain(task);
  const complexity = detectComplexity(task);
  const timeConstraint = detectTimeConstraint(task);
  const dataRequirement = detectDataRequirement(task);
  const qualityBar = detectQualityBar(task);
  const estimatedDurationMinutes = estimateDurationMinutes(task, complexity);

  // Determine if iteration is needed
  const requiresIteration =
    (complexity === "high" || complexity === "expert") &&
    (domain === "research" || domain === "analysis" || domain === "engineering");

  const requiresSelfCorrection = complexity === "expert" || (requiresIteration && qualityBar !== "acceptable");

  const classification: TaskClassification = {
    taskId: task.title.slice(0, 50).replace(/[^a-z0-9]/gi, "-"),
    taskHash,
    domain,
    complexity,
    timeConstraint,
    dataRequirement,
    qualityBar,
    estimatedDurationMinutes,
    requiresIteration,
    requiresSelfCorrection,
    classifiedAt: new Date().toISOString(),
    confidence: 0.85, // Default confidence; could be improved with ML
  };

  // Generate loop strategy
  classification.loopStrategy = determineLoopStrategy(classification);

  // Cache the result
  classificationCache.set(taskHash, classification);
  cacheTimestamps.set(taskHash, Date.now());

  return classification;
}

/**
 * Clear the classification cache.
 */
export function clearClassificationCache(): void {
  classificationCache.clear();
  cacheTimestamps.clear();
}

/**
 * Get cache statistics (for monitoring).
 */
export function getClassificationCacheStats(): { size: number; entries: string[] } {
  return {
    size: classificationCache.size,
    entries: Array.from(classificationCache.keys()),
  };
}
