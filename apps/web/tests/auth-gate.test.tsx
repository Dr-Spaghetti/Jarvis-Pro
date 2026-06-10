import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "../src/components/AuthGate";
import { clearStoredAuthToken, getStoredAuthToken, storeAuthToken } from "../src/runtime/apiClient";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const noContentResponse = () => new Response(null, { status: 204 });

const unauthorizedResponse = () =>
  new Response(JSON.stringify({ error: "Authentication required." }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

describe("AuthGate", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.restoreAllMocks();
  });

  it("renders children directly when the server does not require auth", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/auth/status")) {
        return jsonResponse({ authRequired: false });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(
      <AuthGate>
        <p>app content</p>
      </AuthGate>,
    );

    expect(await screen.findByText("app content")).toBeInTheDocument();
  });

  it("prompts for a token, rejects a wrong one, and unlocks with the right one", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/status")) {
        return jsonResponse({ authRequired: true });
      }
      if (url.endsWith("/api/auth/verify")) {
        const headers = new Headers(init?.headers);
        return headers.get("Authorization") === "Bearer correct-token"
          ? noContentResponse()
          : unauthorizedResponse();
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(
      <AuthGate>
        <p>app content</p>
      </AuthGate>,
    );

    const input = await screen.findByLabelText("Access token");
    expect(screen.queryByText("app content")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "wrong-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText(/That token was rejected/)).toBeInTheDocument();
    expect(getStoredAuthToken()).toBeNull();

    fireEvent.change(input, { target: { value: "correct-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("app content")).toBeInTheDocument();
    expect(getStoredAuthToken()).toBe("correct-token");
  });

  it("skips the prompt when a stored token verifies successfully", async () => {
    storeAuthToken("already-saved");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/status")) {
        return jsonResponse({ authRequired: true });
      }
      if (url.endsWith("/api/auth/verify")) {
        const headers = new Headers(init?.headers);
        return headers.get("Authorization") === "Bearer already-saved"
          ? noContentResponse()
          : unauthorizedResponse();
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(
      <AuthGate>
        <p>app content</p>
      </AuthGate>,
    );

    expect(await screen.findByText("app content")).toBeInTheDocument();
  });

  it("clears a stale stored token and prompts when verification fails", async () => {
    storeAuthToken("stale-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/status")) {
        return jsonResponse({ authRequired: true });
      }
      if (url.endsWith("/api/auth/verify")) {
        return unauthorizedResponse();
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(
      <AuthGate>
        <p>app content</p>
      </AuthGate>,
    );

    expect(await screen.findByLabelText("Access token")).toBeInTheDocument();
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
    expect(getStoredAuthToken()).toBeNull();
  });

  it("shows an error state with retry when the status check fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    render(
      <AuthGate>
        <p>app content</p>
      </AuthGate>,
    );

    expect(
      await screen.findByText("Could not reach the server to check authentication."),
    ).toBeInTheDocument();

    fetchSpy.mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/api/auth/status")) {
        return jsonResponse({ authRequired: false });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("app content")).toBeInTheDocument();
    });
  });
});
