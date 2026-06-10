import { useEffect } from "react";

import type { PrimaryNavIndex } from "../constants";
import { isEditableEventTarget, isShortcutsOverlayKey, parsePrimaryNavKey } from "../hotkeys";

type UseConsoleKeyboardShortcutsOptions = {
  setActivePrimaryNav: (index: PrimaryNavIndex) => void;
  onToggleShortcutsOverlay?: (() => void) | undefined;
};

export const useConsoleKeyboardShortcuts = ({
  setActivePrimaryNav,
  onToggleShortcutsOverlay,
}: UseConsoleKeyboardShortcutsOptions) => {
  useEffect(() => {
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) {
        return;
      }

      if (onToggleShortcutsOverlay && isShortcutsOverlayKey(event.key)) {
        onToggleShortcutsOverlay();
        event.preventDefault();
        return;
      }

      const nextPrimaryNav = parsePrimaryNavKey(event.key);
      if (nextPrimaryNav !== null) {
        setActivePrimaryNav(nextPrimaryNav);
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [setActivePrimaryNav, onToggleShortcutsOverlay]);
};
