import { useEffect, useState } from "react";

import { PRIMARY_NAV_ITEMS, type PrimaryNavIndex } from "../app/constants";

const RECENT_CONVOS_INDEX: PrimaryNavIndex = 4;

type ConsolePrimaryNavProps = {
  activePrimaryNav: PrimaryNavIndex;
  onPrimaryNavChange: (index: PrimaryNavIndex) => void;
  unreadNotificationCount: number;
  onBellClick: () => void;
};

export const ConsolePrimaryNav = ({
  activePrimaryNav,
  onPrimaryNavChange,
  unreadNotificationCount,
  onBellClick,
}: ConsolePrimaryNavProps) => {
  const [hasNewTurn, setHasNewTurn] = useState(false);

  // Show a badge on Recent Convos when Jarvis HQ saves a new turn while on another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jarvis.lastTurnAt" && activePrimaryNav !== RECENT_CONVOS_INDEX) {
        setHasNewTurn(true);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activePrimaryNav]);

  // Clear the badge when the user opens Recent Convos.
  useEffect(() => {
    if (activePrimaryNav === RECENT_CONVOS_INDEX) setHasNewTurn(false);
  }, [activePrimaryNav]);

  return (
    <nav className="console-primary-nav" aria-label="Primary navigation">
      <div className="console-primary-nav-brand">
        <div className="console-primary-nav-wordmark">
          JARVIS
          <br />
          HQ
        </div>
        <div className="console-primary-nav-version">V 5.0 · ULTRA</div>
      </div>
      <div className="console-primary-nav-tabs">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <button
            aria-current={item.index === activePrimaryNav ? "page" : undefined}
            aria-label={`${item.label} (${item.index})`}
            className="console-primary-nav-tab"
            data-active={item.index === activePrimaryNav ? "true" : "false"}
            key={item.index}
            onClick={() => {
              onPrimaryNavChange(item.index);
            }}
            title={`${item.label} — press ${item.index}`}
            type="button"
          >
            <span className="console-primary-nav-tab-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="console-primary-nav-tab-label">{item.label}</span>
            {item.index === RECENT_CONVOS_INDEX && hasNewTurn && (
              <span className="console-primary-nav-badge" aria-label="New conversation" />
            )}
          </button>
        ))}
      </div>
      <div className="console-primary-nav-bottom">
        <button
          type="button"
          className="console-primary-nav-bell"
          onClick={onBellClick}
          aria-label={`Notifications${unreadNotificationCount > 0 ? ` (${unreadNotificationCount} unread)` : ""}`}
          title="Notifications"
        >
          <span className="console-primary-nav-bell-icon" aria-hidden="true">
            ◉
          </span>
          <span className="console-primary-nav-bell-label">NOTIFICATIONS</span>
          {unreadNotificationCount > 0 && (
            <span className="console-primary-nav-bell-badge" aria-hidden="true">
              {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
            </span>
          )}
        </button>
        <button
          className="console-primary-nav-initiate"
          onClick={() => onPrimaryNavChange(9)}
          type="button"
        >
          <span className="console-primary-nav-initiate-dot" aria-hidden="true" />
          INITIATE PROTOCOL
        </button>
      </div>
    </nav>
  );
};
