import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiFetch,
  appendAuthTokenParam,
  clearStoredAuthToken,
  getStoredAuthToken,
  setUnauthorizedListener,
  storeAuthToken,
} from "../src/runtime/apiClient";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("apiClient", () => {
  afterEach(() => {
    clearStoredAuthToken();
    setUnauthorizedListener(null);
    vi.restoreAllMocks();
  });

  it("stores, reads, and clears the auth token", () => {
    expect(getStoredAuthToken()).toBeNull();
    storeAuthToken("my-token");
    expect(getStoredAuthToken()).toBe("my-token");
    clearStoredAuthToken();
    expect(getStoredAuthToken()).toBeNull();
  });

  it("sends no Authorization header when no token is stored", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch("/api/example");

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init).toBeUndefined();
  });

  it("attaches the stored token as a Bearer Authorization header", async () => {
    storeAuthToken("my-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch("/api/example", { method: "POST" });

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer my-token");
  });

  it("does not override an explicitly provided Authorization header", async () => {
    storeAuthToken("stored-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch("/api/example", {
      headers: { Authorization: "Bearer explicit-token" },
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer explicit-token");
  });

  it("notifies the unauthorized listener on a 401 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "nope" }, 401));
    const listener = vi.fn();
    setUnauthorizedListener(listener);

    const response = await apiFetch("/api/example");

    expect(response.status).toBe(401);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("appends the token as a ?token= query parameter only when one is stored", () => {
    expect(appendAuthTokenParam("/api/settings/export")).toBe("/api/settings/export");

    storeAuthToken("query token+value");
    expect(appendAuthTokenParam("/api/settings/export")).toBe(
      "/api/settings/export?token=query%20token%2Bvalue",
    );
    expect(appendAuthTokenParam("/api/export?format=json")).toBe(
      "/api/export?format=json&token=query%20token%2Bvalue",
    );
  });
});
