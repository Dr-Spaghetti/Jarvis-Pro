import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import {
  isAllowedHostHeader,
  isAllowedOriginHeader,
  isAuthorizedRequest,
  readHeaderValue,
} from "./security";

type TerminalRuntime = ReturnType<typeof import("../terminalRuntime").createTerminalRuntime>;

type CreateUpgradeHandlerOptions = {
  runtime: TerminalRuntime;
  allowRemoteAccess: boolean;
  authToken: string | null;
};

export const createUpgradeHandler = ({
  runtime,
  allowRemoteAccess,
  authToken,
}: CreateUpgradeHandlerOptions) => {
  return (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const originHeader = readHeaderValue(request.headers.origin);
    const hostHeader = readHeaderValue(request.headers.host);
    if (!isAllowedHostHeader(hostHeader, allowRemoteAccess)) {
      socket.destroy();
      return;
    }

    if (!isAllowedOriginHeader(originHeader, allowRemoteAccess)) {
      socket.destroy();
      return;
    }

    // Browsers cannot set an Authorization header during a WebSocket
    // handshake; the token is passed as a Sec-WebSocket-Protocol value.
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!isAuthorizedRequest(authToken, request, requestUrl)) {
      socket.destroy();
      return;
    }

    try {
      if (!runtime.handleUpgrade(request, socket, head)) {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  };
};
