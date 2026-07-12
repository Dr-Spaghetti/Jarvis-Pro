/**
 * Auto-extracts a single learning from each conversation turn using Claude Haiku
 * and persists it to Memory.md + the learnings store.
 *
 * Always called without await — never blocks the user-facing response.
 */

import { randomUUID } from "node:crypto";

import { insertLearning, searchLearnings } from "../db";
import { ensureAndAppend, resolveVaultDir } from "./vault";

const MEMORY_PATH = "Jarvis/Memory.md";
const MEMORY_HEADER =
  "# Jarvis Memory\n\nLong-lived context Jarvis should remember about Nick and his work.\n\n## Facts\n\n";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const EXTRACT_SYSTEM =
  "You extract high-value, non-obvious facts about the user and their work from conversations. " +
  "Output ONLY a single bullet point starting with '- ' if something is genuinely worth remembering long-term. " +
  "Output an empty string if nothing new was revealed. " +
  "Focus on: preferences, current projects, decisions made, recurring patterns, stated goals. " +
  "Do NOT output: things already obvious, generic facts, transient details, or anything the user said verbatim.";

const getAnthropicKey = (): string | null => {
  const v = process.env.ANTHROPIC_API_KEY?.trim();
  return v && v.length > 0 ? v : null;
};

export const extractLearning = async (
  question: string,
  answer: string,
  sessionId: string,
): Promise<void> => {
  const apiKey = getAnthropicKey();
  if (!apiKey) return;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 128,
        system: EXTRACT_SYSTEM,
        messages: [
          {
            role: "user",
            // Prioritize the tail of the answer — conclusions and decisions live there
            content: `User asked: "${question.slice(0, 600)}"\nJarvis replied: "${answer.length > 1200 ? `…${answer.slice(-1200)}` : answer}"\n\nExtract one learning, or output nothing.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return;

    const data = (await res.json().catch(() => null)) as {
      content?: { type: string; text: string }[];
    } | null;

    const text = data?.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
    if (!text.startsWith("- ")) return;

    const newFact = text.slice(2).trim();

    // Dedup: skip if a similar learning (2+ shared meaningful words) already exists
    const similar = searchLearnings(newFact, 3);
    if (similar.length > 0) {
      const newWords = new Set(newFact.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
      const isDupe = similar.some((s) => {
        const shared = s.content
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4 && newWords.has(w)).length;
        return shared >= 2;
      });
      if (isDupe) return;
    }

    // Write to Memory.md in the Obsidian vault (best-effort)
    const vaultDir = resolveVaultDir();
    if (vaultDir) {
      try {
        ensureAndAppend(vaultDir, MEMORY_PATH, MEMORY_HEADER, `${text}\n`);
      } catch {
        // Vault write failing is non-fatal
      }
    }

    // Persist to the learnings store
    insertLearning({
      id: randomUUID(),
      content: newFact,
      sourceSession: sessionId,
      timestamp: Date.now(),
    });
  } catch {
    // Haiku call failing is silently ignored — this is background enrichment
  }
};
