import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleGmailAuthRoute,
  handleGmailCallbackRoute,
  handleGmailStatusRoute,
} from "../src/createApiServer/gmailRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

// ─── helpers ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-gmail-routes-test-"));
  tempDirs.push(dir);
  return dir;
};

const makeRequest = (method: string): IncomingMessage =>
  ({
    method,
    headers: {},
    [Symbol.asyncIterator]: async function* () {},
  }) as unknown as IncomingMessage;

type CallResult = {
  handled: boolean;
  status: number;
  headers: Record<string, string | string[]>;
  json: Record<string, unknown> | null;
};

const makeResponse = (): {
  response: ServerResponse;
  getResult: () => Omit<CallResult, "handled">;
} => {
  let status = 0;
  const parts: string[] = [];
  const headers: Record<string, string | string[]> = {};
  const response = {
    writeHead(s: number, h?: Record<string, string | string[]>) {
      status = s;
      if (h) Object.assign(headers, h);
      return response;
    },
    setHeader(k: string, v: string) {
      headers[k] = v;
      return response;
    },
    end(chunk?: string) {
      if (chunk) parts.push(String(chunk));
    },
  } as unknown as ServerResponse;
  return {
    response,
    getResult: () => ({
      status,
      headers,
      json: parts.length ? (JSON.parse(parts.join("")) as Record<string, unknown>) : null,
    }),
  };
};

const makeDeps = (workspaceCwd: string, getApiBaseUrl = () => "http://localhost:8787") =>
  ({ workspaceCwd, getApiBaseUrl }) as unknown as RouteHandlerDependencies;

// ─── env cleanup ──────────────────────────────────────────────────────────────

const GMAIL_ENV_KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_ACCESS_TOKEN",
  "GMAIL_USER_EMAIL",
] as const;

const savedEnv: Partial<Record<(typeof GMAIL_ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of GMAIL_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of GMAIL_ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  vi.clearAllMocks();
});

// ─── handleGmailStatusRoute ───────────────────────────────────────────────────

describe("handleGmailStatusRoute", () => {
  const call = async (method: string, path: string) => {
    const { response, getResult } = makeResponse();
    const ctx: RouteHandlerContext = {
      request: makeRequest(method),
      response,
      requestUrl: new URL(path, "http://localhost"),
      corsOrigin: null,
    };
    const handled = await handleGmailStatusRoute(ctx, makeDeps(makeTempDir()));
    return { handled, ...getResult() };
  };

  it("returns false for unrelated paths", async () => {
    const { handled } = await call("GET", "/api/other");
    expect(handled).toBe(false);
  });

  it("returns 405 for non-GET methods", async () => {
    const { handled, status } = await call("POST", "/api/gmail/status");
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });

  it("returns {connected:false} when env vars absent", async () => {
    const { handled, status, json } = await call("GET", "/api/gmail/status");
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json).toMatchObject({ connected: false });
  });

  it("returns {connected:true} when refresh token and email are set", async () => {
    process.env.GMAIL_REFRESH_TOKEN = "rt-xyz";
    process.env.GMAIL_USER_EMAIL = "nick@example.com";
    const { status, json } = await call("GET", "/api/gmail/status");
    expect(status).toBe(200);
    expect(json).toEqual({ connected: true, email: "nick@example.com" });
  });
});

// ─── handleGmailAuthRoute GET ─────────────────────────────────────────────────

