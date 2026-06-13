import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type BrainDigest, computeBrainDigest, resolveVaultDir } from "./brainRoutes";

// Deterministic morning-brief scheduler. At a user-configured local time it
// writes a "Daily Brief — YYYY-MM-DD" note into the vault from the existing
// digest computation. NO Claude agent is ever spawned (cost) — this is a pure
// filesystem digest.

export type BriefSchedulerConfig = {
  enabled: boolean;
  /** Local time of day in "HH:MM" 24h format. */
  time: string;
  /** Date stamp (YYYY-MM-DD) of the last brief written, or null. */
  lastBriefDate: string | null;
  /** ISO timestamp of the last brief written, or null. */
  lastBriefAt: string | null;
};

export const DEFAULT_BRIEF_CONFIG: BriefSchedulerConfig = {
  enabled: false,
  time: "08:00",
  lastBriefDate: null,
  lastBriefAt: null,
};

const configFilePath = (projectStateDir: string) =>
  join(projectStateDir, "state", "briefScheduler.json");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidBriefTime = (value: unknown): value is string =>
  typeof value === "string" && TIME_RE.test(value);

export const readBriefConfig = (projectStateDir: string): BriefSchedulerConfig => {
  const filePath = configFilePath(projectStateDir);
  if (!existsSync(filePath)) {
    return { ...DEFAULT_BRIEF_CONFIG };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<BriefSchedulerConfig>;
    return {
      enabled: parsed.enabled === true,
      time: isValidBriefTime(parsed.time) ? parsed.time : DEFAULT_BRIEF_CONFIG.time,
      lastBriefDate: typeof parsed.lastBriefDate === "string" ? parsed.lastBriefDate : null,
      lastBriefAt: typeof parsed.lastBriefAt === "string" ? parsed.lastBriefAt : null,
    };
  } catch {
    return { ...DEFAULT_BRIEF_CONFIG };
  }
};

export const writeBriefConfig = (
  projectStateDir: string,
  config: BriefSchedulerConfig,
): BriefSchedulerConfig => {
  const filePath = configFilePath(projectStateDir);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort persistence.
  }
  return config;
};

export const parseBriefConfigPatch = (
  current: BriefSchedulerConfig,
  payload: unknown,
): { config: BriefSchedulerConfig } | { error: string } => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Expected a JSON object." };
  }
  const next: BriefSchedulerConfig = { ...current };
  if ("enabled" in payload) {
    const value = (payload as { enabled: unknown }).enabled;
    if (typeof value !== "boolean") {
      return { error: "enabled must be a boolean." };
    }
    next.enabled = value;
  }
  if ("time" in payload) {
    const value = (payload as { time: unknown }).time;
    if (!isValidBriefTime(value)) {
      return { error: "time must be in HH:MM 24-hour format." };
    }
    next.time = value;
  }
  return { config: next };
};

const dateStamp = (now: Date): string => {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
};

/**
 * Pure decision: should a brief be written right now? True when enabled, the
 * local time has reached the configured time, and today's brief has not been
 * written yet. A whole missed day is never back-filled — only the current date.
 */
export const shouldWriteBrief = (config: BriefSchedulerConfig, now: Date): boolean => {
  if (!config.enabled || !isValidBriefTime(config.time)) {
    return false;
  }
  const today = dateStamp(now);
  if (config.lastBriefDate === today) {
    return false;
  }
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= timeToMinutes(config.time);
};

const formatList = (items: string[], emptyLabel: string): string =>
  items.length === 0 ? `_${emptyLabel}_` : items.map((item) => `- ${item}`).join("\n");

// Render the digest into the Markdown body of the daily brief note.
export const renderBriefMarkdown = (digest: BrainDigest, generatedAt: string): string => {
  const lines: string[] = [];
  lines.push(`# Daily Brief — ${digest.date}`);
  lines.push("");
  lines.push(`> Generated ${generatedAt} by Jarvis (deterministic digest — no agent run).`);
  lines.push("");

  lines.push(`## Open tasks (${digest.tasks.openCount})`);
  lines.push("");
  lines.push(formatList(digest.tasks.open, "No open tasks found."));
  lines.push("");

  lines.push("## Recent notes");
  lines.push("");
  lines.push(
    formatList(
      digest.recentNotes.map((note) => `[[${note.path}|${note.title}]]`),
      "No recent notes.",
    ),
  );
  lines.push("");

  lines.push("## Recent activity");
  lines.push("");
  lines.push(
    formatList(
      digest.journal.map((entry) => `${entry.action}${entry.detail ? ` — ${entry.detail}` : ""}`),
      "No recent activity logged.",
    ),
  );
  lines.push("");

  lines.push(`Memory facts on file: ${digest.memory.factCount}`);
  lines.push("");
  return lines.join("\n");
};

export type BriefRunResult =
  | { written: true; date: string; notePath: string }
  | { written: false; reason: "not-due" | "no-vault" | "already-exists" };

type RunBriefCheckOptions = {
  projectStateDir: string;
  now?: Date;
  computeDigest?: () => BrainDigest;
  getVaultDir?: () => string | null;
};

/**
 * Evaluate the schedule and, if due, write today's brief note. Idempotent: the
 * note filename is date-stamped and an existing file is never overwritten, and
 * the config's lastBriefDate guards against re-running within the same day.
 */
export const runBriefCheck = ({
  projectStateDir,
  now = new Date(),
  computeDigest = computeBrainDigest,
  getVaultDir = resolveVaultDir,
}: RunBriefCheckOptions): BriefRunResult => {
  const config = readBriefConfig(projectStateDir);
  if (!shouldWriteBrief(config, now)) {
    return { written: false, reason: "not-due" };
  }

  const vaultDir = getVaultDir();
  if (!vaultDir) {
    return { written: false, reason: "no-vault" };
  }

  const date = dateStamp(now);
  const noteRel = join("Journal", `Daily Brief - ${date}.md`);
  const notePath = join(vaultDir, noteRel);

  if (existsSync(notePath)) {
    // Note already on disk — record the date so we stop re-checking today.
    writeBriefConfig(projectStateDir, {
      ...config,
      lastBriefDate: date,
      lastBriefAt: now.toISOString(),
    });
    return { written: false, reason: "already-exists" };
  }

  const digest = computeDigest();
  const markdown = renderBriefMarkdown(digest, now.toISOString());
  try {
    mkdirSync(dirname(notePath), { recursive: true });
    writeFileSync(notePath, markdown, "utf8");
  } catch {
    return { written: false, reason: "no-vault" };
  }

  writeBriefConfig(projectStateDir, {
    ...config,
    lastBriefDate: date,
    lastBriefAt: now.toISOString(),
  });
  return { written: true, date, notePath: noteRel };
};

const CHECK_INTERVAL_MS = 60_000;

export const createBriefScheduler = (projectStateDir: string) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    try {
      runBriefCheck({ projectStateDir });
    } catch {
      // Never let a scheduler error crash the server.
    }
  };

  return {
    start() {
      if (timer) {
        return;
      }
      // Immediate catch-up check on startup (covers a missed run earlier today).
      tick();
      timer = setInterval(tick, CHECK_INTERVAL_MS);
      // Don't keep the event loop alive solely for the scheduler.
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
};
