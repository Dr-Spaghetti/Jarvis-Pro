import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cosineSimilarity, embedViaOllama } from "../ollamaEmbed";
import type { ApiRouteHandler } from "../routeHelpers";
import { writeJson, writeMethodNotAllowed } from "../routeHelpers";
import {
  buildSnippet,
  deriveTitle,
  listMarkdownFiles,
  resolveVaultDir,
  stripFrontmatter,
  toPosix,
  type BrainNote,
} from "./vault";

// Multi-term lexical scoring: match each query word independently and reward
// notes that hit the title, path, headings, and more of the distinct terms.
export const lexicalSearchNotes = (vaultDir: string, rawQuery: string, limit = 20): BrainNote[] => {
  const needle = rawQuery.toLowerCase();
  const terms = needle.split(/\s+/).filter((term) => term.length >= 2);
  const searchTerms = terms.length > 0 ? terms : [needle];
  const results: Array<{ score: number; mtime: number; note: BrainNote }> = [];
  for (const rel of listMarkdownFiles(vaultDir)) {
    const full = join(vaultDir, rel);
    try {
      const content = readFileSync(full, "utf8");
      const lower = content.toLowerCase();
      const title = deriveTitle(content, rel);
      const titleLower = title.toLowerCase();
      const pathLower = rel.toLowerCase();
      const headingsLower = (content.match(/^#{1,6}\s+.+$/gm) ?? []).join("\n").toLowerCase();

      let matchedTerms = 0;
      let score = 0;
      let firstHit: string | null = null;
      for (const term of searchTerms) {
        const occurrences = lower.split(term).length - 1;
        const inTitle = titleLower.includes(term);
        const inPath = pathLower.includes(term);
        const inHeading = headingsLower.includes(term);
        if (occurrences === 0 && !inTitle && !inPath) continue;
        matchedTerms += 1;
        if (!firstHit) firstHit = term;
        score +=
          (inTitle ? 12 : 0) + (inPath ? 6 : 0) + (inHeading ? 4 : 0) + Math.min(occurrences, 5);
      }
      if (matchedTerms === 0) continue;
      score *= matchedTerms;
      const mtime = statSync(full).mtimeMs;
      results.push({
        score,
        mtime,
        note: {
          title,
          path: toPosix(rel),
          modified: new Date(mtime).toISOString(),
          snippet: buildSnippet(stripFrontmatter(content), firstHit ?? rawQuery),
        },
      });
    } catch {
      // skip
    }
  }
  results.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return results.slice(0, limit).map((r) => r.note);
};

const SEMANTIC_INDEX_FILE = ".jarvis-brain-index.json";
const MAX_EMBED_PER_REQUEST = 60;
type SemanticIndexEntry = { mtime: number; vector: number[] };
export type SemanticIndex = Record<string, SemanticIndexEntry>;

export const loadSemanticIndex = (vaultDir: string): SemanticIndex => {
  try {
    const parsed = JSON.parse(readFileSync(join(vaultDir, SEMANTIC_INDEX_FILE), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as SemanticIndex) : {};
  } catch {
    return {};
  }
};

export const saveSemanticIndex = (vaultDir: string, index: SemanticIndex): void => {
  try {
    writeFileSync(join(vaultDir, SEMANTIC_INDEX_FILE), JSON.stringify(index), "utf8");
  } catch {
    // best-effort cache; ignore write failures
  }
};

export const embedTextFor = (content: string, rel: string): string =>
  `${deriveTitle(content, rel)}\n\n${stripFrontmatter(content).slice(0, 800)}`;

export const handleBrainSearchRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/search") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const q = (requestUrl.searchParams.get("q") ?? "").trim();
  const vaultDir = resolveVaultDir();
  if (!vaultDir || q.length === 0) {
    writeJson(response, 200, { configured: Boolean(vaultDir), query: q, notes: [] }, corsOrigin);
    return true;
  }
  writeJson(
    response,
    200,
    { configured: true, query: q, notes: lexicalSearchNotes(vaultDir, q, 20) },
    corsOrigin,
  );
  return true;
};

export const handleBrainSemanticRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/semantic") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const q = (requestUrl.searchParams.get("q") ?? "").trim();
  const vaultDir = resolveVaultDir();
  if (!vaultDir || q.length === 0) {
    writeJson(response, 200, { configured: Boolean(vaultDir), semantic: false, query: q, notes: [] }, corsOrigin);
    return true;
  }

  const queryVector = await embedViaOllama(q);
  if (!queryVector) {
    writeJson(
      response,
      200,
      { configured: true, semantic: false, query: q, notes: lexicalSearchNotes(vaultDir, q, 20) },
      corsOrigin,
    );
    return true;
  }

  const index = loadSemanticIndex(vaultDir);
  const present = new Set<string>();
  let embedded = 0;
  let changed = false;
  for (const rel of listMarkdownFiles(vaultDir)) {
    const relPosix = toPosix(rel);
    present.add(relPosix);
    try {
      const mtime = statSync(join(vaultDir, rel)).mtimeMs;
      const existing = index[relPosix];
      if ((!existing || existing.mtime !== mtime) && embedded < MAX_EMBED_PER_REQUEST) {
        const content = readFileSync(join(vaultDir, rel), "utf8");
        const vector = await embedViaOllama(embedTextFor(content, rel));
        if (vector) {
          index[relPosix] = { mtime, vector };
          embedded += 1;
          changed = true;
        }
      }
    } catch {
      // skip unreadable
    }
  }
  for (const key of Object.keys(index)) {
    if (!present.has(key)) {
      Reflect.deleteProperty(index, key);
      changed = true;
    }
  }
  if (changed) saveSemanticIndex(vaultDir, index);

  const ranked = Object.entries(index)
    .map(([rel, entry]) => ({ rel, score: cosineSimilarity(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const notes: BrainNote[] = [];
  for (const { rel } of ranked) {
    try {
      const full = join(vaultDir, rel);
      const content = readFileSync(full, "utf8");
      notes.push({
        title: deriveTitle(content, rel),
        path: rel,
        modified: new Date(statSync(full).mtimeMs).toISOString(),
        snippet: buildSnippet(stripFrontmatter(content)),
      });
    } catch {
      // skip files removed mid-request
    }
  }
  writeJson(
    response,
    200,
    { configured: true, semantic: true, query: q, indexed: Object.keys(index).length, notes },
    corsOrigin,
  );
  return true;
};
