/**
 * Persistent conversation + learning store.
 * JSONL-based with lazy in-memory indexing — no native deps, no flags needed.
 *
 * Why not SQLite: node:sqlite requires --experimental-sqlite flag in Node 22;
 * better-sqlite3 needs native build tools on Windows. JSONL + memory search is
 * fast enough for personal-scale data and can be swapped for SQLite later.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DbTurn = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type DbLearning = {
  id: string;
  content: string;
  sourceSession?: string;
  timestamp: number;
};

// ── Module-level state ───────────────────────────────────────────────────────

let memoryDir: string | null = null;
let turnsCache: DbTurn[] | null = null;
let learningsCache: DbLearning[] | null = null;

// ── Init ─────────────────────────────────────────────────────────────────────

export const initDb = (stateDir: string): void => {
  const dir = join(stateDir, "memory");
  if (memoryDir === dir) return; // already initialized for this path
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  memoryDir = dir;
  // Reset caches so next read re-loads from disk
  turnsCache = null;
  learningsCache = null;
};

// ── Internal helpers ─────────────────────────────────────────────────────────

const turnsPath = (): string => join(memoryDir!, "turns.jsonl");
const learningsPath = (): string => join(memoryDir!, "learnings.jsonl");

const loadTurns = (): DbTurn[] => {
  if (turnsCache !== null) return turnsCache;
  if (!memoryDir) return [];
  const path = turnsPath();
  if (!existsSync(path)) {
    turnsCache = [];
    return turnsCache;
  }
  try {
    turnsCache = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as DbTurn);
    return turnsCache;
  } catch {
    turnsCache = [];
    return turnsCache;
  }
};

const loadLearnings = (): DbLearning[] => {
  if (learningsCache !== null) return learningsCache;
  if (!memoryDir) return [];
  const path = learningsPath();
  if (!existsSync(path)) {
    learningsCache = [];
    return learningsCache;
  }
  try {
    learningsCache = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as DbLearning);
    return learningsCache;
  } catch {
    learningsCache = [];
    return learningsCache;
  }
};

// Score a piece of text against a query by word-intersection (ignores stop words).
// Returns 0 if no words match; higher = more relevant.
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "was", "are", "were", "it", "its", "in", "on", "at",
  "to", "of", "and", "or", "but", "not", "for", "with", "this", "that", "i",
  "me", "my", "you", "your", "he", "she", "we", "they", "do", "did", "have",
  "has", "had", "be", "been", "being", "will", "can", "could", "would", "should",
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

const scoreAgainst = (content: string, queryTokens: string[]): number => {
  if (queryTokens.length === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  let score = 0;
  for (const qt of queryTokens) {
    if (contentTokens.has(qt)) score++;
  }
  return score;
};

// ── Writes ────────────────────────────────────────────────────────────────────

export const insertTurn = (turn: DbTurn): void => {
  if (!memoryDir) return;
  try {
    appendFileSync(turnsPath(), JSON.stringify(turn) + "\n", "utf8");
    if (turnsCache !== null) turnsCache.push(turn);
  } catch {
    // Never block the caller if persistence fails
  }
};

export const insertLearning = (learning: DbLearning): void => {
  if (!memoryDir) return;
  try {
    appendFileSync(learningsPath(), JSON.stringify(learning) + "\n", "utf8");
    if (learningsCache !== null) learningsCache.push(learning);
  } catch {
    // Never block the caller
  }
};

// ── Reads / Search ────────────────────────────────────────────────────────────

export const searchTurns = (
  query: string,
  limit = 5,
  roleFilter?: "user" | "assistant",
): DbTurn[] => {
  const turns = loadTurns();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return turns
    .filter((t) => !roleFilter || t.role === roleFilter)
    .map((t) => ({ turn: t, score: scoreAgainst(t.content, queryTokens) }))
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score || b.turn.timestamp - a.turn.timestamp)
    .slice(0, limit)
    .map((r) => r.turn);
};

export const searchLearnings = (query: string, limit = 3): DbLearning[] => {
  const learnings = loadLearnings();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return learnings
    .map((l) => ({ learning: l, score: scoreAgainst(l.content, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.learning);
};

export const listAllLearnings = (): DbLearning[] =>
  [...loadLearnings()].sort((a, b) => b.timestamp - a.timestamp);

export const deleteLearning = (id: string): boolean => {
  if (!memoryDir) return false;
  const learnings = loadLearnings();
  const next = learnings.filter((l) => l.id !== id);
  if (next.length === learnings.length) return false;
  try {
    writeFileSync(learningsPath(), next.map((l) => JSON.stringify(l)).join("\n") + (next.length > 0 ? "\n" : ""), "utf8");
    learningsCache = next;
    return true;
  } catch {
    return false;
  }
};
