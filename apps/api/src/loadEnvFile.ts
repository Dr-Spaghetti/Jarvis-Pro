import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal, dependency-free `.env` loader. Octogent's bundled skills read API
// keys (GEMINI_API_KEY, XAI_API_KEY, JINA_API_KEY, ...) from the process
// environment, which the PTY runtime forwards to every spawned agent. Loading a
// project-local `.env` at startup means a single keystore powers all tentacles.
//
// Real environment variables always win — values already present in
// `process.env` are never overwritten.

const stripInlineQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

const VALID_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Load `<workspaceCwd>/.env` into `process.env` without overriding existing
 * values. Returns the list of keys that were newly set. Safe to call when no
 * `.env` exists (returns an empty array).
 */
export const loadEnvFile = (workspaceCwd: string): string[] => {
  const envPath = join(workspaceCwd, ".env");
  if (!existsSync(envPath)) return [];

  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return [];
  }

  const loadedKeys: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!VALID_KEY_PATTERN.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = stripInlineQuotes(withoutExport.slice(separatorIndex + 1));
    loadedKeys.push(key);
  }

  return loadedKeys;
};
