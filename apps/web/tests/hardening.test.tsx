import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeckTentacleSummary } from "@octogent/core";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENTACLE: DeckTentacleSummary = {
  tentacleId: "agent-1",
  displayName: "Agent One",
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
  lastOpenedAt: "2026-06-09T10:00:00.000Z",
  openCount: 1,
  pinned: false,
};

type JournalEntry = {
  ts: string;
  status: "ok" | "warn" | "error";
  skill: string | null;
  action: string;
  detail: string | null;
};

type BrainNote = { title: string; path: string; modified?: string; snippet?: string };

type MockOpts = {
  tentacles?: DeckTentacleSummary[];
  afterPin?: DeckTentacleSummary;
  journalEntries?: JournalEntry[];
  semanticNotes?: BrainNote[];
};

// ─── Unified mock ─────────────────────────────────────────────────────────────

const mockRequests = (opts: MockOpts = {}) => {
  const tentacles = opts.tentacles ?? [TENTACLE];
  const afterPin = opts.afterPin ?? { ...TENTACLE, pinned: true };
  const journalEntries = opts.journalEntries ?? [];
  const semanticNotes = opts.semanticNotes ?? [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method?.toUpperCase() ?? "GET";

    // Shell
    if (url.endsWith("/api/terminal-snapshots") && method === "GET") return jsonResponse([]);
    if (url.endsWith("/api/ui-state") && method === "GET") return jsonResponse({});
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
    if (url.endsWith("/api/voice/config") && method === "GET")
      return jsonResponse({
        wake: { phrases: [] },
        transcription: { configured: false, defaultModel: "", models: [], whisperSupported: false },
        tts: { configured: false, fallback: "browser-speech-synthesis" },
      });

    // Deck
    if (url.endsWith("/api/deck/tentacles") && method === "GET") return jsonResponse(tentacles);
    if (url.endsWith("/api/deck/skills") && method === "GET") return jsonResponse([]);
    if (url.endsWith("/api/setup") && method === "GET")
      return jsonResponse({
        isFirstRun: false,
        shouldShowSetupCard: false,
        hasAnyTentacles: true,
        tentacleCount: 1,
        steps: [],
      });
    if (url.includes("/api/deck/tentacles/agent-1/opened") && method === "POST")
      return jsonResponse(TENTACLE);
    if (url.includes("/api/deck/tentacles/agent-1/pinned") && method === "PATCH")
      return jsonResponse(afterPin);

    // Brain
    if (url.includes("/api/brain/recent")) return jsonResponse({ configured: true, notes: [] });
    if (url.includes("/api/brain/journal"))
      return jsonResponse({ configured: true, entries: journalEntries });
    if (url.includes("/api/brain/memory")) return jsonResponse({ items: [] });
    if (url.includes("/api/brain/digest")) return jsonResponse({ tasks: { openCount: 0 } });
    if (url.includes("/api/brain/semantic")) return jsonResponse({ notes: semanticNotes });

    return notFoundResponse();
  });
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Hardening: integration paths", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("pin button reflects pinned state after toggle", async () => {
    mockRequests({ afterPin: { ...TENTACLE, pinned: true } });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Agent Arsenal (1)" }));

    const panel = await screen.findByRole("region", { name: "Recent Agents" });

    const pinBtn = await waitFor(() => screen.getByRole("button", { name: /Pin Agent One/ }));
    expect(pinBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unpin Agent One/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    expect(panel).toBeInTheDocument();
  });

  it("pressing ? opens shortcuts overlay; Escape closes it", async () => {
    mockRequests();
    render(<App />);

    await screen.findByRole("navigation", { name: "Primary navigation" });

    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "?" });

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    });
  });

  it("Analyzer view renders upload zone after navigating to Analyzer", async () => {
    mockRequests();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Content Analyzer (5)" }));

    expect(await screen.findByLabelText("Analyzer primary view")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload file for analysis")).toBeInTheDocument();
  });

  it("Settings view has a download link for the settings backup", async () => {
    mockRequests();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings (7)" }));

    await screen.findByLabelText("Settings primary view");

    fireEvent.click(screen.getByRole("button", { name: "Backup" }));

    const exportLink = document.querySelector<HTMLAnchorElement>(
      "a[download='octogent-settings.json']",
    );
    expect(exportLink).not.toBeNull();
    expect(exportLink?.getAttribute("href")).toMatch(/\/api\/settings\/export/);
  });

  it("brain search shows results after typing a query", async () => {
    const notes: BrainNote[] = [
      {
        title: "Obsidian Tips",
        path: "obsidian-tips.md",
        modified: "2026-06-01",
        snippet: "Best practices",
      },
      {
        title: "Obsidian Plugins",
        path: "obsidian-plugins.md",
        modified: "2026-06-02",
        snippet: "Top picks",
      },
    ];
    mockRequests({ semanticNotes: notes });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings (7)" }));
    await screen.findByLabelText("Settings primary view");
    fireEvent.click(screen.getByRole("button", { name: "Interface" }));

    const searchInput = await screen.findByLabelText("Search the vault");

    fireEvent.change(searchInput, { target: { value: "obsidian" } });

    await waitFor(
      () => {
        expect(screen.getByText("Obsidian Tips")).toBeInTheDocument();
        expect(screen.getByText("Obsidian Plugins")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });
});
