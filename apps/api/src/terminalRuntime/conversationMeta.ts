import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ConversationSessionSummary } from "@octogent/core";

export type ConversationMetaEntry = {
  tags: string[];
  pinned: boolean;
};

type ConversationMetaStore = Record<string, ConversationMetaEntry>;

const META_FILENAME = "conversation-meta.json";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const parseMetaEntry = (value: unknown): ConversationMetaEntry => {
  const defaults: ConversationMetaEntry = { tags: [], pinned: false };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const rec = value as Record<string, unknown>;
  return {
    tags: isStringArray(rec.tags) ? rec.tags : [],
    pinned: typeof rec.pinned === "boolean" ? rec.pinned : false,
  };
};

export const readConversationMetaStore = (transcriptDir: string): ConversationMetaStore => {
  const metaPath = join(transcriptDir, META_FILENAME);
  if (!existsSync(metaPath)) {
    return {};
  }
  try {
    const raw = readFileSync(metaPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: ConversationMetaStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[key] = parseMetaEntry(value);
    }
    return result;
  } catch {
    return {};
  }
};

export const writeConversationMetaStore = (
  transcriptDir: string,
  store: ConversationMetaStore,
): void => {
  const metaPath = join(transcriptDir, META_FILENAME);
  writeFileSync(metaPath, JSON.stringify(store, null, 2), "utf-8");
};

export const mergeConversationMeta = (
  summary: ConversationSessionSummary,
  store: ConversationMetaStore,
): ConversationSessionSummary => {
  const entry = store[summary.sessionId];
  if (!entry) {
    return summary;
  }
  return {
    ...summary,
    tags: entry.tags.length > 0 ? entry.tags : undefined,
    pinned: entry.pinned || undefined,
  };
};

export type ConversationMetaPatch = {
  tags?: string[];
  pinned?: boolean;
};

export const patchConversationMetaInStore = (
  transcriptDir: string,
  sessionId: string,
  patch: ConversationMetaPatch,
): boolean => {
  const transcriptFile = join(transcriptDir, `${encodeURIComponent(sessionId)}.jsonl`);
  if (!existsSync(transcriptFile)) {
    return false;
  }
  const store = readConversationMetaStore(transcriptDir);
  const existing = store[sessionId] ?? { tags: [], pinned: false };
  const updated: ConversationMetaEntry = {
    tags:
      patch.tags !== undefined ? patch.tags.map((t) => t.trim()).filter(Boolean) : existing.tags,
    pinned: patch.pinned !== undefined ? patch.pinned : existing.pinned,
  };
  store[sessionId] = updated;
  writeConversationMetaStore(transcriptDir, store);
  return true;
};
