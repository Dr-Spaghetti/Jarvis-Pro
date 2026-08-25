import { useEffect, useRef } from "react";

type VisMode = "core" | "radar" | "signal";

type Props = {
  visMode: VisMode;
  setVisMode: (m: VisMode) => void;
};

const SIZE = 620;
const CX = SIZE / 2;
const CY = SIZE / 2;
const TWO_PI = Math.PI * 2;

const RINGS = [
  {
    r: 78,
    speed: 0.28,
    dir: 1,
    lineW: 0.8,
    alpha: 0.55,
    arcs: 0,
    dash: [4, 6] as [number, number],
  },
  {
    r: 130,
    speed: 0.19,
    dir: -1,
    lineW: 0.6,
    alpha: 0.4,
    arcs: 0,
    dash: [2, 8] as [number, number],
  },
  { r: 186, speed: 0.15, dir: 1, lineW: 1.2, alpha: 0.7, arcs: 4, dash: null },
  {
    r: 244,
    speed: 0.09,
    dir: -1,
    lineW: 0.7,
    alpha: 0.35,
    arcs: 0,
    dash: [3, 10] as [number, number],
  },
  { r: 302, speed: 0.055, dir: 1, lineW: 1.5, alpha: 0.75, arcs: 8, dash: null },
] as const;

const ORBITAL_LABELS = [
  { label: "ASK", value: "READY" },
  { label: "VOICE", value: "MIC" },
  { label: "VAULT", value: "LOCAL" },
  { label: "AGENTS", value: "PTY" },
];

const TICK_RADIUS = 318;
const TICK_COUNT = 24;

