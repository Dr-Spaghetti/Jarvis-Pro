import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ConversationTurn } from "@octogent/core";

import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const TRANSCRIPTS_SUBDIR = join("state", "transcripts");
const TENTACLE_ID = "jarvis-hq";

const transcriptFilename = (sessionId: string) => `${encodeURIComponent(sessionId)}.jsonl`;
const turnsFilename = (sessionId: string) =>
  `${encodeURIComponent(sessionId)}.claude-turns.json`;

export const handleJarvisConversationTurnRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/conversations/jarvis/turn") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const payload =
    body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
  const askedAt =
    typeof payload.askedAt === "string" ? payload.askedAt : new Date().toISOString();
  const answeredAt =
    typeof payload.answeredAt === "string" ? payload.answeredAt : new Date().toISOString();

  if (!sessionId || !question || !answer) {
    writeJson(
      response,
      400,
      { error: "sessionId, question, and answer are required." },
      corsOrigin,
    );
    return true;
  }

  const transcriptDir = join(projectStateDir, TRANSCRIPTS_SUBDIR);
  if (!existsSync(transcriptDir)) mkdirSync(transcriptDir, { recursive: true });

  const jsonlPath = join(transcriptDir, transcriptFilename(sessionId));
  const turnsPath = join(transcriptDir, turnsFilename(sessionId));

  const jsonlExists = existsSync(jsonlPath);
  let eventCount = 0;
  if (jsonlExists) {
    try {
      const existing = readFileSync(jsonlPath, "utf8");
      eventCount = existing.split("\n").filter((l) => l.trim().length > 0).length;
    } catch {
      // start from zero
    }
  }

  const nextId = () => {
    eventCount += 1;
    return `${sessionId}:${eventCount}`;
  };

  const lines: string[] = [];

  if (!jsonlExists) {
    lines.push(
      JSON.stringify({
        type: "session_start",
        eventId: nextId(),
        sessionId,
        tentacleId: TENTACLE_ID,
        timestamp: askedAt,
      }),
    );
  }

  const submitId = `submit-${Date.now()}`;
  lines.push(
    JSON.stringify({
      type: "input_submit",
      eventId: nextId(),
      sessionId,
      tentacleId: TENTACLE_ID,
      timestamp: askedAt,
      submitId,
      text: question,
    }),
  );

  const chunkId = `chunk-${Date.now() + 1}`;
  lines.push(
    JSON.stringify({
      type: "output_chunk",
      eventId: nextId(),
      sessionId,
      tentacleId: TENTACLE_ID,
      timestamp: answeredAt,
      chunkId,
      text: answer,
    }),
  );

  try {
    appendFileSync(jsonlPath, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    writeJson(
      response,
      500,
      { error: error instanceof Error ? error.message : "transcript write failed" },
      corsOrigin,
    );
    return true;
  }

  // Update claude-turns.json so the session shows up in Recent Convos
  let existingTurns: ConversationTurn[] = [];
  if (existsSync(turnsPath)) {
    try {
      existingTurns = JSON.parse(readFileSync(turnsPath, "utf8")) as ConversationTurn[];
    } catch {
      // start fresh
    }
  }

  const newTurns: ConversationTurn[] = [
    {
      turnId: submitId,
      role: "user",
      content: question,
      startedAt: askedAt,
      endedAt: askedAt,
    },
    {
      turnId: chunkId,
      role: "assistant",
      content: answer,
      startedAt: answeredAt,
      endedAt: answeredAt,
    },
  ];

  try {
    writeFileSync(
      turnsPath,
      JSON.stringify([...existingTurns, ...newTurns], null, 2),
      "utf8",
    );
  } catch (error) {
    writeJson(
      response,
      500,
      { error: error instanceof Error ? error.message : "turns write failed" },
      corsOrigin,
    );
    return true;
  }

  writeJson(response, 200, { ok: true }, corsOrigin);
  return true;
};
