import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installCatalogSkills,
  listCatalogSkills,
  readBundledCatalogSkills,
} from "../src/skillsCatalog";

const temporaryDirectories: string[] = [];
const previousCatalogDir = process.env.OCTOGENT_SKILLS_CATALOG_DIR;
const previousGeminiKey = process.env.GEMINI_API_KEY;

const writeCatalogSkill = (catalogDir: string, name: string, description: string) => {
  const skillDir = join(catalogDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    ["---", `name: ${name}`, `description: ${description}`, "---", "", `# ${name}`, ""].join("\n"),
    "utf8",
  );
};

let catalogDir: string;

beforeEach(() => {
  catalogDir = mkdtempSync(join(tmpdir(), "octogent-catalog-"));
  temporaryDirectories.push(catalogDir);

  writeCatalogSkill(catalogDir, "video-performance-analyzer", "Analyze short-form video.");
  writeCatalogSkill(catalogDir, "linkedin-asset-analyzer", "Analyze LinkedIn assets.");
  writeFileSync(
    join(catalogDir, "catalog.json"),
    JSON.stringify({
      "video-performance-analyzer": {
        requiredEnv: ["GEMINI_API_KEY"],
        runtime: ["python"],
        setup: "pip install google-genai",
      },
      "linkedin-asset-analyzer": { requiredEnv: [], runtime: [], setup: null },
    }),
    "utf8",
  );

  process.env.OCTOGENT_SKILLS_CATALOG_DIR = catalogDir;
  Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
});

afterEach(() => {
  if (previousCatalogDir === undefined) {
    Reflect.deleteProperty(process.env, "OCTOGENT_SKILLS_CATALOG_DIR");
  } else {
    process.env.OCTOGENT_SKILLS_CATALOG_DIR = previousCatalogDir;
  }
  if (previousGeminiKey === undefined) {
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
  } else {
    process.env.GEMINI_API_KEY = previousGeminiKey;
  }
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("skillsCatalog", () => {
  it("lists bundled skills with source 'bundled' and computes missing env", () => {
    const skills = listCatalogSkills();
    const names = skills.map((skill) => skill.name);
    expect(names).toEqual(["linkedin-asset-analyzer", "video-performance-analyzer"]);

    const video = skills.find((skill) => skill.name === "video-performance-analyzer");
    expect(video?.source).toBe("bundled");
    expect(video?.requiredEnv).toEqual(["GEMINI_API_KEY"]);
    expect(video?.missingEnv).toEqual(["GEMINI_API_KEY"]);

    const linkedin = skills.find((skill) => skill.name === "linkedin-asset-analyzer");
    expect(linkedin?.requiredEnv).toBeUndefined();
    expect(linkedin?.missingEnv).toBeUndefined();
  });

  it("reflects a satisfied env key in missingEnv", () => {
    process.env.GEMINI_API_KEY = "test-key";
    const video = listCatalogSkills().find((skill) => skill.name === "video-performance-analyzer");
    expect(video?.missingEnv).toEqual([]);
  });

  it("exposes the slim DeckAvailableSkill shape without folder/runtime", () => {
    const bundled = readBundledCatalogSkills();
    const video = bundled.find((skill) => skill.name === "video-performance-analyzer");
    expect(video).toMatchObject({ name: "video-performance-analyzer", source: "bundled" });
    expect(video).not.toHaveProperty("folder");
    expect(video).not.toHaveProperty("runtime");
  });

  it("installs a single skill into .claude/skills and is idempotent", () => {
    const workspace = mkdtempSync(join(tmpdir(), "octogent-workspace-"));
    temporaryDirectories.push(workspace);

    const first = installCatalogSkills(workspace, { names: ["video-performance-analyzer"] });
    expect(first.catalogFound).toBe(true);
    expect(first.installed).toEqual(["video-performance-analyzer"]);
    expect(
      existsSync(join(workspace, ".claude", "skills", "video-performance-analyzer", "SKILL.md")),
    ).toBe(true);

    const second = installCatalogSkills(workspace, { names: ["video-performance-analyzer"] });
    expect(second.installed).toEqual([]);
    expect(second.skipped.map((entry) => entry.name)).toEqual(["video-performance-analyzer"]);
  });

  it("installs all skills when no names are given", () => {
    const workspace = mkdtempSync(join(tmpdir(), "octogent-workspace-"));
    temporaryDirectories.push(workspace);

    const result = installCatalogSkills(workspace);
    expect(result.installed.sort()).toEqual([
      "linkedin-asset-analyzer",
      "video-performance-analyzer",
    ]);
  });

  it("reports unknown skills as errors", () => {
    const workspace = mkdtempSync(join(tmpdir(), "octogent-workspace-"));
    temporaryDirectories.push(workspace);

    const result = installCatalogSkills(workspace, { names: ["does-not-exist"] });
    expect(result.installed).toEqual([]);
    expect(result.errors.map((entry) => entry.name)).toEqual(["does-not-exist"]);
  });

  it("overwrites with force and preserves catalog content", () => {
    const workspace = mkdtempSync(join(tmpdir(), "octogent-workspace-"));
    temporaryDirectories.push(workspace);

    installCatalogSkills(workspace, { names: ["linkedin-asset-analyzer"] });
    const installedPath = join(
      workspace,
      ".claude",
      "skills",
      "linkedin-asset-analyzer",
      "SKILL.md",
    );
    writeFileSync(installedPath, "stale", "utf8");

    const forced = installCatalogSkills(workspace, {
      names: ["linkedin-asset-analyzer"],
      force: true,
    });
    expect(forced.installed).toEqual(["linkedin-asset-analyzer"]);
    expect(readFileSync(installedPath, "utf8")).toContain("name: linkedin-asset-analyzer");
  });
});
