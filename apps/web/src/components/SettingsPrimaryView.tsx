import type { GmailStatus } from "../app/hooks/useGmailStatus";
import {
  TERMINAL_COMPLETION_SOUND_OPTIONS,
  type TerminalCompletionSoundId,
} from "../app/notificationSounds";
import { buildSettingsExportUrl } from "../runtime/runtimeEndpoints";
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
}: SettingsPrimaryViewProps) => (
  <section className="settings-view" aria-label="Settings primary view">
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
    <section className="settings-panel" aria-label="Gmail connection settings">
      <header className="settings-panel-header">
        <h2>Gmail</h2>
        <p>
          Connect your Gmail account so email skills can read and send on your behalf. Requires{" "}
          <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> in <code>.env</code> —
          see <code>.env.example</code> for setup.
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
    <section className="settings-panel" aria-label="Backup and export settings">
      <header className="settings-panel-header">
        <h2>Backup &amp; export</h2>
        <p>Download a snapshot of your workspace settings, terminals, and UI preferences.</p>
      </header>
      <div className="settings-panel-actions">
        <a
          href={buildSettingsExportUrl()}
          download="octogent-settings.json"
          className="settings-export-link"
        >
          <ActionButton size="dense" variant="accent" aria-label="Download settings backup">
            Download backup
          </ActionButton>
        </a>
      </div>
    </section>
  </section>
);
