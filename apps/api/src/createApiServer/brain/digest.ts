import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "../routeHelpers";
import { writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { JOURNAL_PATH, type JournalEntry, parseJournalLine } from "./journal";
import { MEMORY_PATH } from "./memory";
import {
  buildSnippet,
  deriveTitle,
  listMarkdownFiles,
  resolveVaultDir,
  stripFrontmatter,
  toPosix,
  type BrainNote,
} from "./vault";

export const localDateStamp = (): string => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

const OPEN_TASK = /^\s*[-*]\s+\[ \]\s+(.+?)\s*$/;
const MAX_DIGEST_TASKS = 30;

export type BrainDigest = {
  configured: boolean;
  date: string;
  dailyNote: { exists: boolean; path: string | null };
  recentNotes: BrainNote[];
  tasks: { open: string[]; openCount: number };
  journal: JournalEntry[];
  memory: { factCount: number };
};

export const computeBrainDigest = (): BrainDigest => {
  const date = localDateStamp();
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    return {
      configured: false,
      date,
      dailyNote: { exists: false, path: null },
      recentNotes: [],
      tasks: { open: [], openCount: 0 },
      journal: [],
      memory: { factCount: 0 },
    };
  }

  const dailyRel = `Daily/${date}.md`;
  const dailyExists = existsSync(join(vaultDir, dailyRel));

  const scored: Array<{ mtime: number; note: BrainNote }> = [];
  const openTasks: string[] = [];
  for (const rel of listMarkdownFiles(vaultDir)) {
    const relPosix = toPosix(rel);
    try {
      const mtime = statSync(join(vaultDir, rel)).mtimeMs;
      const content = readFileSync(join(vaultDir, rel), "utf8");
      scored.push({
        mtime,
        note: {
          title: deriveTitle(content, rel),
          path: relPosix,
          modified: new Date(mtime).toISOString(),
          snippet: buildSnippet(stripFrontmatter(content)),
        },
      });
      if (!relPosix.startsWith("Journal/") && !relPosix.startsWith("Jarvis/")) {
        for (const line of content.split(/\r?\n/)) {
          if (openTasks.length >= MAX_DIGEST_TASKS) break;
          const match = OPEN_TASK.exec(line);
          if (match?.[1]) openTasks.push(match[1].trim());
        }
      }
    } catch {
      // skip unreadable
    }
  }
  scored.sort((a, b) => b.mtime - a.mtime);

  const journal: JournalEntry[] = [];
  const journalFile = join(vaultDir, JOURNAL_PATH);
  if (existsSync(journalFile)) {
    try {
      for (const line of readFileSync(journalFile, "utf8").split(/\r?\n/)) {
        const entry = parseJournalLine(line);
        if (entry) journal.push(entry);
      }
    } catch {
      // ignore
    }
  }

  let factCount = 0;
  const memoryFile = join(vaultDir, MEMORY_PATH);
  if (existsSync(memoryFile)) {
    try {
      factCount = readFileSync(memoryFile, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trimStart().startsWith("- ")).length;
    } catch {
      // ignore
    }
  }

  return {
    configured: true,
    date,
    dailyNote: { exists: dailyExists, path: dailyExists ? dailyRel : null },
    recentNotes: scored.slice(0, 5).map((entry) => entry.note),
    tasks: { open: openTasks, openCount: openTasks.length },
    journal: journal.reverse().slice(0, 5),
    memory: { factCount },
  };
};

export type BrainTileStats =
  | { configured: false }
  | { configured: true; noteCount: number; openTaskCount: number; journalThisWeek: number };

export const computeBrainTileStats = (now: number = Date.now()): BrainTileStats => {
  const vaultDir = resolveVaultDir();
  if (!vaultDir) return { configured: false };

  let noteCount = 0;
  let openTaskCount = 0;
  for (const rel of listMarkdownFiles(vaultDir)) {
    noteCount += 1;
    const relPosix = toPosix(rel);
    if (relPosix.startsWith("Journal/") || relPosix.startsWith("Jarvis/")) continue;
    try {
      const content = readFileSync(join(vaultDir, rel), "utf8");
      for (const line of content.split(/\r?\n/)) {
        if (OPEN_TASK.test(line)) openTaskCount += 1;
      }
    } catch {
      // skip unreadable
    }
  }

  let journalThisWeek = 0;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const journalFile = join(vaultDir, JOURNAL_PATH);
  if (existsSync(journalFile)) {
    try {
      for (const line of readFileSync(journalFile, "utf8").split(/\r?\n/)) {
        const entry = parseJournalLine(line);
        if (entry) {
          const ts = Date.parse(entry.ts);
          if (!Number.isNaN(ts) && ts >= weekAgo) journalThisWeek += 1;
        }
      }
    } catch {
      // ignore
    }
  }

  return { configured: true, noteCount, openTaskCount, journalThisWeek };
};

export const handleBrainDigestRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/digest") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  writeJson(response, 200, computeBrainDigest(), corsOrigin);
  return true;
};
