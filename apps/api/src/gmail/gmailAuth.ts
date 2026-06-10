import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_PROFILE_ENDPOINT = "https://www.googleapis.com/gmail/v1/users/me/profile";

export type GmailConnectionStatus = { connected: true; email: string } | { connected: false };

export type GmailTokensResponse = {
  accessToken: string;
  refreshToken: string;
  email: string;
};

export const generateOAuthState = (): string => randomBytes(16).toString("hex");

export const buildGmailAuthUrl = (clientId: string, redirectUri: string, state: string): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
};

export const exchangeCodeForTokens = async (
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<GmailTokensResponse> => {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code,
  });

  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${text}`);
  }

  const data = (await tokenResponse.json()) as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token : null;
  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : null;

  if (!accessToken || !refreshToken) {
    throw new Error("Missing access_token or refresh_token in Google response");
  }

  const profileRes = await fetch(GMAIL_PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = profileRes.ok ? ((await profileRes.json()) as Record<string, unknown>) : {};
  const email = typeof profile.emailAddress === "string" ? profile.emailAddress : "";

  return { accessToken, refreshToken, email };
};

const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const writeEnvKey = (workspaceCwd: string, key: string, value: string): void => {
  if (!VALID_ENV_KEY.test(key)) return;

  const envPath = join(workspaceCwd, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));

  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    const lastContentIdx = lines.reduceRight(
      (found, l, i) => (found === -1 && l.trim().length > 0 ? i : found),
      -1,
    );
    lines.splice(lastContentIdx + 1, 0, `${key}=${value}`);
  }

  writeFileSync(envPath, lines.join("\n"), "utf8");
  process.env[key] = value;
};

export const removeEnvKeys = (workspaceCwd: string, keys: string[]): void => {
  const envPath = join(workspaceCwd, ".env");
  if (!existsSync(envPath)) return;

  const keySet = new Set(keys);
  const filtered = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => !keySet.has(line.split("=")[0]?.trim() ?? ""))
    .join("\n");

  writeFileSync(envPath, filtered, "utf8");
  for (const key of keys) {
    delete process.env[key];
  }
};

export const readGmailConnectionStatus = (): GmailConnectionStatus => {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const email = process.env.GMAIL_USER_EMAIL;
  if (refreshToken && email) return { connected: true, email };
  return { connected: false };
};

export const buildGmailRedirectUri = (apiBaseUrl: string): string =>
  `${apiBaseUrl}/api/gmail/callback`;
