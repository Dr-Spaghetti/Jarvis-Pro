import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pendingApprovals } from "../src/createApiServer/approvalStore";
import { handleGmailArchiveRoute, handleGmailReplyRoute } from "../src/createApiServer/lifeRoutes";
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
  projectStateDir = mkdtempSync(join(tmpdir(), "octogent-life-"));
});

afterEach(() => {
  rmSync(projectStateDir, { recursive: true, force: true });
});

describe("lifeRoutes — approvals, never silent send", () => {
  it("queues a reply as a pending gmail-send approval", async () => {
    const res = await call(handleGmailReplyRoute, "POST", "/api/gmail/reply", { projectStateDir }, {
      to: "ada@example.com",
      subject: "Re: Hello",
      body: "On my way.",
      threadId: "t1",
    });
    expect(res.status).toBe(201);
    expect(res.json.approval.kind).toBe("gmail-send");
    expect(res.json.approval.status).toBe("pending");
    expect(pendingApprovals(projectStateDir)).toHaveLength(1);
  });

  it("queues archive as a pending approval", async () => {
    const res = await call(
      handleGmailArchiveRoute,
      "POST",
      "/api/gmail/archive",
      { projectStateDir },
      { messageId: "m1", subject: "Hello" },
    );
    expect(res.status).toBe(201);
    expect(res.json.approval.kind).toBe("gmail-archive");
    expect(pendingApprovals(projectStateDir)[0]?.payload).toEqual({ messageId: "m1" });
  });
});
