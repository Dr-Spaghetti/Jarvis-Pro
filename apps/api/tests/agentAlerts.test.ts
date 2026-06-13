import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalSnapshot } from "@octogent/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_ALERT_CONFIG,
  evaluateAgentAlerts,
  parseAgentAlertConfigPatch,
  readAgentAlertConfig,
  writeAgentAlertConfig,
} from "../src/createApiServer/agentAlerts";
import { buildAlertExportMarkdown } from "../src/createApiServer/alertRoutes";

const tempDirs: string[] = [];
const makeStateDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-alerts-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const snapshot = (overrides: Partial<TerminalSnapshot> = {}): TerminalSnapshot => ({
  terminalId: "terminal-1",
  label: "terminal-1",
  state: "blocked",
  tentacleId: "alpha",
  createdAt: "2026-06-12T10:00:00.000Z",
  agentRuntimeState: "blocked",
  agentStateChangedAt: "2026-06-12T10:00:00.000Z",
  ...overrides,
});

const NOW = Date.parse("2026-06-12T10:10:00.000Z"); // 10 min after 10:00

describe("evaluateAgentAlerts", () => {
  it("returns nothing when the stuck rule is disabled", () => {
    expect(evaluateAgentAlerts([snapshot()], { agentStuckMinutes: null }, NOW)).toEqual([]);
  });

  it("fires a stuck alert when a blocked agent exceeds the threshold", () => {
    const alerts = evaluateAgentAlerts(
      [snapshot({ tentacleName: "Alpha" })],
      {
        agentStuckMinutes: 5,
      },
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: "agent-stuck:terminal-1",
      type: "agent-stuck",
      terminalId: "terminal-1",
      tentacleId: "alpha",
      label: "Alpha",
    });
    expect(alerts[0]?.message).toContain("10 min");
  });

  it("does not fire before the threshold is reached", () => {
    expect(evaluateAgentAlerts([snapshot()], { agentStuckMinutes: 15 }, NOW)).toEqual([]);
  });

  it("ignores agents that are not blocked", () => {
    expect(
      evaluateAgentAlerts(
        [snapshot({ agentRuntimeState: "live" }), snapshot({ agentRuntimeState: "idle" })],
        { agentStuckMinutes: 5 },
        NOW,
      ),
    ).toEqual([]);
  });

  it("ignores blocked agents with no state-change timestamp", () => {
    expect(
      evaluateAgentAlerts(
        [snapshot({ agentStateChangedAt: undefined })],
        { agentStuckMinutes: 5 },
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("parseAgentAlertConfigPatch", () => {
  it("accepts a positive integer and floors it", () => {
    const result = parseAgentAlertConfigPatch(DEFAULT_AGENT_ALERT_CONFIG, {
      agentStuckMinutes: 7.9,
    });
    expect(result).toEqual({ config: { agentStuckMinutes: 7 } });
  });

  it("accepts null to disable", () => {
    const result = parseAgentAlertConfigPatch(
      { agentStuckMinutes: 5 },
      { agentStuckMinutes: null },
    );
    expect(result).toEqual({ config: { agentStuckMinutes: null } });
  });

  it("rejects non-positive or non-numeric values", () => {
    expect(
      parseAgentAlertConfigPatch(DEFAULT_AGENT_ALERT_CONFIG, { agentStuckMinutes: 0 }),
    ).toHaveProperty("error");
    expect(
      parseAgentAlertConfigPatch(DEFAULT_AGENT_ALERT_CONFIG, { agentStuckMinutes: "ten" }),
    ).toHaveProperty("error");
    expect(parseAgentAlertConfigPatch(DEFAULT_AGENT_ALERT_CONFIG, null)).toHaveProperty("error");
  });
});

describe("buildAlertExportMarkdown", () => {
  it("reports the disabled rule and no alerts", () => {
    const md = buildAlertExportMarkdown(
      { agentStuckMinutes: null },
      [],
      "2026-06-12T10:00:00.000Z",
    );
    expect(md).toContain("Stuck-agent alerts: **off**");
    expect(md).toContain("_No active alerts at export time._");
  });

  it("lists active alerts and the configured threshold", () => {
    const md = buildAlertExportMarkdown(
      { agentStuckMinutes: 10 },
      [
        {
          id: "agent-stuck:terminal-1",
          type: "agent-stuck",
          severity: "warning",
          terminalId: "terminal-1",
          tentacleId: "alpha",
          label: "Alpha",
          message: "Alpha has been waiting for input for 12 min.",
          since: "2026-06-12T09:48:00.000Z",
        },
      ],
      "2026-06-12T10:00:00.000Z",
    );
    expect(md).toContain("fire after **10 min**");
    expect(md).toContain("Active alerts (1)");
    expect(md).toContain("**Alpha**");
  });
});

describe("readAgentAlertConfig / writeAgentAlertConfig", () => {
  it("defaults to disabled before anything is written", () => {
    expect(readAgentAlertConfig(makeStateDir())).toEqual({ agentStuckMinutes: null });
  });

  it("round-trips a written config", () => {
    const dir = makeStateDir();
    writeAgentAlertConfig(dir, { agentStuckMinutes: 10 });
    expect(readAgentAlertConfig(dir)).toEqual({ agentStuckMinutes: 10 });
  });
});
