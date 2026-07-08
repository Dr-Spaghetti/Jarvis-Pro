import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { logVerbose } from "../logging";
import type { ChannelMessage, PersistedTerminal, TerminalSession } from "./types";

const CHANNEL_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

export const createChannelMessaging = (deps: {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  writeInput: (terminalId: string, data: string) => boolean;
  persistPath?: string;
}) => {
  const { terminals, sessions, writeInput, persistPath } = deps;
  const channelQueues = new Map<string, ChannelMessage[]>();
  let channelMessageCounter = 0;

  const saveQueues = () => {
    if (!persistPath) return;
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      const payload: Record<string, ChannelMessage[]> = {};
      for (const [id, queue] of channelQueues) {
        if (queue.length > 0) payload[id] = queue;
      }
      const tmp = `${persistPath}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      renameSync(tmp, persistPath);
    } catch {
      // persist failures are non-fatal — in-memory state is still valid
    }
  };

  // Load persisted queues on startup, discarding messages beyond TTL.
  if (persistPath && existsSync(persistPath)) {
    try {
      const raw = JSON.parse(readFileSync(persistPath, "utf8")) as Record<string, ChannelMessage[]>;
      const cutoff = Date.now() - CHANNEL_MESSAGE_TTL_MS;
      let loaded = 0;
      for (const [terminalId, messages] of Object.entries(raw)) {
        const fresh = messages.filter(
          (m) => !m.delivered && new Date(m.timestamp).getTime() > cutoff,
        );
        if (fresh.length > 0) {
          channelQueues.set(terminalId, fresh);
          loaded += fresh.length;
          channelMessageCounter = Math.max(
            channelMessageCounter,
            ...fresh.map((m) => Number(m.messageId.replace("msg-", "")) || 0),
          );
        }
      }
      if (loaded > 0) {
        logVerbose(`[Channel] Restored ${loaded} undelivered message(s) from disk`);
      }
    } catch {
      // corrupt persist file — start fresh
    }
  }

  const deliverChannelMessages = (terminalId: string): number => {
    const queue = channelQueues.get(terminalId);
    if (!queue || queue.length === 0) {
      return 0;
    }

    const session = sessions.get(terminalId);
    if (!session) {
      return 0;
    }

    const undelivered = queue.filter((m) => !m.delivered);
    if (undelivered.length === 0) {
      return 0;
    }

    const lines = undelivered.map(
      (m) => `[Channel message from ${m.fromTerminalId}]: ${m.content}`,
    );
    const prompt = `${lines.join("\n")}\r`;

    logVerbose(`[Channel] Delivering ${undelivered.length} message(s) to ${terminalId}`);

    for (const m of undelivered) {
      m.delivered = true;
    }

    writeInput(terminalId, prompt);
    saveQueues();
    return undelivered.length;
  };

  return {
    sendChannelMessage(
      toTerminalId: string,
      fromTerminalId: string,
      content: string,
    ): ChannelMessage | null {
      if (!terminals.has(toTerminalId)) {
        return null;
      }

      channelMessageCounter += 1;
      const message: ChannelMessage = {
        messageId: `msg-${channelMessageCounter}`,
        fromTerminalId,
        toTerminalId,
        content,
        timestamp: new Date().toISOString(),
        delivered: false,
      };

      const queue = channelQueues.get(toTerminalId) ?? [];
      queue.push(message);
      channelQueues.set(toTerminalId, queue);

      logVerbose(
        `[Channel] Queued message ${message.messageId} from=${fromTerminalId} to=${toTerminalId}`,
      );

      saveQueues();

      const targetSession = sessions.get(toTerminalId);
      if (targetSession && targetSession.agentState === "idle") {
        deliverChannelMessages(toTerminalId);
      }

      return message;
    },

    listChannelMessages(terminalId: string): ChannelMessage[] {
      return channelQueues.get(terminalId) ?? [];
    },

    deliverChannelMessages,
  };
};
