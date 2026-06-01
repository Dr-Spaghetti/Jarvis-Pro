import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listCatalogSkills, readCatalogManifest } from "../src/skillsCatalog";

// Integrity guardrail for the bundled skills catalog. This runs against the REAL
// skills-catalog (not a temp fixture) so that any malformed skill a contributor
// adds — bad JSON, wrong shape, folder/name mismatch, unloadable SKILL.md — fails
// the suite before it can reach a working build. This is what lets the catalog
// grow indefinitely without breaking the tool.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const catalogDir = join(repoRoot, "skills-catalog");
const previousOverride = process.env.OCTOGENT_SKILLS_CATALOG_DIR;

beforeAll(() => {
  process.env.OCTOGENT_SKILLS_CATALOG_DIR = catalogDir;
});

afterAll(() => {
  if (previousOverride === undefined) {
    Reflect.deleteProperty(process.env, "OCTOGENT_SKILLS_CATALOG_DIR");
  } else {
    process.env.OCTOGENT_SKILLS_CATALOG_DIR = previousOverride;
  }
});

describe("bundled skills catalog integrity", () => {
  it("ships a catalog.json that is valid JSON", () => {
    const raw = readFileSync(join(catalogDir, "catalog.json"), "utf8");
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  it("every catalog.json entry is well-formed and maps to a real skill folder", () => {
    const manifest = readCatalogManifest(catalogDir);
    const entries = Object.entries(manifest);
    expect(entries.length).toBeGreaterThan(0);

    for (const [name, entry] of entries) {
      expect(Array.isArray(entry.requiredEnv), `${name}.requiredEnv must be an array`).toBe(true);
      expect(
        entry.requiredEnv.every((value) => typeof value === "string"),
        `${name}.requiredEnv must be strings`,
      ).toBe(true);
      expect(Array.isArray(entry.runtime), `${name}.runtime must be an array`).toBe(true);
      expect(
        entry.setup === null || typeof entry.setup === "string",
        `${name}.setup must be a string or null`,
      ).toBe(true);
      // The manifest key must correspond to a real skill folder (folder == name).
      expect(
        existsSync(join(catalogDir, name, "SKILL.md")),
        `manifest key "${name}" must have skills-catalog/${name}/SKILL.md`,
      ).toBe(true);
    }
  });

  it("every bundled skill loads with a name + description and folder matching its name", () => {
    const skills = listCatalogSkills();
    // Sanity floor — we have well over this many; guards against a silent empty load.
    expect(skills.length).toBeGreaterThanOrEqual(15);

    const names = new Set<string>();
    for (const skill of skills) {
      expect(skill.source).toBe("bundled");
      expect(skill.name.trim().length, "skill name must be non-empty").toBeGreaterThan(0);
      expect(
        skill.description.trim().length,
        `${skill.name} must have a non-empty description`,
      ).toBeGreaterThan(0);
      // Folder name must equal the frontmatter name so `skills install --skill <name>`
      // and the displayed name always line up.
      expect(skill.folder, `${skill.name}: folder "${skill.folder}" must equal its name`).toBe(
        skill.name,
      );
      expect(names.has(skill.name), `duplicate skill name: ${skill.name}`).toBe(false);
      names.add(skill.name);
    }
  });
});
