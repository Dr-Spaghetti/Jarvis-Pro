import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import {
  MockWebSocket,
  jsonResponse,
  notFoundResponse,
  resetAppTestHarness,
} from "./test-utils/appTestHarness";

describe("App Monitor runtime", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders surveillance and alerts subtabs in monitor view", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
        return jsonResponse([
          {
            terminalId: "t-001",
            tentacleId: "tentacle-001",
            tentacleName: "Senior Developer",
            state: "live",
            lifecycleState: "running",
            workspaceMode: "shared",
            startedAt: new Date().toISOString(),
          },
        ]);
      }
      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }
      if (url.endsWith("/api/claude/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }
      if (url.endsWith("/api/github/summary") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
          commitsPerDay: [],
        });
      }
      if (url.includes("/api/analytics/usage-heatmap") && method === "GET") {
        return jsonResponse({ days: [], projects: [], models: [] });
      }
      if (url.endsWith("/api/ui-state") && method === "GET") {
        return jsonResponse({});
      }
      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        return jsonResponse({});
      }
      return notFoundResponse();
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "[5] Monitor",
      }),
    );

    const monitorView = await screen.findByLabelText("Monitor primary view");

    // Surveillance is the default active subtab
    expect(within(monitorView).getByRole("button", { name: "Surveillance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Alerts subtab is present
    expect(within(monitorView).getByRole("button", { name: "Alerts" })).toBeInTheDocument();

    // Agent card from terminal snapshot appears in the surveillance panel
    await waitFor(() => {
      expect(within(monitorView).getByText("Senior Developer")).toBeInTheDocument();
    });

    // Switching to Alerts tab works
    fireEvent.click(within(monitorView).getByRole("button", { name: "Alerts" }));
    expect(within(monitorView).getByRole("button", { name: "Alerts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("surveillance panel shows empty state when no agents are running", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }
      if (url.endsWith("/api/claude/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }
      if (url.endsWith("/api/github/summary") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
          commitsPerDay: [],
        });
      }
      if (url.includes("/api/analytics/usage-heatmap") && method === "GET") {
        return jsonResponse({ days: [], projects: [], models: [] });
      }
      if (url.endsWith("/api/ui-state") && method === "GET") {
        return jsonResponse({});
      }
      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        return jsonResponse({});
      }
      return notFoundResponse();
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "[5] Monitor",
      }),
    );

    const monitorView = await screen.findByLabelText("Monitor primary view");
    await waitFor(() => {
      expect(within(monitorView).getByText(/No agents running/i)).toBeInTheDocument();
    });
  });

  it("hydrates the bottom telemetry tape after reload without opening the monitor view", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
        return jsonResponse([]);
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }

      if (url.endsWith("/api/claude/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }

      if (url.endsWith("/api/github/summary") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
          commitsPerDay: [],
        });
      }

      if (url.includes("/api/analytics/usage-heatmap") && method === "GET") {
        return jsonResponse({
          days: [],
          projects: [],
          models: [],
        });
      }

      if (url.endsWith("/api/ui-state") && method === "GET") {
        return jsonResponse({
          isMonitorVisible: true,
          isBottomTelemetryVisible: true,
        });
      }

      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        return jsonResponse({});
      }

      if (url.endsWith("/api/monitor/config") && method === "GET") {
        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          providers: {
            x: {
              credentials: {
                isConfigured: true,
                bearerTokenHint: "****oken",
                apiKeyHint: null,
                hasApiSecret: false,
                hasAccessToken: false,
                hasAccessTokenSecret: false,
                updatedAt: "2026-02-28T12:00:00.000Z",
              },
            },
          },
        });
      }

      if (url.endsWith("/api/monitor/feed") && method === "GET") {
        return jsonResponse({
          providerId: "x",
          queryTerms: ["Codex"],
          refreshPolicy: {
            maxCacheAgeMs: 86400000,
            maxPosts: 30,
            searchWindowDays: 7,
          },
          lastFetchedAt: "2026-02-28T12:00:00.000Z",
          staleAfter: "2026-03-01T12:00:00.000Z",
          isStale: false,
          lastError: null,
          usage: null,
          posts: [
            {
              source: "x",
              id: "1",
              text: "Telemetry should hydrate without visiting monitor",
              author: "octogent",
              createdAt: "2026-02-28T10:00:00.000Z",
              likeCount: 123,
              permalink: "https://x.com/octogent/status/1",
              matchedQueryTerm: "Codex",
            },
          ],
        });
      }

      return notFoundResponse();
    });

    render(<App />);

    const telemetryTape = await screen.findByLabelText("Telemetry ticker tape");
    await waitFor(() => {
      expect(within(telemetryTape).getAllByText("@octogent")).toHaveLength(2);
      expect(
        within(telemetryTape).queryByText("Waiting for X resources..."),
      ).not.toBeInTheDocument();
    });
  });

  it("does not call monitor APIs when Monitor is disabled, even if bottom telemetry is enabled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let monitorConfigCalls = 0;
    let monitorFeedCalls = 0;
    let monitorRefreshCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
        return jsonResponse([]);
      }

      if (url.endsWith("/api/codex/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }

      if (url.endsWith("/api/claude/usage") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
        });
      }

      if (url.endsWith("/api/github/summary") && method === "GET") {
        return jsonResponse({
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-02-28T12:00:00.000Z",
          commitsPerDay: [],
        });
      }

      if (url.includes("/api/analytics/usage-heatmap") && method === "GET") {
        return jsonResponse({
          days: [],
          projects: [],
          models: [],
        });
      }

      if (url.endsWith("/api/ui-state") && method === "GET") {
        return jsonResponse({
          isMonitorVisible: false,
          isBottomTelemetryVisible: true,
        });
      }

      if (url.endsWith("/api/ui-state") && method === "PATCH") {
        return jsonResponse({});
      }

      if (url.endsWith("/api/monitor/config") && method === "GET") {
        monitorConfigCalls += 1;
        return jsonResponse({});
      }

      if (url.endsWith("/api/monitor/feed") && method === "GET") {
        monitorFeedCalls += 1;
        return jsonResponse({});
      }

      if (url.endsWith("/api/monitor/refresh") && method === "POST") {
        monitorRefreshCalls += 1;
        return jsonResponse({});
      }

      return notFoundResponse();
    });

    render(<App />);

    expect(screen.queryByLabelText("Telemetry ticker tape")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "[5] Monitor" }));
    expect(await screen.findByLabelText("Monitor primary view disabled")).toBeInTheDocument();

    expect(monitorConfigCalls).toBe(0);
    expect(monitorFeedCalls).toBe(0);
    expect(monitorRefreshCalls).toBe(0);
  });
});
