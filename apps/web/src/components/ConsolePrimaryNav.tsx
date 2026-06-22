import { PRIMARY_NAV_ITEMS, type PrimaryNavIndex } from "../app/constants";

type ConsolePrimaryNavProps = {
  activePrimaryNav: PrimaryNavIndex;
  onPrimaryNavChange: (index: PrimaryNavIndex) => void;
};

export const ConsolePrimaryNav = ({
  activePrimaryNav,
  onPrimaryNavChange,
}: ConsolePrimaryNavProps) => (
  <nav className="console-primary-nav" aria-label="Primary navigation">
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
          <span className="console-primary-nav-tab-icon" aria-hidden="true">{item.icon}</span>
          <span className="console-primary-nav-tab-label">{item.label}</span>
        </button>
      ))}
    </div>
    <p className="console-primary-nav-hint">Press 1–{PRIMARY_NAV_ITEMS.length} to navigate</p>
  </nav>
);
