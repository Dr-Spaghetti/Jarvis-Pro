import { useEffect, useRef } from "react";

import { PRIMARY_NAV_ITEMS } from "../../app/constants";

type ShortcutsOverlayProps = {
  onClose: () => void;
};

export const ShortcutsOverlay = ({ onClose }: ShortcutsOverlayProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is supplementary; Escape and the close button cover keyboard users
    <div
      className="shortcuts-overlay-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        ref={dialogRef}
        open
        className="shortcuts-overlay"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          // Keep keyboard focus inside the overlay while it is open. The static
          // `open` attribute (used instead of showModal() for jsdom parity)
          // does not trap focus natively, so aria-modal needs this to be true.
          if (event.key === "Tab") {
            const dialog = dialogRef.current;
            if (!dialog) return;
            const focusable = dialog.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) return;
            const first = focusable[0] as HTMLElement;
            const last = focusable[focusable.length - 1] as HTMLElement;
            const active = document.activeElement;
            if (event.shiftKey) {
              if (active === first || active === dialog) {
                event.preventDefault();
                last.focus();
              }
            } else if (active === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="shortcuts-overlay-header">
          <h2 className="shortcuts-overlay-title">Keyboard Shortcuts</h2>
          <button
            type="button"
            className="shortcuts-overlay-close"
            aria-label="Close shortcuts overlay"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <ul className="shortcuts-overlay-list">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <li key={item.index} className="shortcuts-overlay-row">
              <kbd className="shortcuts-overlay-key">{item.index}</kbd>
              <span className="shortcuts-overlay-desc">Go to {item.label}</span>
            </li>
          ))}
          <li className="shortcuts-overlay-row">
            <kbd className="shortcuts-overlay-key">?</kbd>
            <span className="shortcuts-overlay-desc">Toggle this overlay</span>
          </li>
          <li className="shortcuts-overlay-row">
            <kbd className="shortcuts-overlay-key">Esc</kbd>
            <span className="shortcuts-overlay-desc">Close this overlay</span>
          </li>
        </ul>
      </dialog>
    </div>
  );
};
