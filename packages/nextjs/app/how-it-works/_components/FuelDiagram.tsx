"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

/**
 * The gap that kills vaults, drawn to scale.
 *
 * A scheduled call is paid for by the contract, and the network tests that
 * contract against the *whole gas allowance* before it will run — then charges
 * it only for the gas actually burned. Those two numbers differ by a factor of
 * two, so a vault refuses to run while still holding more than a run costs.
 *
 * Every word of that sentence is true and none of it is intuitive, which is
 * exactly the kind of thing a picture fixes. The three bars are to scale
 * against each other, and the dashed line at 3.27 is the bar the balance has to
 * clear. The vault below it died with 2.76 ℏ in it — visibly above the charge
 * and visibly below the line.
 *
 * All three figures were measured on testnet. They are not estimates.
 */

const W = 1200;
const H = 300;
const LEFT = 210;
const RIGHT = 60;
const TRACK = W - LEFT - RIGHT;

/** ℏ per unit of width, fixed so the three bars are comparable by eye. */
const MAX = 3.6;
const scale = (hbar: number) => (hbar / MAX) * TRACK;

const BARS = [
  {
    label: "Reserved per run",
    sub: "3,000,000 gas × 109 tinybar",
    value: 3.27,
    tone: "signal" as const,
  },
  {
    label: "Actually charged",
    sub: "about 1.5M gas burned",
    value: 1.63,
    tone: "paper" as const,
  },
  {
    label: "Died holding",
    sub: "vault 0.0.10684549, after 13 runs",
    value: 2.76,
    tone: "dead" as const,
  },
];

const ROW_Y = [78, 150, 222];

export const FuelDiagram = () => {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const still = useReducedMotion();

  // Rests drawn. The observer only decides whether the bars *arrive* or are
  // simply there, never whether they exist.
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    if (still) return setGrown(true);
    if (inView) setGrown(true);
    // If the observer never fires — a short viewport, a print, a screenshot —
    // draw them anyway rather than leave the figure empty.
    const fallback = setTimeout(() => setGrown(true), 1000);
    return () => clearTimeout(fallback);
  }, [inView, still]);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="A run reserves 3.27 HBAR but is charged 1.63. A vault holding 2.76 — more than a run costs — was refused, because it could not cover the reservation."
    >
      <defs>
        <filter id="fuel-glow" x="-10%" y="-80%" width="120%" height="260%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* The bar every balance is tested against. Everything else is measured
          against this line, so it is drawn first and it is the only dashed
          thing on the figure. */}
      <line
        x1={LEFT + scale(3.27)}
        x2={LEFT + scale(3.27)}
        y1={44}
        y2={H - 34}
        stroke="var(--color-signal)"
        strokeWidth="1.5"
        strokeDasharray="3 5"
        opacity="0.8"
      />
      {/* End-anchored, to the left of the line. Anchored the other way it runs
          off the viewBox, and there is no bar at this height to collide with. */}
      <text
        x={LEFT + scale(3.27) - 12}
        y={30}
        textAnchor="end"
        fontFamily="var(--font-mono)"
        fontSize="10.5"
        letterSpacing="0.16em"
        fill="var(--color-signal)"
      >
        THE BALANCE MUST CLEAR THIS
      </text>

      {BARS.map((bar, i) => {
        const y = ROW_Y[i];
        const colour =
          bar.tone === "signal"
            ? "var(--color-signal)"
            : bar.tone === "dead"
              ? "var(--color-signal-dead)"
              : "var(--color-paper-dim)";

        return (
          <g key={bar.label}>
            <text
              x={LEFT - 22}
              y={y - 2}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fontSize="10.5"
              letterSpacing="0.16em"
              fill="var(--color-paper-faint)"
            >
              {bar.label.toUpperCase()}
            </text>
            <text
              x={LEFT - 22}
              y={y + 16}
              textAnchor="end"
              fontFamily="var(--font-sans)"
              fontSize="12"
              fill="var(--color-paper-faint)"
            >
              {bar.sub}
            </text>

            {/* The track the bar runs in, so an empty bar still reads as a
                measurement rather than as a missing one. */}
            <rect x={LEFT} y={y - 14} width={TRACK} height="28" fill="var(--color-ink-sunken)" />

            {bar.tone === "signal" && grown ? (
              <rect
                x={LEFT}
                y={y - 14}
                width={scale(bar.value)}
                height="28"
                fill={colour}
                opacity="0.35"
                filter="url(#fuel-glow)"
              />
            ) : null}

            <rect
              x={LEFT}
              y={y - 14}
              width={grown ? scale(bar.value) : 0}
              height="28"
              fill={colour}
              opacity={bar.tone === "paper" ? 0.55 : 0.9}
              style={{ transition: `width 1.1s cubic-bezier(0.16, 1, 0.3, 1) ${0.1 + i * 0.14}s` }}
            />

            <text
              x={bar.value > 3 ? LEFT + scale(bar.value) - 14 : LEFT + scale(bar.value) + 14}
              textAnchor={bar.value > 3 ? "end" : "start"}
              y={y + 6}
              fontFamily="var(--font-mono)"
              fontSize="16"
              fill={bar.value > 3 ? "var(--color-ink)" : colour}
              opacity={grown ? 1 : 0}
              style={{ transition: `opacity 0.5s ease ${0.6 + i * 0.14}s` }}
            >
              {bar.value.toFixed(2)} ℏ
            </text>
          </g>
        );
      })}
    </svg>
  );
};
