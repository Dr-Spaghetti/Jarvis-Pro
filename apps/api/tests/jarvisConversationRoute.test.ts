import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleJarvisConversationTurnRoute } from "../src/createApiServer/jarvisConversationRoute";
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

let stateDir: string;
const temps: string[] = [];

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "octogent-jarvis-conv-"));
  temps.push(stateDir);
});

afterEach(() => {
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

const call = async (method: string, url: string, body?: unknown) => {
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
  const deps = { projectStateDir: stateDir } as unknown as RouteHandlerDependencies;
  const handled = await handleJarvisConversationTurnRoute(ctx, deps);
  const json = parts.length ? (JSON.parse(parts.join("")) as Record<string, unknown>) : null;
  return { handled, status, json };
};

describe("handleJarvisConversationTurnRoute", () => {
  it("POST /api/conversations/turn returns 400 when question is missing", async () => {
    const { handled, status, json } = await call("POST", "/api/conversations/jarvis/turn", {
      sessionId: "s1",
      answer: "some answer",
    });
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(json?.error).toMatch(/question/i);
  });

  it("POST /api/conversations/turn appends to the day transcript and returns turn data", async () => {
    const { handled, status, json } = await call("POST", "/api/conversations/jarvis/turn", {
      sessionId: "test-session",
      question: "What is the plan?",
      answer: "Build it step by step.",
      askedAt: "2026-07-06T10:00:00.000Z",
      answeredAt: "2026-07-06T10:00:01.000Z",
    });
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(json?.ok).toBe(true);

    const transcriptDir = join(stateDir, "state", "transcripts");
    const jsonlPath = join(transcriptDir, "test-session.jsonl");
    expect(existsSync(jsonlPath)).toBe(true);

    const lines = readFileSync(jsonlPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines.length).toBe(3); // session_start + input_submit + output_chunk
    expect(lines[0]!.type).toBe("session_start");
    expect(lines[1]!.type).toBe("input_submit");
    expect((lines[1]! as { text: string }).text).toBe("What is the plan?");
    expect(lines[2]!.type).toBe("output_chunk");
    expect((lines[2]! as { text: string }).text).toBe("Build it step by step.");
  });

  it("POST /api/conversations/turn returns not-configured when vault is absent", async () => {
    const { handled } = await call("POST", "/api/other/path", {
      sessionId: "s1",
      question: "q",
      answer: "a",
    });
    expect(handled).toBe(false);
  });
});
