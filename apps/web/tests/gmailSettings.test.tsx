import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsPrimaryView } from "../src/components/SettingsPrimaryView";

const BASE_PROPS = {
  terminalCompletionSound: "silent" as const,
  isRuntimeStatusStripVisible: true,
  isMonitorVisible: false,
  onTerminalCompletionSoundChange: vi.fn(),
  onPreviewTerminalCompletionSound: vi.fn(),
  onRuntimeStatusStripVisibilityChange: vi.fn(),
  onMonitorVisibilityChange: vi.fn(),
};

describe("SettingsPrimaryView — Gmail panel", () => {
  it("renders Connect Gmail button when not connected", () => {
    render(
      <SettingsPrimaryView
        {...BASE_PROPS}
        gmailStatus={{ connected: false }}
        isConnectingGmail={false}
        onConnectGmail={vi.fn()}
        onDisconnectGmail={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeInTheDocument();
  });

  it("shows Connecting… label and disables button while connecting", () => {
    render(
      <SettingsPrimaryView
        {...BASE_PROPS}
        gmailStatus={{ connected: false }}
        isConnectingGmail={true}
        onConnectGmail={vi.fn()}
        onDisconnectGmail={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "Connect Gmail" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Connecting…");
  });

  it("shows connected email and Disconnect button when connected", () => {
    render(
      <SettingsPrimaryView
        {...BASE_PROPS}
        gmailStatus={{ connected: true, email: "nick@justifylocal.com" }}
        isConnectingGmail={false}
        onConnectGmail={vi.fn()}
        onDisconnectGmail={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Gmail connected")).toHaveTextContent("nick@justifylocal.com");
    expect(screen.getByRole("button", { name: "Disconnect Gmail" })).toBeInTheDocument();
  });

  it("calls onConnectGmail when Connect Gmail is clicked", () => {
    const onConnect = vi.fn();
    render(
      <SettingsPrimaryView
        {...BASE_PROPS}
        gmailStatus={{ connected: false }}
        isConnectingGmail={false}
        onConnectGmail={onConnect}
        onDisconnectGmail={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("calls onDisconnectGmail when Disconnect is clicked", () => {
    const onDisconnect = vi.fn();
    render(
      <SettingsPrimaryView
        {...BASE_PROPS}
        gmailStatus={{ connected: true, email: "nick@justifylocal.com" }}
        isConnectingGmail={false}
        onConnectGmail={vi.fn()}
        onDisconnectGmail={onDisconnect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Gmail" }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("renders Gmail panel while status is still loading (null)", () => {
    render(
      <SettingsPrimaryView
        {...BASE_PROPS}
        gmailStatus={null}
        isConnectingGmail={false}
        onConnectGmail={vi.fn()}
        onDisconnectGmail={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeInTheDocument();
  });
});
