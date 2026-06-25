import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPrimaryView } from "../src/components/SettingsPrimaryView";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const BASE_PROPS = {
  terminalCompletionSound: "silent" as const,
  isRuntimeStatusStripVisible: true,
  isMonitorVisible: false,
  onTerminalCompletionSoundChange: vi.fn(),
  onPreviewTerminalCompletionSound: vi.fn(),
  onRuntimeStatusStripVisibilityChange: vi.fn(),
  onMonitorVisibilityChange: vi.fn(),
};

// SettingsPrimaryView now embeds the self-contained MorningBriefPanel, which
// uses the toast context and fetches its config on mount — render under the
// provider and stub fetch so those tests stay focused on the Gmail panel.
const renderSettings = (props: ComponentProps<typeof SettingsPrimaryView>) => {
  const result = render(
    <ToastProvider>
      <SettingsPrimaryView {...props} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
  return result;
};

describe("SettingsPrimaryView — Gmail panel", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ enabled: false, time: "08:00", lastBriefDate: null, lastBriefAt: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Connect Gmail button when not connected", () => {
    renderSettings({
      ...BASE_PROPS,
      gmailStatus: { connected: false },
      isConnectingGmail: false,
      onConnectGmail: vi.fn(),
      onDisconnectGmail: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeInTheDocument();
  });

  it("shows Connecting… label and disables button while connecting", () => {
    renderSettings({
      ...BASE_PROPS,
      gmailStatus: { connected: false },
      isConnectingGmail: true,
      onConnectGmail: vi.fn(),
      onDisconnectGmail: vi.fn(),
    });
    const btn = screen.getByRole("button", { name: "Connect Gmail" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Connecting…");
  });

  it("shows connected email and Disconnect button when connected", () => {
    renderSettings({
      ...BASE_PROPS,
      gmailStatus: { connected: true, email: "nick@justifylocal.com" },
      isConnectingGmail: false,
      onConnectGmail: vi.fn(),
      onDisconnectGmail: vi.fn(),
    });
    expect(screen.getByLabelText("Gmail connected")).toHaveTextContent("nick@justifylocal.com");
    expect(screen.getByRole("button", { name: "Disconnect Gmail" })).toBeInTheDocument();
  });

  it("calls onConnectGmail when Connect Gmail is clicked", () => {
    const onConnect = vi.fn();
    renderSettings({
      ...BASE_PROPS,
      gmailStatus: { connected: false },
      isConnectingGmail: false,
      onConnectGmail: onConnect,
      onDisconnectGmail: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("calls onDisconnectGmail when Disconnect is clicked", () => {
    const onDisconnect = vi.fn();
    renderSettings({
      ...BASE_PROPS,
      gmailStatus: { connected: true, email: "nick@justifylocal.com" },
      isConnectingGmail: false,
      onConnectGmail: vi.fn(),
      onDisconnectGmail: onDisconnect,
    });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Gmail" }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("renders Gmail panel while status is still loading (null)", () => {
    renderSettings({
      ...BASE_PROPS,
      gmailStatus: null,
      isConnectingGmail: false,
      onConnectGmail: vi.fn(),
      onDisconnectGmail: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeInTheDocument();
  });
});
