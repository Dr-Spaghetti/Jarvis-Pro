// Lightweight keyword classifier — decides whether a brain/ask question
// needs live data from an MCP connector ("agentic") or can be answered
// locally (general/vault/Claude text path).
//
// Deliberately simple: no API call, no model, runs synchronously.
// False positives (agentic for a general question) cost a few seconds of
// latency; false negatives just mean the user gets a general answer.

export type BrainConnector = "localfalcon" | "apollo";

export type BrainQuestionRoute =
  | { type: "general" }
  | { type: "agentic"; connectors: BrainConnector[] }
  | { type: "orchestrate" };

const LOCALFALCON_KEYWORDS = [
  "rank",
  "ranking",
  "rankings",
  "map pack",
  "local seo",
  "gmb",
  "google business",
  "local falcon",
  "local search",
  "search visibility",
  "competitor rank",
  "pack position",
  "search position",
  "keyword rank",
  "local rank",
];

const ORCHESTRATE_PHRASES = [
  "have the team",
  "coordinate multiple agents",
  "deploy agents for",
  "get everyone working on",
  "spin up a team",
  "assemble a team",
  "launch a team",
  "deploy a team",
];

const ORCHESTRATE_SINGLE_WORDS = ["multi-agent", "orchestrate"];

const APOLLO_KEYWORDS = [
  "apollo",
  "leads",
  "lead count",
  "prospects",
  "pipeline",
  "outreach",
  "sequence",
  "email campaign",
  "lead credits",
  "enrichment",
  "contacts remaining",
];

const containsAny = (lower: string, keywords: readonly string[]): boolean =>
  keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower));

export const classifyBrainQuestion = (question: string): BrainQuestionRoute => {
  const lower = question.toLowerCase();

  // Orchestrate intent takes priority — multi-word phrases as literals, single words word-bounded
  if (
    ORCHESTRATE_PHRASES.some((kw) => lower.includes(kw)) ||
    containsAny(lower, ORCHESTRATE_SINGLE_WORDS)
  ) {
    return { type: "orchestrate" };
  }

  const connectors: BrainConnector[] = [];

  if (containsAny(lower, LOCALFALCON_KEYWORDS)) connectors.push("localfalcon");
  if (containsAny(lower, APOLLO_KEYWORDS)) connectors.push("apollo");

  return connectors.length > 0 ? { type: "agentic", connectors } : { type: "general" };
};