describe("handleGmailAuthRoute GET", () => {
  const call = async (method: string, path: string, cwd?: string) => {
    const { response, getResult } = makeResponse();
    const ctx: RouteHandlerContext = {
      request: makeRequest(method),
      response,
      requestUrl: new URL(path, "http://localhost"),
      corsOrigin: null,
    };
    const handled = await handleGmailAuthRoute(ctx, makeDeps(cwd ?? makeTempDir()));
    return { handled, ...getResult() };
  };

  it("returns false for unrelated paths", async () => {
    const { handled } = await call("GET", "/api/other");
    expect(handled).toBe(false);
  });

  it("returns 400 when GMAIL_CLIENT_ID is not set", async () => {
    const { handled, status, json } = await call("GET", "/api/gmail/auth");
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect((json as { error: string }).error).toContain("GMAIL_CLIENT_ID");
  });

  it("returns 200 with {url} containing accounts.google.com and state when GMAIL_CLIENT_ID is set", async () => {
    process.env.GMAIL_CLIENT_ID = "test-client-id";
    const { handled, status, json } = await call("GET", "/api/gmail/auth");
    expect(handled).toBe(true);
    expect(status).toBe(200);
    const url = new URL((json as { url: string }).url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
  });

  it("returns 405 for unsupported methods", async () => {
    const { handled, status } = await call("POST", "/api/gmail/auth");
    expect(handled).toBe(true);
    expect(status).toBe(405);
  });
});

// ─── handleGmailAuthRoute DELETE ─────────────────────────────────────────────

describe("handleGmailAuthRoute DELETE", () => {
  it("removes env keys and returns {connected:false}", async () => {
    process.env.GMAIL_REFRESH_TOKEN = "rt";
    process.env.GMAIL_ACCESS_TOKEN = "at";
    process.env.GMAIL_USER_EMAIL = "a@b.com";

    const cwd = makeTempDir();
    writeFileSync(
      join(cwd, ".env"),
      "GMAIL_REFRESH_TOKEN=rt\nGMAIL_ACCESS_TOKEN=at\nGMAIL_USER_EMAIL=a@b.com\n",
    );
    const { response, getResult } = makeResponse();
    const ctx: RouteHandlerContext = {
      request: makeRequest("DELETE"),
      response,
      requestUrl: new URL("/api/gmail/auth", "http://localhost"),
      corsOrigin: null,
    };
    const handled = await handleGmailAuthRoute(ctx, makeDeps(cwd));
    const { status, json } = getResult();

    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json).toEqual({ connected: false });
    expect(process.env.GMAIL_REFRESH_TOKEN).toBeUndefined();
    expect(process.env.GMAIL_ACCESS_TOKEN).toBeUndefined();
    expect(process.env.GMAIL_USER_EMAIL).toBeUndefined();
  });
});

// ─── handleGmailCallbackRoute ─────────────────────────────────────────────────

describe("handleGmailCallbackRoute", () => {
  const call = async (path: string, cwd?: string) => {
    const { response, getResult } = makeResponse();
    const ctx: RouteHandlerContext = {
      request: makeRequest("GET"),
      response,
      requestUrl: new URL(path, "http://localhost"),
      corsOrigin: null,
    };
    const handled = await handleGmailCallbackRoute(ctx, makeDeps(cwd ?? makeTempDir()));
    return { handled, ...getResult() };
  };

  it("returns false for unrelated paths", async () => {
    const { handled } = await call("/api/other");
    expect(handled).toBe(false);
  });

  it("redirects to /?gmail_error=access_denied when error param present", async () => {
    const { handled, status, headers } = await call("/api/gmail/callback?error=access_denied");
    expect(handled).toBe(true);
    expect(status).toBe(302);
    expect(headers.Location).toBe("/?gmail_error=access_denied");
  });

  it("redirects to /?gmail_error=invalid_state when state is unknown", async () => {
    const { handled, status, headers } = await call(
      "/api/gmail/callback?code=abc&state=unknown-state",
    );
    expect(handled).toBe(true);
    expect(status).toBe(302);
    expect(headers.Location).toBe("/?gmail_error=invalid_state");
  });

  it("redirects to /?gmail_error=missing_credentials when state is valid but secrets absent", async () => {
    process.env.GMAIL_CLIENT_ID = "cid";

    const cwd = makeTempDir();
    const deps = makeDeps(cwd);

    const authResponse = makeResponse();
    const authCtx: RouteHandlerContext = {
      request: makeRequest("GET"),
      response: authResponse.response,
      requestUrl: new URL("/api/gmail/auth", "http://localhost"),
      corsOrigin: null,
    };
    await handleGmailAuthRoute(authCtx, deps);
    const { json: authJson } = authResponse.getResult();
    const state = new URL((authJson as { url: string }).url).searchParams.get("state")!;

    delete process.env.GMAIL_CLIENT_ID;

    const { response, getResult } = makeResponse();
    const ctx: RouteHandlerContext = {
      request: makeRequest("GET"),
      response,
      requestUrl: new URL(`/api/gmail/callback?code=x&state=${state}`, "http://localhost"),
      corsOrigin: null,
    };
    const handled = await handleGmailCallbackRoute(ctx, deps);
    const { status, headers } = getResult();

    expect(handled).toBe(true);
    expect(status).toBe(302);
    expect(headers.Location).toBe("/?gmail_error=missing_credentials");
  });
});
