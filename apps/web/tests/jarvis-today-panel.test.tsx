import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JarvisTodayPanel } from "../src/components/JarvisHome/JarvisTodayPanel";
import { clearStoredAuthToken } from "../src/runtime/apiClient";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("JarvisTodayPanel", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.restoreAllMocks();
  });

  it("lists open tasks and files a capture to the vault path", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/brain/tasks") && method === "GET") {
        return jsonResponse({
          configured: true,
          tasks: [
            {
              text: "Call Rachel",
              done: false,
              path: "Inbox.md",
              line: 4,
              stale: false,
              source: "inbox",
            },
          ],
        });
      }
      if (url.endsWith("/api/brain/memory")) {
        return jsonResponse({ configured: true, items: ["Always be brief"], sections: { Me: ["Always be brief"] } });
      }
      if (url.endsWith("/api/brief/config")) {
        return jsonResponse({ enabled: true, time: "08:00", lastBriefDate: "2026-08-25" });
      }
      if (url.endsWith("/api/tiles")) {
        return jsonResponse({ tiles: [], generatedAt: "2026-08-25T12:00:00.000Z" });
      }
      if (url.endsWith("/api/today")) {
        return jsonResponse({
          mail: { status: "ok", items: [], unread: 0 },
          agenda: { status: "ok", items: [] },
          approvals: [],
        });
      }
      if (url.endsWith("/api/brain/capture") && method === "POST") {
        return jsonResponse({ ok: true, kind: "note", path: "Inbox/Quick Capture.md" }, 201);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(<JarvisTodayPanel onNavigate={vi.fn()} />);

    expect(await screen.findByText("Call Rachel")).toBeInTheDocument();
    expect(screen.getByText("Always be brief")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Capture text"), {
      target: { value: "call Vinny" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Saved to Inbox/Quick Capture.md")).toBeInTheDocument();
    });
  });
});
