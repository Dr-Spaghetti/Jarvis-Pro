import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToasts } from "../src/components/ui/ToastProvider";

const ToastTrigger = ({ message, variant }: { message: string; variant: "ok" | "error" }) => {
  const { showToast } = useToasts();
  return (
    <button type="button" onClick={() => showToast(message, variant)}>
      trigger
    </button>
  );
};

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows an ok toast with the gold variant class", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Skills saved" variant="ok" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    const toast = screen.getByText("Skills saved").closest(".toast");
    expect(toast).toHaveClass("toast--ok");
  });

  it("shows an error toast with the error variant class", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Failed to delete agent" variant="error" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    const toast = screen.getByText("Failed to delete agent").closest(".toast");
    expect(toast).toHaveClass("toast--error");
  });

  it("renders the toast stack with polite live-region semantics", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="hello" variant="ok" />
      </ToastProvider>,
    );

    const stack = screen.getByRole("status");
    expect(stack).toHaveAttribute("aria-live", "polite");
  });

  it("auto-dismisses a toast after 4 seconds", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="ephemeral" variant="ok" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getByText("ephemeral")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("ephemeral")).not.toBeInTheDocument();
  });

  it("dismisses a toast manually before the timer fires", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="manual" variant="ok" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("manual")).not.toBeInTheDocument();
  });

  it("stacks multiple toasts and dismisses them independently", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="first" variant="ok" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    expect(screen.getAllByText("first")).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByText("first")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("unmounts safely with pending timers", () => {
    const { unmount } = render(
      <ToastProvider>
        <ToastTrigger message="pending" variant="ok" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    expect(() => {
      unmount();
      vi.runAllTimers();
    }).not.toThrow();
  });

  it("throws when useToasts is used outside a provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ToastTrigger message="x" variant="ok" />)).toThrow(
      "useToasts must be used within a ToastProvider",
    );
    consoleError.mockRestore();
  });
});
