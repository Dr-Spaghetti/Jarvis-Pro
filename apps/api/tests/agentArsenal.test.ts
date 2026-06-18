import { describe, expect, it } from "vitest";

import { AGENT_ARCHETYPES } from "../src/agentArsenal";
import type { AgentArchetypeCategory } from "../src/agentArsenal";

const VALID_CATEGORIES = new Set<AgentArchetypeCategory>([
  "technical",
  "strategy",
  "creative",
  "analysis",
  "operations",
]);

describe("AGENT_ARCHETYPES", () => {
  it("contains exactly 20 archetypes", () => {
    expect(AGENT_ARCHETYPES).toHaveLength(20);
  });

  it("has unique IDs across all archetypes", () => {
    const ids = AGENT_ARCHETYPES.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("has kebab-case IDs", () => {
    for (const a of AGENT_ARCHETYPES) {
      const isKebab = /^[a-z][a-z0-9-]*$/.test(a.id);
      expect(isKebab, `id "${a.id}" is not kebab-case`).toBe(true);
    }
  });

  it("has non-empty required string fields on every archetype", () => {
    for (const a of AGENT_ARCHETYPES) {
      expect(a.id.length, "id missing on archetype").toBeGreaterThan(0);
      expect(a.name.length, `name missing on "${a.id}"`).toBeGreaterThan(0);
      expect(a.role.length, `role missing on "${a.id}"`).toBeGreaterThan(0);
      expect(a.icon.length, `icon missing on "${a.id}"`).toBeGreaterThan(0);
      expect(a.systemPrompt.length, `systemPrompt missing on "${a.id}"`).toBeGreaterThan(100);
    }
  });

  it("uses only valid categories", () => {
    for (const a of AGENT_ARCHETYPES) {
      expect(
        VALID_CATEGORIES.has(a.category),
        `invalid category "${a.category}" on "${a.id}"`,
      ).toBe(true);
    }
  });

  it("covers all five categories", () => {
    const usedCategories = new Set(AGENT_ARCHETYPES.map((a) => a.category));
    for (const cat of VALID_CATEGORIES) {
      expect(usedCategories.has(cat), `no archetype in category "${cat}"`).toBe(true);
    }
  });

  it("has a skills array on every archetype", () => {
    for (const a of AGENT_ARCHETYPES) {
      expect(Array.isArray(a.skills), `skills is not an array on "${a.id}"`).toBe(true);
    }
  });

  it("has no duplicate names", () => {
    const names = AGENT_ARCHETYPES.map((a) => a.name.toLowerCase());
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("includes the coordination protocol in every systemPrompt", () => {
    for (const a of AGENT_ARCHETYPES) {
      expect(
        a.systemPrompt.includes("Coordination Protocol"),
        `"${a.id}" systemPrompt is missing the coordination protocol section`,
      ).toBe(true);
    }
  });
});
