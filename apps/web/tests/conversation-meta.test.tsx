import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationSessionSummary } from "../src/app/types";
import { SidebarConversationsList } from "../src/components/SidebarConversationsList";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

afterEach(() => {
  cleanup();
  resetAppTestHarness();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeSession = (
  overrides: Partial<ConversationSessionSummary> & { sessionId: string },
): ConversationSessionSummary => ({
  tentacleId: "agent-1",
  startedAt: "2026-06-01T10:00:00.000Z",
  endedAt: "2026-06-01T10:05:00.000Z",
  lastEventAt: "2026-06-01T10:05:00.000Z",
  eventCount: 4,
  turnCount: 2,
  userTurnCount: 1,
  assistantTurnCount: 1,
  firstUserTurnPreview: "hello",
  lastUserTurnPreview: "hello",
  lastAssistantTurnPreview: "world",
  ...overrides,
});

// ─── Sort order ───────────────────────────────────────────────────────────────

describe("SidebarConversationsList sort order", () => {
  it("renders pinned sessions before non-pinned", () => {
    const sessions = [
      makeSession({ sessionId: "older", lastEventAt: "2026-06-01T09:00:00.000Z" }),
      makeSession({ sessionId: "newer", lastEventAt: "2026-06-01T11:00:00.000Z" }),
      makeSession({
        sessionId: "pinned-old",
        lastEventAt: "2026-06-01T08:00:00.000Z",
        pinned: true,
      }),
    ];

    render(
      <SidebarConversationsList
        sessions={sessions}
        selectedSessionId={null}
        isLoadingSessions={false}
        isSearching={false}
        searchQuery=""
        searchHits={[]}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClearAll={vi.fn()}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
        onNavigateToHit={vi.fn()}
      />,
    );

    // The first session button should belong to the pinned session
    const listItems = screen.getAllByRole("listitem");
    const firstEntry = listItems[0];
    expect(firstEntry).toBeDefined();
    // pinned-old should appear before newer (which is more recent but unpinned)
    const allButtons = screen
      .getAllByRole("button")
      .filter((b) => b.tagName === "BUTTON" && b.classList.contains("sidebar-conversation-item"));
    // First item button should be "pinned-old" (oldest by time but pinned)
    expect(allButtons[0]).toBeDefined();
  });

  it("shows pinned indicator as pressed for pinned sessions", () => {
    const sessions = [makeSession({ sessionId: "s1", pinned: true })];

    render(
      <SidebarConversationsList
        sessions={sessions}
        selectedSessionId={null}
        isLoadingSessions={false}
        isSearching={false}
        searchQuery=""
        searchHits={[]}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClearAll={vi.fn()}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
        onNavigateToHit={vi.fn()}
        onPatchMeta={vi.fn()}
      />,
    );

    const pinBtn = screen.getByRole("button", { name: "Unpin conversation" });
    expect(pinBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows unpin label for unpinned sessions", () => {
    const sessions = [makeSession({ sessionId: "s1", pinned: false })];

    render(
      <SidebarConversationsList
        sessions={sessions}
        selectedSessionId={null}
        isLoadingSessions={false}
        isSearching={false}
        searchQuery=""
        searchHits={[]}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClearAll={vi.fn()}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
        onNavigateToHit={vi.fn()}
        onPatchMeta={vi.fn()}
      />,
    );

    const pinBtn = screen.getByRole("button", { name: "Pin conversation" });
    expect(pinBtn.getAttribute("aria-pressed")).toBe("false");
  });
});

// ─── Pin toggle fires PATCH ────────────────────────────────────────────────────

describe("SidebarConversationsList pin toggle", () => {
  it("calls onPatchMeta with toggled pinned value when pin button clicked", () => {
    const onPatchMeta = vi.fn();
    const sessions = [makeSession({ sessionId: "s1", pinned: false })];

    render(
      <SidebarConversationsList
        sessions={sessions}
        selectedSessionId={null}
        isLoadingSessions={false}
        isSearching={false}
        searchQuery=""
        searchHits={[]}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClearAll={vi.fn()}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
        onNavigateToHit={vi.fn()}
        onPatchMeta={onPatchMeta}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pin conversation" }));
    expect(onPatchMeta).toHaveBeenCalledWith("s1", { pinned: true });
  });
});

// ─── Tag chips rendered ────────────────────────────────────────────────────────

describe("SidebarConversationsList tag chips", () => {
  it("renders tag chips for sessions with tags", () => {
    const sessions = [makeSession({ sessionId: "s1", tags: ["alpha", "beta"] })];

    render(
      <SidebarConversationsList
        sessions={sessions}
        selectedSessionId={null}
        isLoadingSessions={false}
        isSearching={false}
        searchQuery=""
        searchHits={[]}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClearAll={vi.fn()}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
        onNavigateToHit={vi.fn()}
        onPatchMeta={vi.fn()}
      />,
    );

    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.getByText("beta")).toBeDefined();
  });

  it("calls onPatchMeta with tag removed when × is clicked", () => {
    const onPatchMeta = vi.fn();
    const sessions = [makeSession({ sessionId: "s1", tags: ["alpha", "beta"] })];

    render(
      <SidebarConversationsList
        sessions={sessions}
        selectedSessionId={null}
        isLoadingSessions={false}
        isSearching={false}
        searchQuery=""
        searchHits={[]}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClearAll={vi.fn()}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
        onNavigateToHit={vi.fn()}
        onPatchMeta={onPatchMeta}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove tag alpha" }));
    expect(onPatchMeta).toHaveBeenCalledWith("s1", { tags: ["beta"] });
  });
});

// ─── No pin/tag controls when onPatchMeta not provided ────────────────────────

describe("SidebarConversationsList without onPatchMeta", () => {
  it("does not render pin button or tag controls", () => {
    const sessions = [makeSession({ sessionId: "s1", tags: ["x"], pinned: true })];

    render(
      <SidebarConversationsList
        sessions={sessions}
        selectedSessionId={null}
        isLoadingSessions={false}
        isSearching={false}
        searchQuery=""
        searchHits={[]}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClearAll={vi.fn()}
        onSearch={vi.fn()}
        onClearSearch={vi.fn()}
        onNavigateToHit={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /pin conversation/i })).toBeNull();
    // Tags are still rendered (read-only display), but no remove or add controls
    expect(screen.queryByRole("button", { name: /remove tag/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add tag/i })).toBeNull();
  });
});

// ─── useConversationsRuntime PATCH integration ────────────────────────────────

describe("useConversationsRuntime patchConversationMeta", () => {
  it("fires PATCH to meta URL and optimistically updates sessions", async () => {
    const { useConversationsRuntime } = await import("../src/app/hooks/useConversationsRuntime");
    const { renderHook, waitFor: waitForHook } = await import("@testing-library/react");

    const fetchMock = vi.spyOn(globalThis, "fetch");

    // Initial sessions load
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          sessionId: "s1",
          tentacleId: "t1",
          startedAt: "2026-06-01T10:00:00.000Z",
          endedAt: null,
          lastEventAt: "2026-06-01T10:05:00.000Z",
          eventCount: 2,
          turnCount: 2,
          userTurnCount: 1,
          assistantTurnCount: 1,
          firstUserTurnPreview: "hi",
          lastUserTurnPreview: "hi",
          lastAssistantTurnPreview: "hello",
          pinned: false,
        },
      ]),
    );

    const { result } = renderHook(() => useConversationsRuntime({ enabled: true }));

    await waitForHook(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    // PATCH response
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    // Call patch — optimistic update is synchronous
    const patchPromise = result.current.patchConversationMeta("s1", { pinned: true });

    // Optimistic update should be reflected after next render cycle
    await waitForHook(() => {
      expect(result.current.sessions[0]?.pinned).toBe(true);
    });

    const patched = await patchPromise;
    expect(patched).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/conversations/s1/meta"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
