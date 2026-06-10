import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createUpgradeHandler } from "../src/createApiServer/upgradeHandler";

type RuntimeLike = {
  handleUpgrade: (request: IncomingMessage, socket: Socket, head: Buffer) => boolean;
};

const buildRequest = (url?: string): IncomingMessage =>
  ({
    url: url ?? "/api/terminal-events/ws",
    headers: {
      host: "127.0.0.1:8787",
      origin: "http://127.0.0.1:5173",
    },
  }) as IncomingMessage;

const buildSocket = () =>
  ({
    destroy: vi.fn(),
  }) as unknown as Socket;

describe("createUpgradeHandler", () => {
  it("destroys socket when runtime upgrade handling throws", () => {
    const runtime: RuntimeLike = {
      handleUpgrade: () => {
        throw new Error("boom");
      },
    };
    const handler = createUpgradeHandler({
      runtime: runtime as never,
      allowRemoteAccess: true,
      authToken: null,
    });
    const socket = buildSocket();

    expect(() => handler(buildRequest(), socket, Buffer.alloc(0))).not.toThrow();
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys socket without reaching the runtime when auth token is missing", () => {
    const handleUpgrade = vi.fn().mockReturnValue(true);
    const handler = createUpgradeHandler({
      runtime: { handleUpgrade } as never,
      allowRemoteAccess: true,
      authToken: "secret-token",
    });
    const socket = buildSocket();

    handler(buildRequest("/api/terminal-events/ws"), socket, Buffer.alloc(0));

    expect(handleUpgrade).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys socket when the query token is wrong", () => {
    const handleUpgrade = vi.fn().mockReturnValue(true);
    const handler = createUpgradeHandler({
      runtime: { handleUpgrade } as never,
      allowRemoteAccess: true,
      authToken: "secret-token",
    });
    const socket = buildSocket();

    handler(buildRequest("/api/terminal-events/ws?token=wrong"), socket, Buffer.alloc(0));

    expect(handleUpgrade).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("forwards the upgrade when the query token matches", () => {
    const handleUpgrade = vi.fn().mockReturnValue(true);
    const handler = createUpgradeHandler({
      runtime: { handleUpgrade } as never,
      allowRemoteAccess: true,
      authToken: "secret-token",
    });
    const socket = buildSocket();

    handler(buildRequest("/api/terminal-events/ws?token=secret-token"), socket, Buffer.alloc(0));

    expect(handleUpgrade).toHaveBeenCalledTimes(1);
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it("forwards the upgrade without a token when auth is disabled", () => {
    const handleUpgrade = vi.fn().mockReturnValue(true);
    const handler = createUpgradeHandler({
      runtime: { handleUpgrade } as never,
      allowRemoteAccess: true,
      authToken: null,
    });
    const socket = buildSocket();

    handler(buildRequest("/api/terminal-events/ws"), socket, Buffer.alloc(0));

    expect(handleUpgrade).toHaveBeenCalledTimes(1);
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});
