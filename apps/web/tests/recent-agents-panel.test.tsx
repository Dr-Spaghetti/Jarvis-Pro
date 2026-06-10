import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeckTentacleSummary } from "@octogent/core";

import { App } from "../src/App";
import { RecentAgentsPanel, deriveRecentAgents } from "../src/components/deck/RecentAgentsPanel";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

// ─── Helper fixtures ──────────────────────────────────────────────────────────

const makeTentacle = (
  overrides: Partial<DeckTentacleSummary> & { tentacleId: string; displayName: string },
): DeckTentacleSummary => ({
  description: "",
  status: "idle",
  color: null,
  octopus: { animation: null, expression: null, accessory: null, hairColor: null },
  scope: { paths: [], tags: [] },
  vaultFiles: [],
  todoTotal: 0,
  todoDone: 0,
  todoItems: [],
  suggestedSkills: [],
  lastOpenedAt: null,
  openCount: 0,
  pinned: false,
  ...overrides,
});

const NOW = new Date("2026-06-09T12:00:00.000Z").getTime();

// ─── deriveRecentAgents ───────────────────────────────────────────────────────

describe("deriveRecentAgents", () => {
  it("returns empty list when no tentacles exist", () => {
    expect(deriveRecentAgents([], "recent")).toHaveLength(0);
  });

  it("excludes never-opened non-pinned tentacles from recent list", () => {
    const t = makeTentacle({ tentacleId: "a", displayName: "A", lastOpenedAt: null });
    expect(deriveRecentAgents([t], "recent")).toHaveLength(0);
  });

  it("always includes pinned tentacles even without lastOpenedAt", () => {
    const t = makeTentacle({ tentacleId: "a", displayName: "A", pinned: true, lastOpenedAt: null });
    const result = deriveRecentAgents([t], "recent");
    expect(result).toHaveLength(1);
    expect(result[0]?.tentacleId).toBe("a");
  });

  it("orders recent entries by lastOpenedAt descending", () => {
    const older = makeTentacle({
      tentacleId: "old",
      displayName: "Old",
      lastOpenedAt: "2026-06-01T00:00:00.000Z",
    });
    const newer = makeTentacle({
      tentacleId: "new",
      displayName: "New",
      lastOpenedAt: "2026-06-08T00:00:00.000Z",
    });
    const [first, second] = deriveRecentAgents([older, newer], "recent");
    expect(first?.tentacleId).toBe("new");
    expect(second?.tentacleId).toBe("old");
  });

  it("caps recent (non-pinned) list at maxRecent", () => {
    const tentacles = Array.from({ length: 8 }, (_, i) =>
      makeTentacle({
        tentacleId: `t${i}`,
        displayName: `T${i}`,
        lastOpenedAt: `2026-06-0${i + 1}T00:00:00.000Z`,
      }),
    );
    const result = deriveRecentAgents(tentacles, "recent", 5);
    expect(result).toHaveLength(5);
  });

  it("sorts active status first in active-first mode", () => {
    const idle = makeTentacle({
      tentacleId: "idle",
      displayName: "Idle",
      status: "idle",
      lastOpenedAt: "2026-06-09T11:00:00.000Z",
    });
    const active = makeTentacle({
      tentacleId: "active",
      displayName: "Active",
      status: "active",
      lastOpenedAt: "2026-06-01T00:00:00.000Z",
    });
    const [first] = deriveRecentAgents([idle, active], "active-first");
    expect(first?.tentacleId).toBe("active");
  });

  it("sorts needs-review status first in needs-review-first mode", () => {
    const idle = makeTentacle({
      tentacleId: "idle",
      displayName: "Idle",
      status: "idle",
      lastOpenedAt: "2026-06-09T11:00:00.000Z",
    });
    const review = makeTentacle({
      tentacleId: "review",
      displayName: "Review",
      status: "needs-review",
      lastOpenedAt: "2026-06-01T00:00:00.000Z",
    });
    const [first] = deriveRecentAgents([idle, review], "needs-review-first");
    expect(first?.tentacleId).toBe("review");
  });

  it("puts pinned items first in pinned-first mode", () => {
    const notPinned = makeTentacle({
      tentacleId: "np",
      displayName: "NotPinned",
      lastOpenedAt: "2026-06-09T11:00:00.000Z",
    });
    const pinned = makeTentacle({
      tentacleId: "p",
      displayName: "Pinned",
      pinned: true,
      lastOpenedAt: "2026-06-01T00:00:00.000Z",
    });
    const [first] = deriveRecentAgents([notPinned, pinned], "pinned-first");
    expect(first?.tentacleId).toBe("p");
  });
});

