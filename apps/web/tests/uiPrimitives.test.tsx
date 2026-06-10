import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionButton } from "../src/components/ui/ActionButton";
import { PanelState } from "../src/components/ui/PanelState";
import { StatusBadge } from "../src/components/ui/StatusBadge";

describe("UI primitives", () => {
  it("renders action button variants and size classes", () => {
    render(
      <ActionButton size="compact" variant="danger">
        Delete
      </ActionButton>,
    );

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "action-button",
      "action-button--danger",
      "action-button--compact",
    );
  });

  it("renders status badges with semantic tone classes", () => {
    render(<StatusBadge tone="processing" />);

    expect(screen.getByText("PROCESSING").closest(".status-badge")).toHaveClass(
      "status-badge",
      "pill",
      "processing",
    );
  });

  it("renders panel states with state-specific classes", () => {
    render(<PanelState state="loading" message="Loading agents…" />);

    expect(screen.getByText("Loading agents…").closest(".panel-state")).toHaveClass(
      "panel-state--loading",
    );
  });

  it("shows a retry button only for error state with an onRetry handler", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <PanelState state="error" message="Failed to load" onRetry={onRetry} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<PanelState state="empty" message="Nothing here" onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    rerender(<PanelState state="error" message="Failed without retry" />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
