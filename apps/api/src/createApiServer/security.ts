import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const withCors = (headers: Record<string, string>, corsOrigin: string | null) => {
  const nextHeaders: Record<string, string> = {
    ...headers,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (corsOrigin) {
    nextHeaders["Access-Control-Allow-Origin"] = corsOrigin;
    nextHeaders.Vary = "Origin";
  }

  return nextHeaders;
};

const isLoopbackHostname = (hostname: string) => LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());

const parseHostname = (value: string, withScheme: boolean): string | null => {
  try {
    const url = new URL(withScheme ? value : `http://${value}`);
    return url.hostname;
  } catch {
    return null;
  }
};

const isExtensionOrigin = (origin: string) =>
  origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");

const parseExtensionOriginAllowlist = (): Set<string> | null => {
  const raw = process.env.OCTOGENT_EXTENSION_ORIGINS;
  if (raw === undefined) {
    return null;
  }

  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (origins.length === 0) {
    return null;
  }

  return new Set(origins);
};

export const isAllowedOriginHeader = (origin: string | undefined, allowRemoteAccess: boolean) => {
  if (allowRemoteAccess || origin === undefined) {
    return true;
  }

  if (isExtensionOrigin(origin)) {
    const allowlist = parseExtensionOriginAllowlist();
    return allowlist === null || allowlist.has(origin);
  }

  const hostname = parseHostname(origin, true);
  return hostname !== null && isLoopbackHostname(hostname);
};

export const isAllowedHostHeader = (host: string | undefined, allowRemoteAccess: boolean) => {
  if (allowRemoteAccess) {
    return true;
  }

  if (!host) {
    return false;
  }

  const hostname = parseHostname(host, false);
  return hostname !== null && isLoopbackHostname(hostname);
};

export const readHeaderValue = (header: string | string[] | undefined): string | undefined => {
  if (typeof header !== "string") {
    return undefined;
  }

  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRequestCorsOrigin = (origin: string | undefined, allowRemoteAccess: boolean) => {
  if (!origin) {
    return null;
  }

  if (!allowRemoteAccess && !isAllowedOriginHeader(origin, allowRemoteAccess)) {
    return null;
  }

  return origin;
};

export const resolveAuthTokenFromEnv = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const token = env.OCTOGENT_AUTH_TOKEN?.trim();
  return token ? token : null;
};

export const isAuthTokenMatch = (candidate: string, expected: string): boolean => {
  const candidateBuffer = Buffer.from(candidate, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer);
};

export const allowsQueryAuthToken = (pathname: string): boolean => {
  if (pathname.includes("/ws")) return true;
  if (pathname.includes("/export")) return true;
  if (pathname.includes("/asset")) return true;
  return false;
};

export const extractRequestAuthToken = (
  request: IncomingMessage,
  requestUrl: URL,
): string | null => {
  const authorization = readHeaderValue(request.headers.authorization);
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match?.[1]) return match[1].trim() || null;
  }

  // WebSocket handshakes cannot carry Authorization headers; the token is
  // passed as a Sec-WebSocket-Protocol value with prefix "token.".
  const wsProtocol = readHeaderValue(request.headers["sec-websocket-protocol"]);
  if (wsProtocol) {
    for (const proto of wsProtocol.split(",")) {
      const match = /^token\.(.+)$/.exec(proto.trim());
      if (match?.[1]) return decodeURIComponent(match[1]);
    }
  }

  // <a href> downloads and WS fallbacks cannot use headers. Ordinary API
  // routes must use Authorization so the token does not land in logs/history.
  if (allowsQueryAuthToken(requestUrl.pathname)) {
    const queryToken = requestUrl.searchParams.get("token");
    if (queryToken && queryToken.trim().length > 0) return queryToken.trim();
  }

  return null;
};

export const isAuthorizedRequest = (
  authToken: string | null,
  request: IncomingMessage,
  requestUrl: URL,
): boolean => {
  if (authToken === null) {
    return true;
  }

  const candidate = extractRequestAuthToken(request, requestUrl);
  return candidate !== null && isAuthTokenMatch(candidate, authToken);
};