// ─── RecentAgentsPanel component ──────────────────────────────────────────────

describe("RecentAgentsPanel", () => {
  afterEach(() => cleanup());

  it("renders empty state when no opened or pinned agents exist", () => {
    const t = makeTentacle({ tentacleId: "a", displayName: "A" });
    render(
      <RecentAgentsPanel
        tentacles={[t]}
        onOpenTentacle={vi.fn()}
        onPinToggle={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getByText("No recently opened agents yet.")).toBeInTheDocument();
  });

  it("renders a row for a recently opened agent", () => {
    const t = makeTentacle({
      tentacleId: "a",
      displayName: "Alpha",
      lastOpenedAt: "2026-06-09T10:00:00.000Z",
      openCount: 3,
    });
    render(
      <RecentAgentsPanel
        tentacles={[t]}
        onOpenTentacle={vi.fn()}
        onPinToggle={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("renders status badge for each row", () => {
    const t = makeTentacle({
      tentacleId: "a",
      displayName: "Alpha",
      status: "active",
      lastOpenedAt: "2026-06-09T11:50:00.000Z",
    });
    render(
      <RecentAgentsPanel
        tentacles={[t]}
        onOpenTentacle={vi.fn()}
        onPinToggle={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("renders pin button with aria-pressed=false for unpinned agent", () => {
    const t = makeTentacle({
      tentacleId: "a",
      displayName: "Alpha",
      lastOpenedAt: "2026-06-09T11:50:00.000Z",
    });
    render(
      <RecentAgentsPanel
        tentacles={[t]}
        onOpenTentacle={vi.fn()}
        onPinToggle={vi.fn()}
        now={NOW}
      />,
    );
    const pinBtn = screen.getByRole("button", { name: /Pin Alpha/ });
    expect(pinBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("renders pin button with aria-pressed=true for pinned agent", () => {
    const t = makeTentacle({
      tentacleId: "a",
      displayName: "Alpha",
      pinned: true,
      lastOpenedAt: "2026-06-09T11:50:00.000Z",
    });
    render(
      <RecentAgentsPanel
        tentacles={[t]}
        onOpenTentacle={vi.fn()}
        onPinToggle={vi.fn()}
        now={NOW}
      />,
    );
    const pinBtn = screen.getByRole("button", { name: /Unpin Alpha/ });
    expect(pinBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onPinToggle with correct args when pin button is clicked", async () => {
    const onPinToggle = vi.fn();
    const t = makeTentacle({
      tentacleId: "a",
      displayName: "Alpha",
      lastOpenedAt: "2026-06-09T11:50:00.000Z",
    });
    render(
      <RecentAgentsPanel
        tentacles={[t]}
        onOpenTentacle={vi.fn()}
        onPinToggle={onPinToggle}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Pin Alpha/ }));
    expect(onPinToggle).toHaveBeenCalledWith("a", true);
  });

  it("calls onOpenTentacle when a row is clicked", () => {
    const onOpenTentacle = vi.fn();
    const t = makeTentacle({
      tentacleId: "a",
      displayName: "Alpha",
      lastOpenedAt: "2026-06-09T11:50:00.000Z",
    });
    render(
      <RecentAgentsPanel
        tentacles={[t]}
        onOpenTentacle={onOpenTentacle}
        onPinToggle={vi.fn()}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByText("Alpha"));
    expect(onOpenTentacle).toHaveBeenCalledWith("a");
  });
});

// ─── DeckPrimaryView integration ──────────────────────────────────────────────

const TENTACLE_FIXTURE: DeckTentacleSummary = {
  tentacleId: "agent-1",
  displayName: "Agent One",
  description: "Test agent",
  status: "idle",
  color: null,
  octopus: { animation: null, expression: null, accessory: null, hairColor: null },
  scope: { paths: [], tags: [] },
  vaultFiles: [],
  todoTotal: 0,
  todoDone: 0,
  todoItems: [],
  suggestedSkills: [],
  lastOpenedAt: "2026-06-09T10:00:00.000Z",
  openCount: 2,
  pinned: false,
};

const TENTACLE_AFTER_OPEN: DeckTentacleSummary = {
  ...TENTACLE_FIXTURE,
  openCount: 3,
  lastOpenedAt: "2026-06-09T12:00:00.000Z",
};

const TENTACLE_AFTER_PIN: DeckTentacleSummary = {
  ...TENTACLE_FIXTURE,
  pinned: true,
};

const mockDeckRequests = (
  opts: {
    afterOpen?: DeckTentacleSummary;
    afterPin?: DeckTentacleSummary;
  } = {},
) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method?.toUpperCase() ?? "GET";

    if (url.endsWith("/api/terminal-snapshots") && method === "GET") return jsonResponse([]);
    if (url.endsWith("/api/deck/tentacles") && method === "GET")
      return jsonResponse([TENTACLE_FIXTURE]);
    if (url.endsWith("/api/deck/skills") && method === "GET") return jsonResponse([]);
    if (url.endsWith("/api/codex/usage") && method === "GET")
      return jsonResponse({ status: "unavailable", source: "none", fetchedAt: "" });
    if (url.endsWith("/api/claude/usage") && method === "GET")
      return jsonResponse({ status: "unavailable", source: "none", fetchedAt: "" });
    if (url.endsWith("/api/github/summary") && method === "GET")
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "",
        commitsPerDay: [],
      });
    if (url.includes("/api/analytics/usage-heatmap") && method === "GET")
      return jsonResponse({ days: [], projects: [], models: [] });
    if (url.endsWith("/api/ui-state") && method === "GET") return jsonResponse({});
    if (url.endsWith("/api/setup") && method === "GET")
      return jsonResponse({
        isFirstRun: false,
        shouldShowSetupCard: false,
        hasAnyTentacles: true,
        tentacleCount: 1,
        steps: [],
      });
    if (url.endsWith("/api/voice/config") && method === "GET")
      return jsonResponse({
        wake: { phrases: [] },
        transcription: { configured: false, defaultModel: "", models: [], whisperSupported: false },
        tts: { configured: false, fallback: "browser-speech-synthesis" },
      });

    if (url.includes("/api/deck/tentacles/agent-1/opened") && method === "POST")
      return jsonResponse(opts.afterOpen ?? TENTACLE_AFTER_OPEN);

    if (url.includes("/api/deck/tentacles/agent-1/pinned") && method === "PATCH")
      return jsonResponse(opts.afterPin ?? TENTACLE_AFTER_PIN);

    return notFoundResponse();
  });
};

describe("DeckPrimaryView – recordOpened and togglePin", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("fires POST opened when a row in the Recent Agents panel is clicked", async () => {
    mockDeckRequests();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "[2] Deck" }));

    const panel = await screen.findByRole("region", { name: "Recent Agents" });
    fireEvent.click(within(panel).getByText("Agent One"));

    const fetchSpy = vi.mocked(globalThis.fetch);
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/deck/tentacles/agent-1/opened") &&
          (init?.method?.toUpperCase() ?? "GET") === "POST",
      );
      expect(call).toBeDefined();
    });
  });

  it("fires PATCH pinned with correct payload from pin toggle in the panel", async () => {
    mockDeckRequests();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "[2] Deck" }));

    const panel = await screen.findByRole("region", { name: "Recent Agents" });
    fireEvent.click(within(panel).getByRole("button", { name: /Pin Agent One/ }));

    const fetchSpy = vi.mocked(globalThis.fetch);
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/deck/tentacles/agent-1/pinned") &&
          (init?.method?.toUpperCase() ?? "GET") === "PATCH",
      );
      expect(call).toBeDefined();
      const body = JSON.parse(call?.[1]?.body as string);
      expect(body).toEqual({ pinned: true });
    });
  });
});
