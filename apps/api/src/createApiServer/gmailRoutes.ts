import {
  buildGmailAuthUrl,
  buildGmailRedirectUri,
  exchangeCodeForTokens,
  generateOAuthState,
  readGmailConnectionStatus,
  removeEnvKeys,
  writeEnvKey,
} from "../gmail/gmailAuth";
import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed } from "./routeHelpers";

const CSRF_STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Set<string>();

export const handleGmailStatusRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/gmail/status") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  writeJson(response, 200, readGmailConnectionStatus(), corsOrigin);
  return true;
};

export const handleGmailAuthRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd, getApiBaseUrl },
) => {
  if (requestUrl.pathname !== "/api/gmail/auth") return false;

  if (request.method === "GET") {
    const clientId = process.env.GMAIL_CLIENT_ID;
    if (!clientId) {
      writeJson(
        response,
        400,
        { error: "GMAIL_CLIENT_ID not set in .env — see .env.example for setup." },
        corsOrigin,
      );
      return true;
    }

    const state = generateOAuthState();
    pendingStates.add(state);
    setTimeout(() => pendingStates.delete(state), CSRF_STATE_TTL_MS);

    const redirectUri = buildGmailRedirectUri(getApiBaseUrl());
    const url = buildGmailAuthUrl(clientId, redirectUri, state);
    writeJson(response, 200, { url }, corsOrigin);
    return true;
  }

  if (request.method === "DELETE") {
    removeEnvKeys(workspaceCwd, ["GMAIL_REFRESH_TOKEN", "GMAIL_ACCESS_TOKEN", "GMAIL_USER_EMAIL"]);
    writeJson(response, 200, { connected: false }, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

export const handleGmailCallbackRoute: ApiRouteHandler = async (
  { request, response, requestUrl },
  { workspaceCwd, getApiBaseUrl },
) => {
  if (requestUrl.pathname !== "/api/gmail/callback") return false;
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end("Method not allowed");
    return true;
  }

  const error = requestUrl.searchParams.get("error");
  if (error) {
    response.writeHead(302, { Location: "/?gmail_error=access_denied" });
    response.end();
    return true;
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (!code || !state || !pendingStates.has(state)) {
    response.writeHead(302, { Location: "/?gmail_error=invalid_state" });
    response.end();
    return true;
  }
  pendingStates.delete(state);

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    response.writeHead(302, { Location: "/?gmail_error=missing_credentials" });
    response.end();
    return true;
  }

  try {
    const redirectUri = buildGmailRedirectUri(getApiBaseUrl());
    const tokens = await exchangeCodeForTokens(clientId, clientSecret, redirectUri, code);
    writeEnvKey(workspaceCwd, "GMAIL_REFRESH_TOKEN", tokens.refreshToken);
    writeEnvKey(workspaceCwd, "GMAIL_ACCESS_TOKEN", tokens.accessToken);
    writeEnvKey(workspaceCwd, "GMAIL_USER_EMAIL", tokens.email);
    response.writeHead(302, { Location: "/?gmail_connected=true" });
    response.end();
  } catch (err) {
    console.error("[Gmail] Token exchange error:", err instanceof Error ? err.message : err);
    response.writeHead(302, { Location: "/?gmail_error=token_exchange_failed" });
    response.end();
  }

  return true;
};
