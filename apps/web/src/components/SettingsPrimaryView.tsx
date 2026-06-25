import { useState } from "react";

import type { GmailStatus } from "../app/hooks/useGmailStatus";
import {
  TERMINAL_COMPLETION_SOUND_OPTIONS,
  type TerminalCompletionSoundId,
} from "../app/notificationSounds";
import {
  appendAuthTokenParam,
  clearStoredAuthToken,
  getStoredAuthToken,
} from "../runtime/apiClient";
import { buildSettingsExportUrl } from "../runtime/runtimeEndpoints";
import { JarvisConfigSection } from "./JarvisConfigSection";
import { MorningBriefPanel } from "./MorningBriefPanel";
import { ActionButton } from "./ui/ActionButton";
import { SettingsToggle } from "./ui/SettingsToggle";

type SettingsPrimaryViewProps = {
  terminalCompletionSound: TerminalCompletionSoundId;
  isRuntimeStatusStripVisible: boolean;
  isMonitorVisible: boolean;
  onTerminalCompletionSoundChange: (soundId: TerminalCompletionSoundId) => void;
  onPreviewTerminalCompletionSound: (soundId: TerminalCompletionSoundId) => void;
  onRuntimeStatusStripVisibilityChange: (visible: boolean) => void;
  onMonitorVisibilityChange: (visible: boolean) => void;
  gmailStatus: GmailStatus | null;
  isConnectingGmail: boolean;
  onConnectGmail: () => void;
  onDisconnectGmail: () => void;
};

type SettingsSection =
  | "audio"
  | "surfaces"
  | "integrations"
  | "brain"
  | "remote"
  | "backup"
  | "interface";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: string }> = [
  { id: "audio", label: "Audio", icon: "♪" },
  { id: "surfaces", label: "Surfaces", icon: "⊞" },
  { id: "integrations", label: "Integrations", icon: "⟳" },
  { id: "brain", label: "Brain", icon: "◎" },
  { id: "remote", label: "Remote", icon: "☁" },
  { id: "backup", label: "Backup", icon: "▲" },
  { id: "interface", label: "Interface", icon: "◈" },
];

