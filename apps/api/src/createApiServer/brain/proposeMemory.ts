import type { MemorySection } from "./memory";
import { oneLine } from "./vault";

export type MemoryProposal = { text: string; section: MemorySection };

const PREFERENCE =
  /\b(i (prefer|always|never|hate|love)|always |never |call me|from now on|i want you to)\b/i;
const COMMITMENT = /\b(i('ll| will)|i am going to|remind me to|i need to|don't let me forget)\b/i;
const DECISION = /\b(i (decided|chose|picked)|going with|we'll go with|settled on)\b/i;
const PERSON = /\b(my (wife|girlfriend|boyfriend|partner|client|boss|mom|dad|brother|sister))\b/i;
const PROJECT = /\b(my (project|business|company|app|site|client work|agency))\b/i;
const QUESTION_OPENER =
  /^(what|who|when|where|why|how|is|are|can|could|should|do |does |did |will |would )/i;

export const proposeMemoryFromQuestion = (question: string): MemoryProposal[] => {
  const text = oneLine(question);
  if (text.length < 12) return [];
  if (QUESTION_OPENER.test(text) && !PREFERENCE.test(text) && !COMMITMENT.test(text)) {
    return [];
  }
  if (PREFERENCE.test(text)) return [{ text, section: "Me" }];
  if (COMMITMENT.test(text)) return [{ text, section: "Commitments" }];
  if (DECISION.test(text)) return [{ text, section: "Decisions" }];
  if (PERSON.test(text)) return [{ text, section: "People" }];
  if (PROJECT.test(text) && !QUESTION_OPENER.test(text)) return [{ text, section: "Projects" }];
  return [];
};
