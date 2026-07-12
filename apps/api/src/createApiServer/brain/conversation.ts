import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "../routeHelpers";
import { writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { localDateStamp } from "./digest";
import { ensureAndAppend, oneLine, resolveVaultDir } from "./vault";

const CONVERSATION_DIR = "Jarvis/Conversations";
const CONVERSATION_HEADER =
  "# Jarvis Conversations\n\nRunning transcript of voice & text chats (newest at the bottom).\n" +
  "Jarvis replays recent turns for continuity — review here to see what works.\n\n";

const conversationRelPath = (): string => `${CONVERSATION_DIR}/${localDateStamp()}.md`;

export type ConversationTurn = { time: string; question: string; answer: string };

export const parseConversationMarkdown = (content: string): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  for (const block of content.split(/\n(?=## )/)) {
    const you = block.match(/\*\*You:\*\*\s*([\s\S]*?)\n\n\*\*Jarvis:\*\*/)?.[1];
    const jarvis = block.match(/\*\*Jarvis:\*\*\s*([\s\S]*)$/)?.[1];
    if (you === undefined || jarvis === undefined) continue;
    const time = block.match(/^##\s*(.+)$/m)?.[1]?.trim() ?? "";
    turns.push({ time, question: you.trim(), answer: jarvis.trim() });
  }
  return turns;
};

export const readConversationTurns = (vaultDir: string, limit: number): ConversationTurn[] => {
  const file = join(vaultDir, conversationRelPath());
  if (!existsSync(file)) return [];
  try {
    return parseConversationMarkdown(readFileSync(file, "utf8")).slice(-limit);
  } catch {
    return [];
  }
};

export const appendConversationTurn = (
  vaultDir: string,
  question: string,
  answer: string,
): void => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  // Sanitize: prevent literal **You:** / **Jarvis:** in content from breaking the parser
  const safeAnswer = answer.trim().replace(/\*\*You:\*\*/g, "You:").replace(/\*\*Jarvis:\*\*/g, "Jarvis:");
  const block = `## ${hh}:${mm}\n\n**You:** ${oneLine(question)}\n\n**Jarvis:** ${safeAnswer}\n\n`;
  try {
    ensureAndAppend(vaultDir, conversationRelPath(), CONVERSATION_HEADER, block);
  } catch {
    // Best-effort logging; never block the answer if the vault write fails.
  }
};

export const handleBrainConversationRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/conversation") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const vaultDir = resolveVaultDir();
  if (!vaultDir) {
    writeJson(response, 200, { configured: false, turns: [] }, corsOrigin);
    return true;
  }
  const limit = Math.min(200, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 50));
  writeJson(
    response,
    200,
    { configured: true, date: localDateStamp(), turns: readConversationTurns(vaultDir, limit) },
    corsOrigin,
  );
  return true;
};
