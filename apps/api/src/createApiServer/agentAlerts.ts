import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { TerminalSnapshot } from "@octogent/core";

// Server-evaluated agent alerts. Rules are user-configurable and persisted;
// alerts themselves are derived live from the current terminal snapshots, so
// there is no fabricated data and nothing to "clear" — an alert exists only
// while its condition holds.

export type AgentAlertConfig = {
  /** Fire a "stuck" alert when an agent is blocked longer than this. null = off. */
  agentStuckMinutes: number | null;
};

export type AgentAlert = {
  id: string;
  type: "agent-stuck";
  severity: "warning";
  terminalId: string;
  tentacleId: string;
  label: string;
  message: string;
  since: string;
};

export const DEFAULT_AGENT_ALERT_CONFIG: AgentAlertConfig = {
  agentStuckMinutes: null,
};

const configFilePath = (projectStateDir: string) => join(projectStateDir, "state", "alerts.json");

export const readAgentAlertConfig = (projectStateDir: string): AgentAlertConfig => {
  const filePath = configFilePath(projectStateDir);
  if (!existsSync(filePath)) {
    return { ...DEFAULT_AGENT_ALERT_CONFIG };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const raw = (parsed as { agentStuckMinutes?: unknown }).agentStuckMinutes;
      const minutes =
        typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
      return { agentStuckMinutes: minutes };
    }
  } catch {
    // Corrupt file — fall back to defaults rather than crash.
  }

  return { ...DEFAULT_AGENT_ALERT_CONFIG };
};

export const writeAgentAlertConfig = (
  projectStateDir: string,
  config: AgentAlertConfig,
): AgentAlertConfig => {
  const filePath = configFilePath(projectStateDir);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort persistence.
  }
  return config;
};

// Accepts an arbitrary patch payload and returns a validated config, or an
// error string. Only `agentStuckMinutes` (positive integer, or null to
// disable) is currently configurable.
export const parseAgentAlertConfigPatch = (
  current: AgentAlertConfig,
  payload: unknown,
): { config: AgentAlertConfig } | { error: string } => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Expected a JSON object." };
  }

  const next: AgentAlertConfig = { ...current };
  if ("agentStuckMinutes" in payload) {
    const value = (payload as { agentStuckMinutes: unknown }).agentStuckMinutes;
    if (value === null) {
      next.agentStuckMinutes = null;
    } else if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      next.agentStuckMinutes = Math.floor(value);
    } else {
      return { error: "agentStuckMinutes must be a positive number or null." };
    }
  }

  return { config: next };
};

const STUCK_STATES = new Set(["blocked"]);

/**
 * Derive the active alerts from current terminal snapshots. Pure: same inputs
 * → same outputs. A blocked agent fires once it has been blocked longer than
 * the configured threshold.
 */
export const evaluateAgentAlerts = (
  snapshots: TerminalSnapshot[],
  config: AgentAlertConfig,
  now: number,
): AgentAlert[] => {
  const alerts: AgentAlert[] = [];

  if (config.agentStuckMinutes !== null) {
    const thresholdMs = config.agentStuckMinutes * 60_000;
    for (const snapshot of snapshots) {
      const runtimeState = snapshot.agentRuntimeState;
      if (!runtimeState || !STUCK_STATES.has(runtimeState)) {
        continue;
      }

      const since = snapshot.agentStateChangedAt;
      if (!since) {
        continue;
      }

      const sinceMs = Date.parse(since);
      if (Number.isNaN(sinceMs) || now - sinceMs < thresholdMs) {
        continue;
      }

      const label = snapshot.tentacleName ?? snapshot.label ?? snapshot.terminalId;
      const stuckMinutes = Math.floor((now - sinceMs) / 60_000);
      alerts.push({
        id: `agent-stuck:${snapshot.terminalId}`,
        type: "agent-stuck",
        severity: "warning",
        terminalId: snapshot.terminalId,
        tentacleId: snapshot.tentacleId,
        label,
        message: `${label} has been waiting for input for ${stuckMinutes} min.`,
        since,
      });
    }
  }

  return alerts;
};
