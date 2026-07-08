type VisMode = "core" | "radar" | "signal";

type Props = {
  visMode: VisMode;
  setVisMode: (m: VisMode) => void;
};

export const JarvisVisualizer = ({ visMode, setVisMode }: Props) => (
  <>
    <div className="nc-hq-variant-ctrl">
      <span className="nc-hq-variant-label">CONSCIOUSNESS_CORE</span>
      <div className="nc-hq-variant-tabs">
        {(["core", "radar", "signal"] as const).map((m) => (
          <button
            key={m}
            className="nc-hq-variant-tab"
            data-active={visMode === m ? "true" : "false"}
            onClick={() => setVisMode(m)}
            type="button"
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>
    </div>

    <div className="nc-hq-visualizer">
      {visMode === "core" && (
        <div className="nc-core">
          <div className="nc-core-ring" aria-hidden="true" />
          <div className="nc-core-ring nc-core-ring--mid" aria-hidden="true" />
          <div className="nc-core-ring nc-core-ring--inner" aria-hidden="true" />
          <div className="nc-core-orb">
            <div className="nc-core-center-dot" aria-hidden="true" />
          </div>
        </div>
      )}
      {visMode === "radar" && (
        <div className="nc-radar">
          <div className="nc-radar-ring nc-radar-ring--25" aria-hidden="true" />
          <div className="nc-radar-ring nc-radar-ring--12" aria-hidden="true" />
          <div className="nc-radar-line-h" aria-hidden="true" />
          <div className="nc-radar-line-v" aria-hidden="true" />
          <div className="nc-radar-sweep" aria-hidden="true" />
          <div
            className="nc-radar-blip"
            aria-hidden="true"
            style={{
              left: "64%",
              top: "38%",
              width: 9,
              height: 9,
              background: "var(--gold)",
              boxShadow: "0 0 14px var(--gold)",
            }}
          />
          <div
            className="nc-radar-blip"
            aria-hidden="true"
            style={{
              left: "42%",
              top: "60%",
              width: 9,
              height: 9,
              background: "var(--nc-warn, #f5e600)",
              boxShadow: "0 0 14px var(--nc-warn,#f5e600)",
            }}
          />
          <div
            className="nc-radar-blip"
            aria-hidden="true"
            style={{
              left: "55%",
              top: "72%",
              width: 7,
              height: 7,
              background: "var(--term-red)",
              boxShadow: "0 0 12px var(--term-red)",
            }}
          />
        </div>
      )}
      {visMode === "signal" && (
        <div className="nc-signal">
          {Array.from({ length: 32 }, (_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static animation bars have no other stable key
              key={i}
              className="nc-signal-bar"
              aria-hidden="true"
              style={{
                height: "60%",
                animationDelay: `${(i * 0.08).toFixed(2)}s`,
                animationDuration: `${(0.6 + (i % 5) * 0.15).toFixed(2)}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  </>
);
