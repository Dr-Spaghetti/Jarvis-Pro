import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { DeckAvailableSkill } from "@octogent/core";

const SKILL_MARKER_START = "<!-- octogent:suggested-skills:start -->";
const SKILL_MARKER_END = "<!-- octogent:suggested-skills:end -->";
const FRONT_MATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;
const H1_PATTERN = /^#\s+(.+)$/m;

const normalizeSkillNames = (skills: readonly string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const skill of skills) {
    const trimmed = skill.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.sort((a, b) => a.localeCompare(b));
};

const TOP_LEVEL_KEY_PATTERN = /^([A-Za-z0-9_-]+):(.*)$/;
const BLOCK_SCALAR_INDICATORS = new Set([">", "|", ">-", "|-", ">+", "|+"]);

/**
 * Parse YAML frontmatter into a flat string map. Supports inline scalars
 * (`key: value`, optionally quoted) and block scalars (`key: >` / `key: |`
 * followed by indented continuation lines), which Claude SKILL.md files use for
 * long descriptions.
 */
const parseFrontMatterFields = (frontMatter: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  const lines = frontMatter.split("\n");

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = line.match(TOP_LEVEL_KEY_PATTERN);
    if (!match) {
      index += 1;
      continue;
    }

    const key = (match[1] as string).trim();
    const inlineValue = (match[2] as string).trim();

    if (BLOCK_SCALAR_INDICATORS.has(inlineValue) || inlineValue.length === 0) {
      // Collect more-indented continuation lines as a block scalar.
      const collected: string[] = [];
      index += 1;
      while (index < lines.length) {
        const continuation = lines[index] ?? "";
        if (continuation.trim().length === 0) {
          collected.push("");
          index += 1;
          continue;
        }
        if (/^\s/.test(continuation)) {
          collected.push(continuation.trim());
          index += 1;
          continue;
        }
        break;
      }
      const literal = inlineValue.startsWith("|");
      fields[key] = (literal ? collected.join("\n") : collected.join(" ")).trim();
      continue;
    }

    fields[key] = inlineValue.replace(/^['"]|['"]$/g, "");
    index += 1;
  }

  return fields;
};

export const readSkillMetadata = (
  skillFilePath: string,
): { name: string; description: string; title: string | null } => {
  const fallbackName =
    basename(skillFilePath, ".md") === "SKILL"
      ? basename(dirname(skillFilePath))
      : basename(skillFilePath, ".md");
  try {
    const content = readFileSync(skillFilePath, "utf8");
    const frontMatterMatch = content.match(FRONT_MATTER_PATTERN);
    const fields = frontMatterMatch ? parseFrontMatterFields(frontMatterMatch[1] ?? "") : {};
    const name = fields.name && fields.name.length > 0 ? fields.name : null;
    const description = fields.description ?? "";

    const title = content.match(H1_PATTERN)?.[1]?.trim() ?? null;
    return {
      name: name ?? title ?? fallbackName,
      description,
      title,
    };
  } catch {
    return {
      name: fallbackName,
      description: "",
      title: null,
    };
  }
};

export const listSkillDefinitionFiles = (skillsRoot: string): string[] => {
  if (!existsSync(skillsRoot)) return [];

  const definitions: string[] = [];

  let entries: string[] = [];
  try {
    entries = readdirSync(skillsRoot);
  } catch {
    return definitions;
  }

  for (const entry of entries) {
    const entryPath = join(skillsRoot, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const skillFile = join(entryPath, "SKILL.md");
    if (existsSync(skillFile)) {
      definitions.push(skillFile);
    }
  }

  return definitions;
};

export const readAvailableClaudeSkills = (workspaceCwd: string): DeckAvailableSkill[] => {
  const roots: Array<{ path: string; source: DeckAvailableSkill["source"] }> = [
    { path: join(workspaceCwd, ".claude", "skills"), source: "project" },
  ];

  const seen = new Map<string, DeckAvailableSkill>();

  for (const root of roots) {
    const definitions = listSkillDefinitionFiles(root.path);
    for (const definition of definitions) {
      const metadata = readSkillMetadata(definition);
      const name = metadata.name.trim();
      if (name.length === 0 || seen.has(name)) continue;
      seen.set(name, {
        name,
        description: metadata.description,
        source: root.source,
      });
    }
  }

  return [...seen.values()].sort((a, b) => {
    if (a.source !== b.source) {
      return a.source === "project" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
};

export const parseSuggestedSkillsFromContext = (content: string): string[] => {
  const start = content.indexOf(SKILL_MARKER_START);
  const end = content.indexOf(SKILL_MARKER_END);
  if (start < 0 || end < 0 || end <= start) return [];

  const block = content.slice(start, end);
  const skills = block
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^- `(.+)`$/);
      return match?.[1]?.trim() ?? null;
    })
    .filter((skill): skill is string => skill !== null);

  return normalizeSkillNames(skills);
};

const renderSuggestedSkillsBlock = (skills: readonly string[]): string => {
  const normalized = normalizeSkillNames(skills);
  if (normalized.length === 0) return "";

  const items = normalized.map((skill) => `- \`${skill}\``).join("\n");
  return [
    SKILL_MARKER_START,
    "## Suggested Skills",
    "",
    "You can use these skills if you need to.",
    "",
    items,
    SKILL_MARKER_END,
  ].join("\n");
};

export const applySuggestedSkillsToContext = (
  content: string,
  skills: readonly string[],
): string => {
  const trimmedContent = content.trimEnd();
  const start = trimmedContent.indexOf(SKILL_MARKER_START);
  const end = trimmedContent.indexOf(SKILL_MARKER_END);
  const block = renderSuggestedSkillsBlock(skills);

  let withoutExistingBlock = trimmedContent;
  if (start >= 0 && end > start) {
    withoutExistingBlock = `${trimmedContent.slice(0, start).trimEnd()}\n${trimmedContent
      .slice(end + SKILL_MARKER_END.length)
      .trimStart()}`.trimEnd();
  }

  if (block.length === 0) {
    return `${withoutExistingBlock}\n`;
  }

  const base = withoutExistingBlock.length > 0 ? `${withoutExistingBlock}\n\n` : "";
  return `${base}${block}\n`;
};
