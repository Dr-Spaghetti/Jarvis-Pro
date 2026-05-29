// Normalize line endings to LF for all tracked text files. The repo enforces
// `eol=lf` via .gitattributes; this script makes the working tree match so
// tools that parse exact byte patterns (e.g. SKILL.md frontmatter) behave
// consistently across platforms.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".vite"]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".css",
  ".md",
  ".py",
  ".sh",
  ".txt",
  ".yaml",
  ".yml",
  ".html",
  ".mts",
]);

const EXTENSIONLESS_TEXT_FILES = new Set(["octogent", "LICENSE", ".gitignore", ".gitattributes"]);

let changed = 0;

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (IGNORED_DIRS.has(entry)) continue;
      walk(fullPath);
      continue;
    }

    const isText = TEXT_EXTENSIONS.has(extname(entry)) || EXTENSIONLESS_TEXT_FILES.has(entry);
    if (!isText) continue;

    const content = readFileSync(fullPath, "utf8");
    if (!content.includes("\r\n")) continue;

    writeFileSync(fullPath, content.replace(/\r\n/g, "\n"), "utf8");
    changed += 1;
  }
};

walk(repoRoot);
console.log(`normalize-eol: converted ${changed} file(s) to LF`);
