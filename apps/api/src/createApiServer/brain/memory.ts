import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { asRecord, oneLine, resolveVaultDir, toPosix } from "./vault";

export const MEMORY_PATH = "Jarvis/Memory.md";

export const MEMORY_SECTIONS = [
  "Me",
  "People",
  "Projects",
  "Commitments",
  "Decisions",
  "Facts",
] as const;

export type MemorySection = (typeof MEMORY_SECTIONS)[number];

export type MemorySections = Record<MemorySection, string[]>;

export const MEMORY_HEADER = `# Jarvis Memory

Long-lived context Jarvis should remember about Nick and his work.
Skills read this for context; the web "remember" action appends here.

## Me

## People

## Projects

## Commitments

## Decisions

## Facts

`;

export const emptyMemorySections = (): MemorySections => ({
  Me: [],
  People: [],
  Projects: [],
  Commitments: [],
  Decisions: [],
  Facts: [],
});

export const isMemorySection = (value: unknown): value is MemorySection =>
  typeof value === "string" && (MEMORY_SECTIONS as readonly string[]).includes(value);

const HEADING_RE = /^##\s+(.+?)\s*$/;

export const parseMemory = (content: string): MemorySections => {
  const sections = emptyMemorySections();
  let current: MemorySection = "Facts";
  for (const raw of content.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      const name = heading[1]?.trim() ?? "";
      if (isMemorySection(name)) current = name;
      continue;
    }
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("- ")) continue;
    const item = trimmed.slice(2).trim();
    if (item.length > 0) sections[current].push(item);
  }
  return sections;
};

export const flattenMemory = (sections: MemorySections): string[] =>
  MEMORY_SECTIONS.flatMap((section) => sections[section]);

export const readMemorySections = (vaultDir: string): MemorySections => {
  const file = join(vaultDir, MEMORY_PATH);
  if (!existsSync(file)) return emptyMemorySections();
  try {
    return parseMemory(readFileSync(file, "utf8"));
  } catch {
    return emptyMemorySections();
  }
};

export const readMemoryFacts = (vaultDir: string, limit: number): string[] =>
  flattenMemory(readMemorySections(vaultDir)).slice(0, limit);

export const selectMemorySlice = (
  sections: MemorySections,
  question: string,
  limit = 12,
): string[] => {
  const q = question.toLowerCase();
  const out: string[] = [];
  const push = (items: string[]) => {
    for (const item of items) {
      if (out.length >= limit) return;
      if (!out.includes(item)) out.push(item);
    }
  };
  const relevant = (items: string[]): string[] =>
    items.filter((item) => {
      const words = item
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3);
      return words.some((word) => q.includes(word));
    });

  push(sections.Me);
  push(relevant(sections.People));
  push(relevant(sections.Projects));
  push(relevant(sections.Commitments));
  push(relevant(sections.Decisions));
  push(relevant(sections.Facts));
  push(sections.Commitments);
  push(sections.Decisions);
  push(sections.Facts);
  push(sections.People);
  push(sections.Projects);
  return out.slice(0, limit);
};

export const appendMemoryFact = (
  vaultDir: string,
  text: string,
  section: MemorySection = "Facts",
): string => {
  const file = join(vaultDir, MEMORY_PATH);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, MEMORY_HEADER, "utf8");

  const content = readFileSync(file, "utf8");
  const headingRe = new RegExp(`^##\\s+${section}\\s*$`, "m");
  const bullet = `- ${text}`;

  if (!headingRe.test(content)) {
    const next = `${content.endsWith("\n") ? content : `${content}\n`}\n## ${section}\n\n${bullet}\n`;
    writeFileSync(file, next, "utf8");
    return toPosix(MEMORY_PATH);
  }

  const lines = content.split(/\n/);
  const headingIndex = lines.findIndex((line) => new RegExp(`^##\\s+${section}\\s*$`).test(line));
  let insertAt = headingIndex + 1;
  while (insertAt < lines.length && (lines[insertAt]?.trim() ?? "") === "") insertAt += 1;
  lines.splice(insertAt, 0, bullet);
  const joined = lines.join("\n");
  writeFileSync(file, joined.endsWith("\n") ? joined : `${joined}\n`, "utf8");
  return toPosix(MEMORY_PATH);
};

export const handleBrainMemoryRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/memory") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(
      response,
      200,
      { configured: false, content: "", items: [], sections: emptyMemorySections() },
      corsOrigin,
    );
    return true;
  }
  const file = join(vaultDir, MEMORY_PATH);
  if (!existsSync(file)) {
    writeJson(
      response,
      200,
      { configured: true, content: "", items: [], sections: emptyMemorySections() },
      corsOrigin,
    );
    return true;
  }
  try {
    const content = readFileSync(file, "utf8");
    const sections = parseMemory(content);
    writeJson(
      response,
      200,
      { configured: true, content, items: flattenMemory(sections), sections },
      corsOrigin,
    );
  } catch {
    writeJson(
      response,
      200,
      { configured: true, content: "", items: [], sections: emptyMemorySections() },
      corsOrigin,
    );
  }
  return true;
};

export const handleBrainRememberRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/remember") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(
      response,
      400,
      { error: "No vault configured (set OBSIDIAN_VAULT_PATH)." },
      corsOrigin,
    );
    return true;
  }
  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = asRecord(body.payload);
  const text = typeof payload.text === "string" ? oneLine(payload.text) : "";
  if (text.length === 0) {
    writeJson(response, 400, { error: "text (non-empty string) is required" }, corsOrigin);
    return true;
  }
  const section: MemorySection = isMemorySection(payload.section) ? payload.section : "Facts";
  try {
    const path = appendMemoryFact(vaultDir, text, section);
    writeJson(response, 201, { ok: true, path, section }, corsOrigin);
  } catch (error) {
    writeJson(
      response,
      500,
      { error: error instanceof Error ? error.message : "remember failed" },
      corsOrigin,
    );
  }
  return true;
};
