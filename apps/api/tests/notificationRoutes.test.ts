import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  handleNotificationsCollectionRoute,
  handleNotificationsReadRoute,
} from "../src/createApiServer/notificationRoutes";
import type {
  RouteHandlerContext,
  RouteHandlerDependencies,
} from "../src/createApiServer/routeHelpers";

const makeRequest = (method: string, body?: unknown): IncomingMessage => {
  const req = { method } as unknown as IncomingMessage & { [Symbol.asyncIterator]?: unknown };
  if (body !== undefined) {
    const buf = Buffer.from(JSON.stringify(body));
    (req as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () {
        yield buf;
      };
  }
  return req;
};

const call = async (
  handler: (c: RouteHandlerContext, d: RouteHandlerDependencies) => Promise<boolean>,
  method: string,
  url: string,
  deps: Partial<RouteHandlerDependencies>,
  body?: unknown,
) => {
  let status = 0;
  const parts: string[] = [];
  const response = {
    writeHead(s: number) {
      status = s;
      return response;
    },
    end(chunk?: string) {
      if (chunk) parts.push(String(chunk));
    },
  } as unknown as ServerResponse;
  const ctx: RouteHandlerContext = {
    request: makeRequest(method, body),
    response,
    requestUrl: new URL(url, "http://localhost"),
    corsOrigin: null,
  };
  const handled = await handler(ctx, deps as RouteHandlerDependencies);
  const json = parts.length ? JSON.parse(parts.join("")) : null;
  return { handled, status, json };
};

let projectStateDir: string;

beforeEach(() => {
  projectStateDir = mkdtempSync(join(tmpdir(), "octogent-notifications-"));
});

afterEach(() => {
  rmSync(projectStateDir, { recursive: true, force: true });
});

describe("notificationRoutes", () => {
  it("GET /api/notifications returns empty list on fresh workspace", async () => {
    const res = await call(handleNotificationsCollectionRoute, "GET", "/api/notifications", {
      projectStateDir,
    });
    expect(res.handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json.notifications).toEqual([]);
    expect(res.json.unreadCount).toBe(0);
  });

  it("POST /api/notifications creates and returns a notification", async () => {
    const res = await call(
      handleNotificationsCollectionRoute,
      "POST",
      "/api/notifications",
      { projectStateDir },
      { title: "Deploy finished", type: "info" },
    );
    expect(res.handled).toBe(true);
    expect(res.status).toBe(201);
    expect(res.json.ok).toBe(true);
    expect(res.json.notification.title).toBe("Deploy finished");
    expect(res.json.notification.type).toBe("info");
    expect(res.json.notification.read).toBe(false);
    expect(typeof res.json.notification.id).toBe("string");
  });

  it("POST /api/notifications/:id/read marks all notifications read", async () => {
    // First create a notification
    await call(
      handleNotificationsCollectionRoute,
      "POST",
      "/api/notifications",
      { projectStateDir },
      { title: "Hello" },
    );

    // Mark all as read via /api/notifications/read
    const readRes = await call(handleNotificationsReadRoute, "POST", "/api/notifications/read", {
      projectStateDir,
    });
    expect(readRes.handled).toBe(true);
    expect(readRes.status).toBe(200);
    expect(readRes.json.ok).toBe(true);

    // Verify unreadCount is now 0
    const listRes = await call(handleNotificationsCollectionRoute, "GET", "/api/notifications", {
      projectStateDir,
    });
    expect(listRes.json.unreadCount).toBe(0);
  });
});
