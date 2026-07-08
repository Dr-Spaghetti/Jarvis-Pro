import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const buildRecentCommits = () =>
  Array.from({ length: 50 }, (_, index) => {
    const offset = index + 1;
    const day = String(Math.max(1, 27 - index)).padStart(2, "0");
    return {
      hash: `hash-${offset.toString(16).padStart(40, "a")}`,
      shortHash: `short${offset}`,
      subject: `recent commit ${offset}`,
      authorName: "Hesam Sheikh",
      authorEmail: "hesam@example.com",
      authoredAt: `2026-02-${day}T10:12:00.000Z`,
      body: `body for commit ${offset}`,
      filesChanged: offset + 1,
      insertions: offset * 10,
      deletions: offset * 2,
    };
  });

const mockGithubRuntimeRequests = () => {
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
        fetchedAt: "2026-02-27T12:00:00.000Z",
      });
    }

    if (url.endsWith("/api/claude/usage") && method === "GET") {
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-27T12:00:00.000Z",
      });
    }

    if (url.includes("/api/analytics/usage-heatmap") && method === "GET") {
      return jsonResponse({
        days: [],
        projects: [],
        models: [],
      });
    }

    if (url.endsWith("/api/github/summary") && method === "GET") {
      return jsonResponse({
        status: "ok",
        source: "gh-cli",
        fetchedAt: "2026-02-27T12:00:00.000Z",
        repo: "hesamsheikh/octogent",
        stargazerCount: 42,
        openIssueCount: 7,
        openPullRequestCount: 3,
        commitsPerDay: [
          { date: "2026-02-25", count: 4 },
          { date: "2026-02-26", count: 6 },
          { date: "2026-02-27", count: 8 },
        ],
        recentCommits: buildRecentCommits(),
      });
    }

    if (url.endsWith("/api/ui-state") && method === "GET") {
      return jsonResponse({});
    }

    return notFoundResponse();
  });
};

describe("App GitHub runtime views", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("renders github repo metrics in the runtime status strip", async () => {
    mockGithubRuntimeRequests();

    const { container } = render(<App />);

    const strip = await screen.findByLabelText("Runtime status strip");
    expect(within(strip).getByText("COMMITS/DAY · LAST 30 DAYS")).toBeInTheDocument();

    const sparkline = container.querySelector(".console-status-sparkline polyline");
    expect(sparkline).not.toBeNull();
    expect(sparkline?.getAttribute("points")).not.toBe("");
  });

  it("renders the Analyzer view when navigating to the Analyzer tab", async () => {
    mockGithubRuntimeRequests();

    const { container } = render(<App />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Content Analyzer (5)",
      }),
    );

    expect(await screen.findByLabelText("Analyzer primary view")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload file for analysis")).toBeInTheDocument();
  });
});
