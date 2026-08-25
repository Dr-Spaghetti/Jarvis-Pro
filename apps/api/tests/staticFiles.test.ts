import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveSafeStaticPath } from "../src/createApiServer/staticFiles";

const ROOT = join(tmpdir(), "octogent-web-dist");

describe("resolveSafeStaticPath", () => {
  it("serves index.html for /", () => {
    const resolved = resolveSafeStaticPath(ROOT, "/");
    expect(resolved).toBe(join(ROOT, "index.html"));
  });

  it("serves files inside the web dist dir", () => {
    const resolved = resolveSafeStaticPath(ROOT, "/assets/app.js");
    expect(resolved).toBe(join(ROOT, "assets", "app.js"));
  });

  it("rejects parent-directory traversal", () => {
    expect(resolveSafeStaticPath(ROOT, "/../.env")).toBeNull();
    expect(resolveSafeStaticPath(ROOT, "/assets/../../.env")).toBeNull();
    expect(resolveSafeStaticPath(ROOT, "/%2e%2e/%2e%2e/.env")).toBeNull();
  });
});
