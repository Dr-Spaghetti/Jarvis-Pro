import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./createApiServer";

// Load .env into process.env (shell exports take priority).
// Walks up from this file's directory so the same path works in both
// dev (apps/api/src/) and production (dist/api/).
{
  let envPath: string | null = null;
  for (let d = dirname(fileURLToPath(import.meta.url)); d !== dirname(d); d = dirname(d)) {
    const candidate = join(d, ".env");
    if (existsSync(candidate)) { envPath = candidate; break; }
  }
  if (envPath) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      if (!key || key.startsWith("OCTOGENT_") || process.env[key] !== undefined) continue;
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
};

const host = process.env.HOST ?? "127.0.0.1";
const port = parsePort(process.env.OCTOGENT_API_PORT ?? process.env.PORT, 8787);
const allowRemoteAccess = process.env.OCTOGENT_ALLOW_REMOTE_ACCESS === "1";
const workspaceCwd = process.env.OCTOGENT_WORKSPACE_CWD ?? process.cwd();
const projectStateDir = process.env.OCTOGENT_PROJECT_STATE_DIR;
const promptsDir = process.env.OCTOGENT_PROMPTS_DIR;
const webDistDir = process.env.OCTOGENT_WEB_DIST_DIR;

// Validate startup environment
const validateStartupEnv = () => {
  const rawPort = process.env.OCTOGENT_API_PORT ?? process.env.PORT;
  if (rawPort !== undefined) {
    const parsed = Number.parseInt(rawPort, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port "${rawPort}": must be an integer between 1 and 65535.`);
      process.exit(1);
    }
  }

  if (process.env.OCTOGENT_WORKSPACE_CWD && !existsSync(process.env.OCTOGENT_WORKSPACE_CWD)) {
    console.error(
      `OCTOGENT_WORKSPACE_CWD directory does not exist: ${process.env.OCTOGENT_WORKSPACE_CWD}`,
    );
    process.exit(1);
  }

  if (process.env.OCTOGENT_WEB_DIST_DIR && !existsSync(process.env.OCTOGENT_WEB_DIST_DIR)) {
    console.warn(
      `OCTOGENT_WEB_DIST_DIR directory does not exist: ${process.env.OCTOGENT_WEB_DIST_DIR} — web UI will be unavailable.`,
    );
  }

  if (allowRemoteAccess && !process.env.OCTOGENT_AUTH_TOKEN?.trim()) {
    console.error(
      "OCTOGENT_ALLOW_REMOTE_ACCESS=1 requires OCTOGENT_AUTH_TOKEN to be set in .env — refusing to expose the API without authentication.",
    );
    process.exit(1);
  }
};

validateStartupEnv();

const apiServer = createApiServer({
  workspaceCwd,
  projectStateDir,
  promptsDir,
  webDistDir,
  allowRemoteAccess,
});

const shutdown = async () => {
  await apiServer.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

apiServer
  .start(port, host)
  .then(({ port: activePort }) => {
    console.log(`Octogent API listening on http://${host}:${activePort}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
