import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentAnalyticsPanel,
  deriveAgentAnalytics,
} from "../src/components/activity/AgentAnalyticsPanel";
import { clearStoredAuthToken } from "../src/runtime/apiClient";

const session = (overrides: Record<string, unknown> = {}) => ({
  sessionId: "s1",
  terminalId: "terminal-1",
  tentacleId: "alpha",
  inputTokens: 100,
  outputTokens: 20,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  messageCount: 1,
  firstRecordedAt: "2026-06-12T10:00:00.000Z",
  lastRecordedAt: "2026-06-12T10:00:00.000Z",
  ...overrides,
});

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("deriveAgentAnalytics", () => {
  it("groups sessions per tentacle, sums tokens, and joins display names", () => {
    const rows = deriveAgentAnalytics(
      [
        session({ sessionId: "s1", tentacleId: "alpha", inputTokens: 100, outputTokens: 20 }),
        session({
          sessionId: "s2",
          tentacleId: "alpha",
          inputTokens: 50,
          outputTokens: 10,
          cacheReadTokens: 5,
          lastRecordedAt: "2026-06-12T12:00:00.000Z",
        }),
        session({
          sessionId: "s3",
          tentacleId: "beta",
          inputTokens: 7,
          outputTokens: 3,
          lastRecordedAt: "2026-06-12T09:00:00.000Z",
        }),
      ],
      [
        { tentacleId: "alpha", displayName: "Alpha Agent", status: "active" },
        { tentacleId: "beta", displayName: "Beta Agent", status: "idle" },
      ],
    );

    expect(rows).toHaveLength(2);
    // alpha is newest (12:00) → sorted first
    const alpha = rows[0];
    expect(alpha?.displayName).toBe("Alpha Agent");
    expect(alpha?.sessionCount).toBe(2);
    expect(alpha?.inputTokens).toBe(150);
    expect(alpha?.outputTokens).toBe(30);
    expect(alpha?.cacheTokens).toBe(5);
    expect(alpha?.totalTokens).toBe(185);
    expect(alpha?.lastRecordedAt).toBe("2026-06-12T12:00:00.000Z");
  });

  it("falls back to the tentacle id when no matching deck name exists", () => {
    const rows = deriveAgentAnalytics([session({ tentacleId: "ghost" })], []);
    expect(rows[0]?.displayName).toBe("ghost");
    expect(rows[0]?.status).toBeNull();
  });
});

describe("AgentAnalyticsPanel", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.restoreAllMocks();
  });

  it("shows the honest empty state when no telemetry has been collected", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/telemetry/tokens")) {
        return jsonResponse({ sessions: [] });
      }
      if (url.endsWith("/api/deck/tentacles")) {
        return jsonResponse([]);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(<AgentAnalyticsPanel />);

    expect(await screen.findByText(/Telemetry starts collecting from now/)).toBeInTheDocument();
  });

  it("renders per-agent rows from real telemetry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/telemetry/tokens")) {
        return jsonResponse({
          sessions: [session({ inputTokens: 1500, outputTokens: 300 })],
        });
      }
      if (url.endsWith("/api/deck/tentacles")) {
        return jsonResponse([{ tentacleId: "alpha", displayName: "Alpha Agent", status: "idle" }]);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(<AgentAnalyticsPanel />);

    expect(await screen.findByText("Alpha Agent")).toBeInTheDocument();
    // 1500 input → "1.5k"
    expect(screen.getByText("1.5k")).toBeInTheDocument();
  });

  it("still renders telemetry when the deck name fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/telemetry/tokens")) {
        return jsonResponse({ sessions: [session({ tentacleId: "alpha" })] });
      }
      if (url.endsWith("/api/deck/tentacles")) {
        return jsonResponse({ error: "boom" }, 500);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(<AgentAnalyticsPanel />);

    expect(await screen.findByText("alpha")).toBeInTheDocument();
  });

  it("shows an error state with retry when telemetry fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    render(<AgentAnalyticsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load agent analytics.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
