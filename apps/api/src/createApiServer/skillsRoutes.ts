import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { listSkillDefinitionFiles, readSkillMetadata } from "../claudeSkills";
import { resolveSkillsCatalogDir } from "../skillsCatalog";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const normalizeSkillName = (name: string): string =>
  name.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

type SkillEntry = { name: string; filePath: string };

const buildSkillFileList = (workspaceCwd: string): SkillEntry[] => {
  const results: SkillEntry[] = [];

  // Project skills (.claude/skills/) take priority.
  const projectRoot = join(workspaceCwd, ".claude", "skills");
  for (const filePath of listSkillDefinitionFiles(projectRoot)) {
    const { name } = readSkillMetadata(filePath);
    if (name.trim().length > 0) {
      results.push({ name: name.trim(), filePath });
    }
  }

  const seenNames = new Set(results.map((s) => normalizeSkillName(s.name)));

  // Bundled catalog skills — skip any that duplicate a project skill by name.
  const catalogDir = resolveSkillsCatalogDir();
  if (catalogDir) {
    for (const filePath of listSkillDefinitionFiles(catalogDir)) {
      const { name } = readSkillMetadata(filePath);
      const normalized = normalizeSkillName(name);
      if (name.trim().length > 0 && !seenNames.has(normalized)) {
        seenNames.add(normalized);
        results.push({ name: name.trim(), filePath });
      }
    }
  }

  return results;
};

const fuzzyFindSkill = (spoken: string, skills: SkillEntry[]): SkillEntry | null => {
  const needle = normalizeSkillName(spoken);
  if (needle.length === 0) return null;

  // 1. Exact normalized match.
  for (const skill of skills) {
    if (normalizeSkillName(skill.name) === needle) return skill;
  }

  // 2. Skills whose normalized name contains the needle (or vice-versa).
  for (const skill of skills) {
    const hay = normalizeSkillName(skill.name);
    if (hay.includes(needle) || needle.includes(hay)) return skill;
  }

  // 3. Word-overlap match — any skill whose name shares ≥50% of spoken words.
  const needleWords = needle.split(" ");
  let bestMatch: SkillEntry | null = null;
  let bestScore = 0;
  for (const skill of skills) {
    const hayWords = normalizeSkillName(skill.name).split(" ");
    const overlap = needleWords.filter((w) => hayWords.includes(w)).length;
    const score = overlap / Math.max(needleWords.length, hayWords.length);
    if (score >= 0.5 && score > bestScore) {
      bestScore = score;
      bestMatch = skill;
    }
  }
  return bestMatch;
};

export const handleSkillsRunRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd },
) => {
  if (requestUrl.pathname !== "/api/skills/run") return false;

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;

  const body = bodyReadResult.payload as Record<string, unknown> | null;
  const spokenName = body && typeof body.skillName === "string" ? body.skillName.trim() : "";
  if (spokenName.length === 0) {
    writeJson(response, 400, { error: "skillName is required" }, corsOrigin);
    return true;
  }

  const skills = buildSkillFileList(workspaceCwd);
  const matched = fuzzyFindSkill(spokenName, skills);

  if (!matched) {
    writeJson(response, 404, { error: `Skill not found: "${spokenName}"` }, corsOrigin);
    return true;
  }

  if (!existsSync(matched.filePath)) {
    writeJson(response, 404, { error: `Skill file missing: ${matched.name}` }, corsOrigin);
    return true;
  }

  let skillBody: string;
  try {
    skillBody = readFileSync(matched.filePath, "utf8");
  } catch {
    writeJson(response, 500, { error: `Could not read skill: ${matched.name}` }, corsOrigin);
    return true;
  }

  try {
    const snapshot = runtime.createTerminal({
      workspaceMode: "shared",
      tentacleName: `Skill: ${matched.name}`,
      initialPrompt: skillBody,
    });
    writeJson(
      response,
      200,
      { terminalId: snapshot.terminalId, skillName: matched.name },
      corsOrigin,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start skill";
    writeJson(response, 500, { error: message }, corsOrigin);
  }

  return true;
};
