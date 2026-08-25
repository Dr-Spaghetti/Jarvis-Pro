import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentArsenalPanel } from "../src/components/AgentArsenalPanel";
import { ToastProvider } from "../src/components/ui/ToastProvider";
import { jsonResponse } from "./test-utils/appTestHarness";

const ARCHETYPE = {
  id: "senior-developer",
  name: "Senior Developer",
  role: "Writes production code",
  icon: "💻",
  category: "technical",
  skills: ["typescript"],
};

describe("AgentArsenalPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers Deploy as the only card action", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/arsenal")) {
        return jsonResponse([ARCHETYPE]);
      }
      if (url.endsWith("/api/setup")) {
        return jsonResponse({
          isFirstRun: false,
          shouldShowSetupCard: false,
          hasAnyTentacles: false,
          tentacleCount: 0,
          steps: [],
        });
      }
      if (url.endsWith("/api/deck/tentacles")) {
        return jsonResponse([]);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    render(
      <ToastProvider>
        <AgentArsenalPanel />
      </ToastProvider>,
    );

    expect(await screen.findByRole("button", { name: "Deploy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Brainstorm" })).not.toBeInTheDocument();
    expect(screen.queryByText(/brainstorm/i)).not.toBeInTheDocument();
  });
});
