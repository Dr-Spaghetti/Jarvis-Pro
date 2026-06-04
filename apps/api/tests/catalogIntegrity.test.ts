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

  it("every loaded skill is registered in catalog.json (no orphan skills)", () => {
    // Folder -> manifest direction. A skill with a folder + SKILL.md but no
    // catalog.json entry silently loses its requiredEnv/runtime/setup metadata,
    // so it can appear in the deck while being impossible to configure.
    const manifestKeys = new Set(Object.keys(readCatalogManifest(catalogDir)));
    for (const skill of listCatalogSkills()) {
      expect(
        manifestKeys.has(skill.name),
        `skill "${skill.name}" has a folder + SKILL.md but no catalog.json entry (add one so its env/runtime/setup metadata is surfaced)`,
      ).toBe(true);
    }
  });

  it("every skill has a substantive description (>= 40 chars) for reliable triggering", () => {
    // Thin descriptions are the #1 cause of a skill never triggering when the
    // user actually needs it. Enforce a floor so new skills are discoverable.
    for (const skill of listCatalogSkills()) {
      const length = skill.description.trim().length;
      expect(
        length,
        `${skill.name}: description is too thin (${length} chars) — weak descriptions hurt triggering`,
      ).toBeGreaterThanOrEqual(40);
    }
  });

  it("code-bearing skills: every skill-local scripts/<file> reference resolves", () => {
    // Scope to skills that actually ship a scripts/ directory — those are the
    // ones whose SKILL.md "scripts/foo.py" references are skill-local helpers.
    // (Skills without a scripts/ dir may mention repo-level scripts in prose;
    // policing those would be false positives.)
    const scriptRef = /scripts\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g;
    for (const skill of listCatalogSkills()) {
      const skillDir = join(catalogDir, skill.folder);
      if (!existsSync(join(skillDir, "scripts"))) continue;
      const body = readFileSync(join(skillDir, "SKILL.md"), "utf8");
      for (const ref of new Set(body.match(scriptRef) ?? [])) {
        const clean = ref.replace(/[.)\]]+$/, "");
        expect(
          existsSync(join(skillDir, clean)),
          `${skill.name}: SKILL.md references "${clean}" but that file does not exist`,
        ).toBe(true);
      }
    }
  });
});
