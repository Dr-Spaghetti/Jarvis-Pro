// Agentic Ask — spawns `claude -p` with MCP connector tool permissions and
// pipes the result back as a plain text answer. Used by the brain /ask route
// for questions that need live data (Local Falcon, Apollo).
//
// Auth tokens live in the Claude user session on disk; headless invocations
// share the same session so connectors authenticated in the desktop app work
// here too. If a connector's OAuth token has expired, claude outputs an error
// message which we surface verbatim to the user.

import { execFileSync, spawn } from "node:child_process";

import type { BrainConnector } from "./classifyBrainQuestion";

// Tool glob patterns that grant access to each connector headlessly.
// These match the mcp__claude_ai_<Service>__* naming used by claude -p.
const CONNECTOR_CONFIG: Record<BrainConnector, { label: string; toolPattern: string }> = {
  localfalcon: {
    label: "Local Falcon",
    toolPattern: "mcp__claude_ai_Local_Falcon__*",
  },
  apollo: {
    label: "Apollo",
    toolPattern: "mcp__claude_ai_Apollo_io__*",
  },
};

const AGENTIC_SYSTEM =
  "You are Jarvis, Nick's personal AI assistant. Answer concisely using real data from " +
  "your MCP tools. Keep answers short and direct — one to three sentences for simple " +
  "lookups, a brief list only if the data naturally calls for it. Never fabricate data: " +
  "if a tool call fails or returns no data, say exactly what went wrong.";

// Pass only the OS vars the claude CLI needs — avoids leaking OPENAI_API_KEY,
// DEEPGRAM_API_KEY, and every other secret the parent API server holds.
const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SystemRoot",
  "COMSPEC",
  "PATHEXT",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
]);

const buildChildEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
};

// Cache the result so we only shell out once per server lifetime.
let cachedBinary: string | null | undefined;

const resolveClaudeBinary = (): string | null => {
  if (cachedBinary !== undefined) return cachedBinary;
  const lookupCmd = process.platform === "win32" ? "where.exe" : "which";
  try {
    const raw = execFileSync(lookupCmd, ["claude"], { timeout: 3_000, encoding: "utf8" }).trim();
    // where.exe may return multiple matches; take the first line.
    cachedBinary = raw.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    cachedBinary = null;
  }
  return cachedBinary;
};

/** Reset the cached binary path (used in tests). */
export const resetClaudeBinaryCache = (): void => {
  cachedBinary = undefined;
};

// Kill the child and resolve with a clear failure once either stream grows
// beyond this limit — prevents a runaway/giant model response from OOM-ing
// the server process.
const MAX_OUTPUT_BYTES = 1_000_000;

export type AgenticAskResult =
  | { ok: true; answer: string; via: string }
  | { ok: false; reason: string; hint: string };

export const agenticAsk = (
  question: string,
  context: string,
  connectors: BrainConnector[],
  signal?: AbortSignal,
): Promise<AgenticAskResult> =>
  new Promise((resolve) => {
    const binary = resolveClaudeBinary();
    if (!binary) {
      resolve({
        ok: false,
        reason: "claude-missing",
        hint: "The claude CLI was not found. Run `claude login` to set it up.",
      });
      return;
    }

    const valid = connectors.filter((c): c is BrainConnector => c in CONNECTOR_CONFIG);
    if (valid.length === 0) {
      resolve({ ok: false, reason: "no-connectors", hint: "No recognized connectors requested." });
      return;
    }

    const toolPatterns = valid.map((c) => CONNECTOR_CONFIG[c].toolPattern).join(",");
    const viaLabel = valid.map((c) => CONNECTOR_CONFIG[c].label).join(", ");

    // Prompt is written to stdin to avoid command-line length limits and shell
    // quoting issues with user-supplied text.
    const fullPrompt = `${AGENTIC_SYSTEM}\n\nContext:\n${context}\n\nQuestion: ${question}`;

    // On Windows, .cmd scripts can't be executed directly — use cmd.exe /c with
    // the resolved binary path so we avoid shell:true (which would discard the
    // resolved path and risk picking up a local claude.cmd/bat from cwd).
    const isWin = process.platform === "win32";
    const [spawnCmd, spawnArgs] = isWin
      ? (["cmd.exe", ["/c", binary, "-p", "--allowedTools", toolPatterns]] as const)
      : ([binary, ["-p", "--allowedTools", toolPatterns]] as const);

    const proc = spawn(spawnCmd, [...spawnArgs], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildChildEnv(),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: AgenticAskResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    if (signal) {
      signal.addEventListener("abort", () => {
        try {
          proc.kill();
        } catch {
          /* already dead */
        }
        finish({ ok: false, reason: "aborted", hint: "The request was cancelled." });
      });
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT_BYTES) {
        try {
          proc.kill();
        } catch {
          /* already dead */
        }
        finish({
          ok: false,
          reason: "output-overflow",
          hint: "The live-data response was too large to process. Try a more specific question.",
        });
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_OUTPUT_BYTES) {
        try {
          proc.kill();
        } catch {
          /* already dead */
        }
        finish({
          ok: false,
          reason: "output-overflow",
          hint: "The live-data response was too large to process. Try a more specific question.",
        });
      }
    });

    // Write the prompt to stdin then close so claude knows input is done.
    try {
      proc.stdin.write(fullPrompt, "utf8");
      proc.stdin.end();
    } catch {
      // stdin may already be closed if the process errored at startup
    }

    // Hard timeout — 30 s covers typical MCP round-trips with room to spare.
    const deadline = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        reason: "timeout",
        hint: "The live-data lookup timed out after 30 s. Try again.",
      });
    }, 30_000);

    proc.on("close", () => {
      clearTimeout(deadline);
      // Flush any buffered stdout that arrived before the close event.
      const answer = stdout.trim();
      if (answer) {
        finish({ ok: true, answer, via: viaLabel });
        return;
      }

      // Detect connector re-auth needed
      const combined = (stderr + stdout).toLowerCase();
      const needsReAuth =
        combined.includes("re-authoriz") ||
        combined.includes("oauth") ||
        combined.includes("expired") ||
        combined.includes("reconnect");

      const reAuthSuffix = needsReAuth
        ? " Go to claude.ai → Settings → Integrations and reconnect the service."
        : "";

      finish({
        ok: false,
        reason: "claude-error",
        hint: `Live-data lookup returned no answer.${reAuthSuffix}`,
      });
    });
  });
