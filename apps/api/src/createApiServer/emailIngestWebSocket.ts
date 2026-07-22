import WebSocket from "ws";
import { processEmailWebhook, readEmailIngestState } from "./emailIngestProcessor.js";

const WS_URL = "wss://ws.agentmail.to/v0";
const RECONNECT_DELAY_MS = 5_000;

export const createEmailIngestWebSocket = (projectStateDir: string) => {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const connect = () => {
    if (stopped) return;

    const apiKey = process.env["AGENTMAIL_API_KEY"];
    const inboxId = process.env["AGENTMAIL_INBOX"] ?? "niggims@agentmail.to";
    if (!apiKey) return;

    ws = new WebSocket(`${WS_URL}?api_key=${encodeURIComponent(apiKey)}`);

    ws.on("open", () => {
      ws?.send(
        JSON.stringify({
          type: "subscribe",
          inbox_ids: [inboxId],
          event_types: ["message.received"],
        }),
      );
    });

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data)) as {
          type?: string;
          event_type?: string;
          message?: {
            message_id?: string;
            from?: string;
            subject?: string;
            text?: string;
            html?: string;
          };
        };

        if (msg.type === "event" && msg.event_type === "message.received" && msg.message) {
          const state = readEmailIngestState(projectStateDir);
          if (!state.enabled) return;
          const m = msg.message;
          void processEmailWebhook(projectStateDir, {
            from: m.from ?? "",
            subject: m.subject ?? "",
            messageId: m.message_id ?? "",
            text: m.text ?? "",
            html: m.html ?? "",
          });
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      ws = null;
      if (!stopped) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        reconnectTimer.unref?.();
      }
    });

    ws.on("error", () => {
      ws?.terminate();
    });
  };

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
    },
  };
};
