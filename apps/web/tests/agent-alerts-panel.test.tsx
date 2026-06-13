import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentAlertsPanel } from "../src/components/AgentAlertsPanel";
import { ToastProvider } from "../src/components/ui/ToastProvider";
import { clearStoredAuthToken } from "../src/runtime/apiClient";

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const renderWithToasts = (node: ReactElement) => render(<ToastProvider>{node}</ToastProvider>);

describe("AgentAlertsPanel", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.restoreAllMocks();
  });

  it("shows the disabled empty state when no rule is enabled", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/monitor/alerts")) {
        return jsonResponse({ config: { agentStuckMinutes: null }, alerts: [] });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderWithToasts(<AgentAlertsPanel />);

    expect(await screen.findByText(/No alert rules enabled/)).toBeInTheDocument();
  });

  it("shows the all-clear state when a rule is on but nothing is stuck", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/monitor/alerts")) {
        return jsonResponse({ config: { agentStuckMinutes: 10 }, alerts: [] });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderWithToasts(<AgentAlertsPanel />);

    expect(await screen.findByText(/All clear/)).toBeInTheDocument();
  });

  it("renders active alerts from the server", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/monitor/alerts")) {
        return jsonResponse({
          config: { agentStuckMinutes: 5 },
          alerts: [
            {
              id: "agent-stuck:terminal-1",
              type: "agent-stuck",
              severity: "warning",
              terminalId: "terminal-1",
              tentacleId: "alpha",
              label: "Alpha",
              message: "Alpha has been waiting for input for 12 min.",
              since: "2026-06-12T10:00:00.000Z",
            },
          ],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderWithToasts(<AgentAlertsPanel />);

    expect(
      await screen.findByText("Alpha has been waiting for input for 12 min."),
    ).toBeInTheDocument();
  });

  it("shows an error state with retry when alerts fail to load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    renderWithToasts(<AgentAlertsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load alerts.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
