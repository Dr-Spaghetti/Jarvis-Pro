import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Per-session token telemetry. The only source is the real `usage` field that
// Claude Code writes onto assistant messages in the transcript JSONL — never
// synthesized. Sessions with no usage data (e.g. predating this feature, or
// non-Claude agents) simply never get an entry.

export type SessionTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Assistant messages that carried a usage block. */
  messageCount: number;
};

export type SessionTokenTelemetry = SessionTokenTotals & {
  sessionId: string;
  terminalId: string;
  tentacleId: string;
  firstRecordedAt: string;
  lastRecordedAt: string;
};

export type TokenTelemetryDocument = {
  version: 1;
  sessions: Record<string, SessionTokenTelemetry>;
};

const TELEMETRY_VERSION = 1 as const;

const telemetryFilePath = (projectStateDir: string) =>
  join(projectStateDir, "state", "telemetry.json");

const emptyDocument = (): TokenTelemetryDocument => ({
  version: TELEMETRY_VERSION,
  sessions: {},
});

const toNonNegativeInt = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

type TranscriptUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
};

type TranscriptLine = {
  type?: string;
  message?: { usage?: TranscriptUsage };
  usage?: TranscriptUsage;
};

/**
 * Sum the real token usage across all assistant messages in a transcript.
 * Returns null when the file is missing/unreadable or carries no usage at all,
 * so callers can record-nothing rather than write zeros.
 */
export const scanTranscriptTokenUsage = (transcriptPath: string): SessionTokenTotals | null => {
  if (!existsSync(transcriptPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }

  const totals: SessionTokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    messageCount: 0,
  };
  let sawUsage = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(trimmed) as TranscriptLine;
    } catch {
      continue;
    }

    if (parsed.type !== "assistant") {
      continue;
    }

    const usage = parsed.message?.usage ?? parsed.usage;
    if (!usage || typeof usage !== "object") {
      continue;
    }

    const input = toNonNegativeInt(usage.input_tokens);
    const output = toNonNegativeInt(usage.output_tokens);
    const cacheCreation = toNonNegativeInt(usage.cache_creation_input_tokens);
    const cacheRead = toNonNegativeInt(usage.cache_read_input_tokens);

    if (input + output + cacheCreation + cacheRead === 0) {
      continue;
    }

    sawUsage = true;
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheCreationTokens += cacheCreation;
    totals.cacheReadTokens += cacheRead;
    totals.messageCount += 1;
  }

  return sawUsage ? totals : null;
};

export const readTokenTelemetry = (projectStateDir: string): TokenTelemetryDocument => {
  const filePath = telemetryFilePath(projectStateDir);
  if (!existsSync(filePath)) {
    return emptyDocument();
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as TokenTelemetryDocument).sessions === "object" &&
      (parsed as TokenTelemetryDocument).sessions !== null
    ) {
      return { version: TELEMETRY_VERSION, sessions: (parsed as TokenTelemetryDocument).sessions };
    }
  } catch {
    // Corrupt file — fall through to an empty document rather than crash.
  }

  return emptyDocument();
};

export type RecordSessionTokenUsageInput = {
  projectStateDir: string;
  sessionId: string;
  terminalId: string;
  tentacleId: string;
  totals: SessionTokenTotals;
  now?: string;
};

/**
 * Persist the authoritative cumulative totals for a session. Because the totals
 * come from a full re-scan of the transcript, this SETS (not increments) the
 * entry — so re-firing on the same session is idempotent.
 */
export const recordSessionTokenUsage = ({
  projectStateDir,
  sessionId,
  terminalId,
  tentacleId,
  totals,
  now = new Date().toISOString(),
}: RecordSessionTokenUsageInput): void => {
  const filePath = telemetryFilePath(projectStateDir);
  const document = readTokenTelemetry(projectStateDir);
  const existing = document.sessions[sessionId];

  document.sessions[sessionId] = {
    sessionId,
    terminalId,
    tentacleId,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
    messageCount: totals.messageCount,
    firstRecordedAt: existing?.firstRecordedAt ?? now,
    lastRecordedAt: now,
  };

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  } catch {
    // Telemetry is best-effort; never break the agent lifecycle over it.
  }
};
