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

// Strip CLAUDECODE and ANTHROPIC_* vars to avoid confusing the child claude process.
const buildChildEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDECODE") continue;
    if (k.startsWith("ANTHROPIC_")) continue;
    env[k] = v;
  }
  return env;
};

const resolveClaudeBinary = (): string | null => {
  const lookupCmd = process.platform === "win32" ? "where.exe" : "which";
  try {
    const raw = execFileSync(lookupCmd, ["claude"], { timeout: 3_000, encoding: "utf8" }).trim();
    // where.exe may return multiple matches; take the first line.
    return raw.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
};

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

    // Prompt is written to stdin to avoid Windows command-line length limits
    // and shell quoting issues with user-supplied text.
    const fullPrompt = `${AGENTIC_SYSTEM}\n\nContext:\n${context}\n\nQuestion: ${question}`;

    // On Windows, .cmd files require shell:true. On Unix, call the resolved binary directly.
    const isWin = process.platform === "win32";
    const proc = spawn(isWin ? "claude" : binary, ["-p", "--allowedTools", toolPatterns], {
      shell: isWin,
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
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    // Write the prompt to stdin then close so claude knows input is done.
    try {
      proc.stdin.write(fullPrompt, "utf8");
      proc.stdin.end();
    } catch {
      // stdin may already be closed if the process errored at startup
    }

    // Hard timeout — 60 s is generous for a single MCP call.
    const deadline = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        reason: "timeout",
        hint: "The agentic lookup timed out after 60 s. Try again.",
      });
    }, 60_000);

    proc.on("close", (code) => {
      clearTimeout(deadline);
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
        hint: `Agentic lookup returned no answer (exit ${String(code)}).${reAuthSuffix}`,
      });
    });
  });
