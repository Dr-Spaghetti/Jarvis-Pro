import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildGmailAuthUrl,
  buildGmailRedirectUri,
  generateOAuthState,
  readGmailConnectionStatus,
  removeEnvKeys,
  writeEnvKey,
} from "../src/gmail/gmailAuth";

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-gmail-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  delete process.env.GMAIL_REFRESH_TOKEN;
  delete process.env.GMAIL_USER_EMAIL;
  delete process.env.GMAIL_ACCESS_TOKEN;
});

describe("generateOAuthState", () => {
  it("returns a 32-character hex string", () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns unique values each call", () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});

describe("buildGmailAuthUrl", () => {
  it("includes required OAuth params", () => {
    const url = new URL(
      buildGmailAuthUrl("client-123", "http://127.0.0.1:8787/api/gmail/callback", "state-abc"),
    );
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8787/api/gmail/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });

  it("requests gmail read, send and modify scopes", () => {
    const url = new URL(buildGmailAuthUrl("c", "http://localhost/callback", "s"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.readonly");
    expect(scope).toContain("gmail.send");
    expect(scope).toContain("gmail.modify");
  });
});

describe("buildGmailRedirectUri", () => {
  it("appends the callback path to the base URL", () => {
    expect(buildGmailRedirectUri("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/api/gmail/callback",
    );
  });
});

describe("writeEnvKey", () => {
  it("appends a new key to an existing .env", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, ".env"), "FOO=bar\n");
    writeEnvKey(dir, "GMAIL_REFRESH_TOKEN", "rt-abc");
    const content = readFileSync(join(dir, ".env"), "utf8");
    expect(content).toContain("GMAIL_REFRESH_TOKEN=rt-abc");
    expect(content).toContain("FOO=bar");
    expect(process.env.GMAIL_REFRESH_TOKEN).toBe("rt-abc");
  });

  it("overwrites an existing key in place", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, ".env"), "GMAIL_REFRESH_TOKEN=old\nFOO=bar\n");
    writeEnvKey(dir, "GMAIL_REFRESH_TOKEN", "new-token");
    const content = readFileSync(join(dir, ".env"), "utf8");
    expect(content).toContain("GMAIL_REFRESH_TOKEN=new-token");
    expect(content).not.toContain("GMAIL_REFRESH_TOKEN=old");
    expect(content).toContain("FOO=bar");
  });

  it("creates .env if it does not exist", () => {
    const dir = makeTempDir();
    writeEnvKey(dir, "GMAIL_REFRESH_TOKEN", "fresh");
    const content = readFileSync(join(dir, ".env"), "utf8");
    expect(content).toContain("GMAIL_REFRESH_TOKEN=fresh");
  });

  it("silently ignores invalid key names", () => {
    const dir = makeTempDir();
    writeEnvKey(dir, "INVALID KEY!", "value");
    expect(() => readFileSync(join(dir, ".env"), "utf8")).toThrow();
  });
});

describe("removeEnvKeys", () => {
  it("removes specified keys from .env and process.env", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, ".env"), "GMAIL_REFRESH_TOKEN=rt\nGMAIL_USER_EMAIL=a@b.com\nFOO=bar\n");
    process.env.GMAIL_REFRESH_TOKEN = "rt";
    process.env.GMAIL_USER_EMAIL = "a@b.com";

    removeEnvKeys(dir, ["GMAIL_REFRESH_TOKEN", "GMAIL_USER_EMAIL"]);

    const content = readFileSync(join(dir, ".env"), "utf8");
    expect(content).not.toContain("GMAIL_REFRESH_TOKEN");
    expect(content).not.toContain("GMAIL_USER_EMAIL");
    expect(content).toContain("FOO=bar");
    expect(process.env.GMAIL_REFRESH_TOKEN).toBeUndefined();
    expect(process.env.GMAIL_USER_EMAIL).toBeUndefined();
  });
});

describe("readGmailConnectionStatus", () => {
  it("returns connected:false when env vars are absent", () => {
    const status = readGmailConnectionStatus();
    expect(status.connected).toBe(false);
  });

  it("returns connected:true with email when both env vars are set", () => {
    process.env.GMAIL_REFRESH_TOKEN = "rt-xyz";
    process.env.GMAIL_USER_EMAIL = "nick@example.com";
    const status = readGmailConnectionStatus();
    expect(status).toEqual({ connected: true, email: "nick@example.com" });
  });

  it("returns connected:false when only refresh token is present (no email)", () => {
    process.env.GMAIL_REFRESH_TOKEN = "rt-xyz";
    const status = readGmailConnectionStatus();
    expect(status.connected).toBe(false);
  });
});
