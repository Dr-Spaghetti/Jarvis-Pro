import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// WebSocket.OPEN = 1
const WS_OPEN = 1;
import { type WebSocket, WebSocketServer } from "ws";

import { type AgentEvent, agentEventBus } from "./agentEventBus";
import { agentRegistry } from "./agentRegistry";

type ClientMessage = { type: "cancel"; agentId: string };

const isClientMessage = (v: unknown): v is ClientMessage =>
  typeof v === "object" &&
  v !== null &&
  (v as ClientMessage).type === "cancel" &&
  typeof (v as ClientMessage).agentId === "string";

export const createAgentWebSocketServer = () => {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  const broadcast = (event: AgentEvent) => {
    const payload = JSON.stringify({ type: "event", event });
    for (const client of clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
  };

  agentEventBus.on(broadcast);

  wss.on("connection", (ws) => {
    clients.add(ws);

    // Send current state snapshot to the new client
    ws.send(JSON.stringify({ type: "snapshot", agents: agentRegistry.getAll() }));

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg: unknown = JSON.parse(data.toString());
        if (isClientMessage(msg) && msg.type === "cancel") {
          agentRegistry.cancel(msg.agentId);
        }
      } catch {
        // ignore malformed frames
      }
    });

    const cleanup = () => {
      clients.delete(ws);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  return {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    },
    close(): void {
      agentEventBus.off(broadcast);
      wss.close();
    },
  };
};

export type AgentWebSocketServer = ReturnType<typeof createAgentWebSocketServer>;