export const JarvisVisualizer = ({ visMode, setVisMode }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (visMode !== "core") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    let animId: number;
    let t = 0;
    let lastTime: number | null = null;

    const green = (alpha: number) => `rgba(57,255,20,${alpha.toFixed(3)})`;
    const teal = (alpha: number) => `rgba(0,212,255,${alpha.toFixed(3)})`;

    const drawRing = (
      r: number,
      angle: number,
      lineW: number,
      alpha: number,
      arcs: number,
      dash: readonly [number, number] | null,
    ) => {
      ctx.lineWidth = lineW;
      ctx.strokeStyle = green(alpha);

      if (arcs === 0) {
        // Full circle with optional dash
        ctx.beginPath();
        if (dash) {
          ctx.setLineDash([dash[0], dash[1]]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.arc(CX, CY, r, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Arc segments — evenly spaced with equal-sized gaps
        const arcSpan = (TWO_PI / arcs) * 0.6;
        const gapSpan = (TWO_PI / arcs) * 0.4;
        ctx.setLineDash([]);
        for (let i = 0; i < arcs; i++) {
          const start = angle + i * (arcSpan + gapSpan);
          ctx.beginPath();
          ctx.arc(CX, CY, r, start, start + arcSpan);
          ctx.stroke();
          // Arc end tick marks
          const endX = CX + r * Math.cos(start + arcSpan);
          const endY = CY + r * Math.sin(start + arcSpan);
          ctx.beginPath();
          ctx.arc(endX, endY, 2.5, 0, TWO_PI);
          ctx.fillStyle = green(alpha * 1.4);
          ctx.fill();
        }
      }
    };

    const drawTicks = (angle: number) => {
      ctx.lineWidth = 0.8;
      for (let i = 0; i < TICK_COUNT; i++) {
        const a = angle + (i * TWO_PI) / TICK_COUNT;
        const isMajor = i % 6 === 0;
        const innerR = isMajor ? TICK_RADIUS - 7 : TICK_RADIUS - 4;
        const outerR = TICK_RADIUS + (isMajor ? 5 : 3);
        ctx.beginPath();
        ctx.moveTo(CX + innerR * Math.cos(a), CY + innerR * Math.sin(a));
        ctx.lineTo(CX + outerR * Math.cos(a), CY + outerR * Math.sin(a));
        ctx.strokeStyle = isMajor ? green(0.55) : green(0.2);
        ctx.stroke();
      }
    };

    const drawOrbitalLabels = (outerAngle: number) => {
      const labelR = 310;
      ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ORBITAL_LABELS.forEach((item, i) => {
        const a = outerAngle + (i * TWO_PI) / 4;
        const lx = CX + labelR * Math.cos(a);
        const ly = CY + labelR * Math.sin(a);

        ctx.save();
        ctx.translate(lx, ly);

        // Label
        ctx.fillStyle = green(0.42);
        ctx.fillText(item.label, 0, -8);
        // Value
        ctx.fillStyle = green(0.85);
        ctx.shadowColor = "rgba(57,255,20,0.5)";
        ctx.shadowBlur = 6;
        ctx.fillText(item.value, 0, 5);
        ctx.shadowBlur = 0;

        ctx.restore();
      });
    };

    const drawCenterOrb = () => {
      const orbR = 52;
      // Outer glow ring
      const glowGrad = ctx.createRadialGradient(CX, CY, orbR * 0.6, CX, CY, orbR * 1.8);
      glowGrad.addColorStop(0, "rgba(57,255,20,0.14)");
      glowGrad.addColorStop(1, "rgba(57,255,20,0)");
      ctx.beginPath();
      ctx.arc(CX, CY, orbR * 1.8, 0, TWO_PI);
      ctx.fillStyle = glowGrad;
      ctx.fill();

      // Orb body
      const orbGrad = ctx.createRadialGradient(CX - 8, CY - 10, 0, CX, CY, orbR);
      orbGrad.addColorStop(0.0, "rgba(255,255,255,0.95)");
      orbGrad.addColorStop(0.18, "rgba(200,255,120,0.9)");
      orbGrad.addColorStop(0.42, "rgba(57,255,20,0.75)");
      orbGrad.addColorStop(0.75, "rgba(10,30,5,0.85)");
      orbGrad.addColorStop(1.0, "rgba(0,0,0,0.95)");
      ctx.beginPath();
      ctx.arc(CX, CY, orbR, 0, TWO_PI);
      ctx.fillStyle = orbGrad;
      ctx.fill();

      // Orb border
      ctx.beginPath();
      ctx.arc(CX, CY, orbR, 0, TWO_PI);
      ctx.strokeStyle = green(0.6);
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Center dot (gold)
      const dotR = 10;
      const dotGrad = ctx.createRadialGradient(CX, CY, 0, CX, CY, dotR);
      dotGrad.addColorStop(0, "rgba(255,235,120,1)");
      dotGrad.addColorStop(0.5, "rgba(245,230,0,0.9)");
      dotGrad.addColorStop(1, "rgba(200,170,0,0)");
      ctx.beginPath();
      ctx.arc(CX, CY, dotR, 0, TWO_PI);
      ctx.fillStyle = dotGrad;
      ctx.fill();

      // Hex-like inner grid pattern on orb surface
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, orbR - 2, 0, TWO_PI);
      ctx.clip();
      ctx.strokeStyle = "rgba(57,255,20,0.06)";
      ctx.lineWidth = 0.4;
      for (let gx = CX - orbR; gx <= CX + orbR; gx += 8) {
        ctx.beginPath();
        ctx.moveTo(gx, CY - orbR);
        ctx.lineTo(gx, CY + orbR);
        ctx.stroke();
      }
      for (let gy = CY - orbR; gy <= CY + orbR; gy += 8) {
        ctx.beginPath();
        ctx.moveTo(CX - orbR, gy);
        ctx.lineTo(CX + orbR, gy);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawCrossHair = () => {
      const len = 22;
      ctx.strokeStyle = teal(0.28);
      ctx.lineWidth = 0.6;
      ctx.setLineDash([2, 3]);
      // Horizontal
      ctx.beginPath();
      ctx.moveTo(CX - RINGS[0].r - len, CY);
      ctx.lineTo(CX + RINGS[0].r + len, CY);
      ctx.stroke();
      // Vertical
      ctx.beginPath();
      ctx.moveTo(CX, CY - RINGS[0].r - len);
      ctx.lineTo(CX, CY + RINGS[0].r + len);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const frame = (ts: number) => {
      const dt = lastTime === null ? 0 : Math.min((ts - lastTime) / 1000, 0.05);
      lastTime = ts;
      t += dt;

      ctx.clearRect(0, 0, SIZE, SIZE);

      // Draw rings
      for (const ring of RINGS) {
        const angle = t * ring.speed * ring.dir;
        drawRing(ring.r, angle, ring.lineW, ring.alpha, ring.arcs, ring.dash);
      }

      // Outer tick marks (rotate with outer ring)
      drawTicks(t * RINGS[4].speed * RINGS[4].dir);

      // Orbital data labels (rotate with outer ring)
      drawOrbitalLabels(t * RINGS[4].speed * RINGS[4].dir);

      // Crosshair
      drawCrossHair();

      // Center orb
      drawCenterOrb();

      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  }, [visMode]);

  return (
    <>
      <div className="nc-hq-variant-ctrl">
        <span className="nc-hq-variant-label">Core</span>
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
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            style={{ width: SIZE, height: SIZE, display: "block", flexShrink: 0 }}
            aria-label="Jarvis consciousness core visualizer"
          />
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
};
