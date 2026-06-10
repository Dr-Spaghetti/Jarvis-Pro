import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRIMARY_NAV_ITEMS } from "../src/app/constants";
import { ShortcutsOverlay } from "../src/components/ui/ShortcutsOverlay";

describe("ShortcutsOverlay", () => {
  afterEach(() => cleanup());

  it("renders a modal dialog listing every primary nav shortcut", () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    for (const item of PRIMARY_NAV_ITEMS) {
      expect(screen.getByText(`Go to ${item.label}`)).toBeInTheDocument();
    }
  });

  it("focuses the dialog on mount", () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveFocus();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Keyboard shortcuts" }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close shortcuts overlay" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked but not when the dialog body is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutsOverlay onClose={onClose} />);

    fireEvent.click(screen.getByText("Keyboard Shortcuts"));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = container.querySelector(".shortcuts-overlay-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
