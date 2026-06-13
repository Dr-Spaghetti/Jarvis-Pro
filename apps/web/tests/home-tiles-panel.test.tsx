import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeTilesPanel } from "../src/components/HomeTilesPanel";
import { clearStoredAuthToken } from "../src/runtime/apiClient";

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("HomeTilesPanel", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.restoreAllMocks();
  });

  it("renders ok values and not-configured tiles distinctly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/tiles")) {
        return jsonResponse({
          generatedAt: "2026-06-12T09:00:00.000Z",
          tiles: [
            { id: "open-tasks", title: "Open tasks", status: "ok", value: 4 },
            {
              id: "apollo",
              title: "Apollo",
              status: "not-configured",
              value: null,
              detail: "Add APOLLO_API_KEY to .env to enable.",
            },
            {
              id: "gmail-unread",
              title: "Gmail unread",
              status: "error",
              value: null,
              detail: "Could not reach Gmail.",
            },
          ],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(<HomeTilesPanel />);

    expect(await screen.findByText("Open tasks")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    // not-configured + error tiles never show a value, only their status text
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("shows an error state with retry when tiles fail to load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    render(<HomeTilesPanel />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load home tiles.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("tolerates a malformed payload without crashing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/tiles")) {
        return jsonResponse({});
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(<HomeTilesPanel />);

    // No tiles, no crash — the header still renders.
    expect(await screen.findByText("📊 Today")).toBeInTheDocument();
  });
});