export const SettingsPrimaryView = ({
  terminalCompletionSound,
  isRuntimeStatusStripVisible,
  isMonitorVisible,
  onTerminalCompletionSoundChange,
  onPreviewTerminalCompletionSound,
  onRuntimeStatusStripVisibilityChange,
  onMonitorVisibilityChange,
  gmailStatus,
  isConnectingGmail,
  onConnectGmail,
  onDisconnectGmail,
}: SettingsPrimaryViewProps) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>("audio");

  return (
    <section className="settings-view" aria-label="Settings primary view">
      <nav className="settings-sidebar" aria-label="Settings navigation">
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="settings-nav-item"
            data-active={activeSection === s.id ? "true" : "false"}
            aria-current={activeSection === s.id ? "page" : undefined}
            onClick={() => setActiveSection(s.id)}
          >
            <span className="settings-nav-icon" aria-hidden="true">
              {s.icon}
            </span>
            {s.label}
          </button>
        ))}
        <div className="settings-sidebar-spacer" />
        <div className="settings-sidebar-ver">
          Jarvis v5.0 · ULTRA
          <br />
          <span className="settings-sidebar-build">build e57a06c</span>
        </div>
      </nav>

      <div className="settings-main">
        {activeSection === "audio" && (
          <section className="settings-panel" aria-label="Completion notification settings">
            <header className="settings-panel-header">
              <h2>Agent completion sound</h2>
              <p>Play a notification when an agent moves from processing to idle.</p>
            </header>
            <div className="settings-sound-picker">
              {TERMINAL_COMPLETION_SOUND_OPTIONS.map((option) => (
                <button
                  aria-pressed={terminalCompletionSound === option.id}
                  className="settings-sound-option"
                  data-active={terminalCompletionSound === option.id ? "true" : "false"}
                  key={option.id}
                  onClick={() => {
                    onTerminalCompletionSoundChange(option.id);
                    onPreviewTerminalCompletionSound(option.id);
                  }}
                  type="button"
                >
                  <span className="settings-sound-option-label">{option.label}</span>
                  <span className="settings-sound-option-description">{option.description}</span>
                </button>
              ))}
            </div>
            <div className="settings-panel-actions">
              <ActionButton
                aria-label="Preview selected completion sound"
                className="settings-sound-preview"
                onClick={() => {
                  onPreviewTerminalCompletionSound(terminalCompletionSound);
                }}
                size="dense"
                variant="accent"
              >
                Preview
              </ActionButton>
              <span className="settings-saved-pill">Saved to workspace</span>
            </div>
          </section>
        )}

        {activeSection === "surfaces" && (
          <section className="settings-panel" aria-label="Workspace surface visibility settings">
            <header className="settings-panel-header">
              <h2>Workspace surface visibility</h2>
              <p>Enable or disable monitor surfaces in the main workspace shell.</p>
            </header>
            <div className="settings-toggle-grid">
              <SettingsToggle
                label="X Monitor"
                description="Auto-fetch X feed and show monitor tab"
                ariaLabel="Enable X Monitor"
                checked={isMonitorVisible}
                onChange={onMonitorVisibilityChange}
              />
              <SettingsToggle
                label="Runtime status strip"
                description="Top console status strip metrics"
                ariaLabel="Show runtime status strip"
                checked={isRuntimeStatusStripVisible}
                onChange={onRuntimeStatusStripVisibilityChange}
              />
            </div>
          </section>
        )}

        {activeSection === "integrations" && (
          <section className="settings-panel" aria-label="Gmail connection settings">
            <header className="settings-panel-header">
              <h2>Gmail</h2>
              <p>
                Connect your Gmail account so email skills can read and send on your behalf.
                Requires <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> in{" "}
                <code>.env</code> — see <code>.env.example</code> for setup.
              </p>
            </header>
            <div className="settings-panel-actions">
              {gmailStatus?.connected ? (
                <>
                  <span className="settings-gmail-connected-pill" aria-label="Gmail connected">
                    ✓ {gmailStatus.email}
                  </span>
                  <ActionButton
                    size="dense"
                    variant="danger"
                    aria-label="Disconnect Gmail"
                    onClick={onDisconnectGmail}
                  >
                    Disconnect
                  </ActionButton>
                </>
              ) : (
                <ActionButton
                  size="dense"
                  variant="accent"
                  aria-label="Connect Gmail"
                  onClick={onConnectGmail}
                  disabled={isConnectingGmail}
                >
                  {isConnectingGmail ? "Connecting…" : "Connect Gmail"}
                </ActionButton>
              )}
            </div>
          </section>
        )}

        {activeSection === "brain" && <MorningBriefPanel />}

        {activeSection === "remote" && (
          <section className="settings-panel" aria-label="Remote access authentication settings">
            <header className="settings-panel-header">
              <h2>Remote access</h2>
              <p>
                API authentication is controlled by <code>OCTOGENT_AUTH_TOKEN</code> in{" "}
                <code>.env</code> on the host machine — see <code>docs/remote-access.md</code> for
                exposing Jarvis outside your network.
              </p>
            </header>
            <div className="settings-panel-actions">
              {getStoredAuthToken() ? (
                <>
                  <span
                    className="settings-saved-pill"
                    aria-label="Access token saved on this device"
                  >
                    ✓ Access token saved on this device
                  </span>
                  <ActionButton
                    size="dense"
                    variant="danger"
                    aria-label="Forget access token on this device"
                    onClick={() => {
                      clearStoredAuthToken();
                      window.location.reload();
                    }}
                  >
                    Forget token
                  </ActionButton>
                </>
              ) : (
                <span className="settings-saved-pill" aria-label="No access token saved">
                  No token saved — the server did not require one when this page loaded
                </span>
              )}
            </div>
          </section>
        )}

        {activeSection === "backup" && (
          <section className="settings-panel" aria-label="Backup and export settings">
            <header className="settings-panel-header">
              <h2>Backup &amp; export</h2>
              <p>Download a snapshot of your workspace settings, terminals, and UI preferences.</p>
            </header>
            <div className="settings-panel-actions">
              <a
                href={appendAuthTokenParam(buildSettingsExportUrl())}
                download="octogent-settings.json"
                className="settings-export-link"
              >
                <ActionButton size="dense" variant="accent" aria-label="Download settings backup">
                  Download backup
                </ActionButton>
              </a>
            </div>
          </section>
        )}

        {activeSection === "interface" && <JarvisConfigSection />}
      </div>
    </section>
  );
};
