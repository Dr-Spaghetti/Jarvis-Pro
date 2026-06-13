import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computeBrainTileStats } from "../src/createApiServer/brainRoutes";

const tempDirs: string[] = [];
const makeVault = () => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-tiles-vault-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("computeBrainTileStats", () => {
  it("returns configured:false when no vault is set", () => {
    vi.stubEnv("OBSIDIAN_VAULT_PATH", "");
    expect(computeBrainTileStats()).toEqual({ configured: false });
  });

  it("counts notes, open tasks, and this-week journal entries", () => {
    const vault = makeVault();
    writeFileSync(join(vault, "a.md"), "# A\n- [ ] task one\n- [x] done\n", "utf8");
    writeFileSync(join(vault, "b.md"), "# B\n- [ ] task two\n", "utf8");
    mkdirSync(join(vault, "Journal"), { recursive: true });

    const now = Date.parse("2026-06-12T12:00:00.000Z");
    const recent = "2026-06-11T12:00:00.000Z"; // within 7 days
    const old = "2026-01-01T12:00:00.000Z"; // outside 7 days
    writeFileSync(
      join(vault, "Journal", "Activity Log.md"),
      [`- [${recent}] [ok] (ran-skill) did a thing`, `- [${old}] [ok] (ran-skill) ancient`].join(
        "\n",
      ),
      "utf8",
    );

    vi.stubEnv("OBSIDIAN_VAULT_PATH", vault);
    const stats = computeBrainTileStats(now);

    expect(stats.configured).toBe(true);
    if (stats.configured) {
      // a.md, b.md, and Journal/Activity Log.md all count as notes
      expect(stats.noteCount).toBe(3);
      // open tasks only counted outside Journal/ + Jarvis/
      expect(stats.openTaskCount).toBe(2);
      expect(stats.journalThisWeek).toBe(1);
    }
  });
});
