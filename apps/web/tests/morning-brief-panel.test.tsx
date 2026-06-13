import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MorningBriefPanel } from "../src/components/MorningBriefPanel";
import { ToastProvider } from "../src/components/ui/ToastProvider";
import { clearStoredAuthToken } from "../src/runtime/apiClient";

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const renderPanel = () =>
  render(
    <ToastProvider>
      <MorningBriefPanel />
    </ToastProvider>,
  );

describe("MorningBriefPanel", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.restoreAllMocks();
  });

  it("shows the disabled status and brief time from config", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/brief/config")) {
        return jsonResponse({
          enabled: false,
          time: "08:00",
          lastBriefDate: null,
          lastBriefAt: null,
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderPanel();

    expect(await screen.findByText(/Last brief: never · Next: disabled/)).toBeInTheDocument();
    expect(screen.getByLabelText("Brief time")).toHaveValue("08:00");
  });

  it("PATCHes the enabled flag when the toggle is switched on", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (requestUrl(input).endsWith("/api/brief/config")) {
        if (init?.method === "PATCH") {
          return jsonResponse({
            enabled: true,
            time: "08:00",
            lastBriefDate: null,
            lastBriefAt: null,
          });
        }
        return jsonResponse({
          enabled: false,
          time: "08:00",
          lastBriefDate: null,
          lastBriefAt: null,
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderPanel();

    const toggle = await screen.findByLabelText("Enable daily morning brief");
    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ enabled: true });
    });
    expect(await screen.findByText(/Next: 08:00 daily/)).toBeInTheDocument();
  });

  it("shows an error state with retry when config fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Failed to load morning brief settings.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
