import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeckAvailableSkill } from "@octogent/core";

import { listSkillDefinitionFiles, readSkillMetadata } from "./claudeSkills";

// The skills catalog is the set of skills bundled with Octogent. Bundled skills
// are always visible inside the dashboard (source: "bundled") without being
// copied into the user's workspace. `installCatalogSkills` exists for the
// explicit opt-in case of materializing a skill into `.claude/skills/` so plain
// Claude Code (outside Octogent) can discover it too.

export type CatalogSkillManifestEntry = {
  requiredEnv: string[];
  runtime: string[];
  setup: string | null;
};

// Candidate locations for the catalog, relative to this module's directory.
// Order matters: prefer the built copy, fall back to the source tree (dev/test).
const CATALOG_CANDIDATE_RELATIVE_DIRS: readonly string[][] = [
  ["..", "skills-catalog"], // dist/api -> dist/skills-catalog (published build)
  ["..", "..", "skills-catalog"], // dist -> packageRoot/skills-catalog (defensive)
  ["..", "..", "..", "skills-catalog"], // apps/api/src -> repoRoot/skills-catalog (dev, vitest)
];

const looksLikeCatalog = (candidate: string): boolean =>
  existsSync(join(candidate, "catalog.json")) || listSkillDefinitionFiles(candidate).length > 0;

/**
 * Resolve the directory that holds the bundled skills catalog, or null when it
 * cannot be found. Honors the `OCTOGENT_SKILLS_CATALOG_DIR` override first so
 * dev/test runs and unusual installs can pin an explicit path.
 */
export const resolveSkillsCatalogDir = (): string | null => {
  const override = process.env.OCTOGENT_SKILLS_CATALOG_DIR?.trim();
  if (override) {
    return existsSync(override) ? override : null;
  }

  const here =
    import.meta.dirname ?? (import.meta.url ? dirname(fileURLToPath(import.meta.url)) : null);
  if (!here) return null;

  for (const relativeDir of CATALOG_CANDIDATE_RELATIVE_DIRS) {
    const candidate = join(here, ...relativeDir);
    if (existsSync(candidate) && looksLikeCatalog(candidate)) {
      return candidate;
    }
  }

  return null;
};

export const readCatalogManifest = (
  catalogDir: string,
): Record<string, CatalogSkillManifestEntry> => {
  const manifestPath = join(catalogDir, "catalog.json");
  if (!existsSync(manifestPath)) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return {};
  }

  if (raw === null || typeof raw !== "object") return {};

  const result: Record<string, CatalogSkillManifestEntry> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    result[name] = {
      requiredEnv: Array.isArray(entry.requiredEnv)
        ? entry.requiredEnv.filter((item): item is string => typeof item === "string")
        : [],
      runtime: Array.isArray(entry.runtime)
        ? entry.runtime.filter((item): item is string => typeof item === "string")
        : [],
      setup: typeof entry.setup === "string" ? entry.setup : null,
    };
  }

  return result;
};

const computeMissingEnv = (requiredEnv: readonly string[]): string[] =>
  requiredEnv.filter((key) => {
    const value = process.env[key];
    return value === undefined || value.trim().length === 0;
  });

/**
 * Map of catalog skill folder name -> absolute source directory. The folder
 * name is what gets copied on install; the frontmatter `name` is what surfaces
 * in the UI (the two match for all bundled skills).
 */
const readCatalogFolders = (catalogDir: string): Map<string, string> => {
  const folders = new Map<string, string>();
  for (const skillFile of listSkillDefinitionFiles(catalogDir)) {
    const sourceDir = dirname(skillFile);
    folders.set(basename(sourceDir), sourceDir);
  }
  return folders;
};

export type CatalogSkillSummary = DeckAvailableSkill & {
  source: "bundled";
  folder: string;
  runtime: string[];
  setup: string | null;
};

/** Rich catalog listing used by CLI commands (includes folder + setup hints). */
export const listCatalogSkills = (): CatalogSkillSummary[] => {
  const catalogDir = resolveSkillsCatalogDir();
  if (!catalogDir) return [];

  const manifest = readCatalogManifest(catalogDir);
  const summaries: CatalogSkillSummary[] = [];

  for (const [folder, sourceDir] of readCatalogFolders(catalogDir)) {
    const metadata = readSkillMetadata(join(sourceDir, "SKILL.md"));
    const name = metadata.name.trim() || folder;
    const entry = manifest[name] ?? manifest[folder];
    const requiredEnv = entry?.requiredEnv ?? [];

    summaries.push({
      name,
      description: metadata.description,
      source: "bundled",
      folder,
      runtime: entry?.runtime ?? [],
      setup: entry?.setup ?? null,
      ...(requiredEnv.length > 0
        ? { requiredEnv, missingEnv: computeMissingEnv(requiredEnv) }
        : {}),
    });
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
};

/** Slimmer listing for the deck/API surface (DeckAvailableSkill shape). */
export const readBundledCatalogSkills = (): DeckAvailableSkill[] =>
  listCatalogSkills().map(({ name, description, source, requiredEnv, missingEnv }) => ({
    name,
    description,
    source,
    ...(requiredEnv ? { requiredEnv } : {}),
    ...(missingEnv ? { missingEnv } : {}),
  }));

export type InstallCatalogSkillsResult = {
  catalogFound: boolean;
  installed: string[];
  skipped: { name: string; reason: string }[];
  errors: { name: string; error: string }[];
};

/**
 * Copy bundled catalog skills into `<workspaceCwd>/.claude/skills/`. Idempotent:
 * existing skill folders are skipped unless `force` is set. When `names` is
 * omitted, every catalog skill is installed.
 */
export const installCatalogSkills = (
  workspaceCwd: string,
  options?: { names?: string[]; force?: boolean },
): InstallCatalogSkillsResult => {
  const result: InstallCatalogSkillsResult = {
    catalogFound: false,
    installed: [],
    skipped: [],
    errors: [],
  };

  const catalogDir = resolveSkillsCatalogDir();
  if (!catalogDir) return result;
  result.catalogFound = true;

  const folders = readCatalogFolders(catalogDir);
  const requested =
    options?.names && options.names.length > 0 ? options.names : [...folders.keys()];
  const destinationRoot = join(workspaceCwd, ".claude", "skills");

  for (const requestedName of requested) {
    const sourceDir = folders.get(requestedName);
    if (!sourceDir) {
      result.errors.push({ name: requestedName, error: "Not found in catalog" });
      continue;
    }

    const destinationDir = join(destinationRoot, requestedName);
    if (existsSync(destinationDir) && !options?.force) {
      result.skipped.push({ name: requestedName, reason: "already installed" });
      continue;
    }

    try {
      mkdirSync(destinationRoot, { recursive: true });
      cpSync(sourceDir, destinationDir, { recursive: true });
      result.installed.push(requestedName);
    } catch (error) {
      result.errors.push({
        name: requestedName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
};
