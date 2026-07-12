import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export const MAX_FILES_SCANNED = 2000;

export type BrainNote = { title: string; path: string; modified: string; snippet: string };

let _vaultWarnedOnce = false;
export const resolveVaultDir = (): string | null => {
  const dir = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!dir || !existsSync(dir)) {
    if (!_vaultWarnedOnce) {
      console.warn("[vault] OBSIDIAN_VAULT_PATH not set or path does not exist — vault features disabled.");
      _vaultWarnedOnce = true;
    }
    return null;
  }
  return dir;
};

const isIgnored = (relPath: string): boolean => {
  const parts = relPath.split(/[\\/]/);
  return parts.some(
    (p) => p === ".obsidian" || p === ".git" || p === "node_modules" || p === ".trash",
  );
};

export const listMarkdownFiles = (vaultDir: string): string[] => {
  let entries: string[] = [];
  try {
    entries = readdirSync(vaultDir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const rel = String(entry);
    if (!rel.toLowerCase().endsWith(".md")) continue;
    if (isIgnored(rel)) continue;
    files.push(rel);
    if (files.length >= MAX_FILES_SCANNED) break;
  }
  return files;
};

export const stripFrontmatter = (content: string): string =>
  content.replace(/^---\n[\s\S]*?\n---\n?/, "");

export const deriveTitle = (content: string, relPath: string): string => {
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) return h1;
  return basename(relPath, ".md");
};

export const buildSnippet = (body: string, around?: string): string => {
  const text = body
    .replace(/^#+\s+/gm, "")
    .replace(/[*_>`#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (around) {
    const idx = text.toLowerCase().indexOf(around.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      return `${start > 0 ? "…" : ""}${text.slice(start, start + 180)}…`;
    }
  }
  return text.slice(0, 180);
};

export const toPosix = (p: string): string => p.split(sep).join("/");

export const readNote = (
  vaultDir: string,
  relPath: string,
): { content: string; modified: string } | null => {
  const target = resolve(vaultDir, relPath);
  const root = resolve(vaultDir);
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (!target.toLowerCase().endsWith(".md") || !existsSync(target)) return null;
  try {
    return {
      content: readFileSync(target, "utf8"),
      modified: statSync(target).mtime.toISOString(),
    };
  } catch {
    return null;
  }
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const oneLine = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

export const ensureAndAppend = (
  vaultDir: string,
  relPath: string,
  header: string,
  line: string,
): string => {
  const target = join(vaultDir, relPath);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(target)) appendFileSync(target, header, "utf8");
  appendFileSync(target, line, "utf8");
  return toPosix(relPath);
};
