"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The accelerando.
 *
 * This is the whole contribution, drawn. A price descends toward a floor and
 * the scheduled checks bunch up beneath it — six hours apart while nothing is
 * happening, sixty seconds apart when the floor is close.
 *
 * It is worth drawing rather than describing because the alternative is a
 * sentence nobody pictures. Hedera's own `ScheduledVault` takes one fixed
 * interval, so its documented use case — *"as positions approach liquidation
 * thresholds, contracts schedule increasingly frequent monitoring"* — cannot be
 * expressed in it at all. Everything below is `nextInterval()` returning a
 * different number as the distance closes.
 *
 * The geometry is the real `ProtectiveExitStrategy`: the bands are its
 * constants, and the intervals are what it would actually return.
 */

/** The strategy's own bands, as fractions above the floor. */
const BANDS = [
  { from: 1, label: "6 hours", seconds: 21_600, name: "calm" },
  { from: 0.15, label: "1 hour", seconds: 3_600, name: "watchful" },
  { from: 0.05, label: "5 minutes", seconds: 300, name: "close" },
  { from: 0.01, label: "60 seconds", seconds: 60, name: "imminent" },
];

const W = 900;
const H = 300;
const PAD = { top: 52, right: 16, bottom: 52, left: 16 };

/** Price as a fraction above the floor, descending over the width. */
function distanceAt(t: number) {
  // Eased descent: slow at first, then committed. 0.42 -> 0 across the panel.
  return 0.42 * (1 - t ** 1.7);
}

function intervalFor(distance: number) {
  for (const band of BANDS) if (distance >= band.from) return band;
  return BANDS[BANDS.length - 1];
}

/** y for a given distance above the floor. The floor sits near the bottom. */
function yFor(distance: number) {
  const floorY = H - PAD.bottom;
  const top = PAD.top;
  return floorY - (distance / 0.46) * (floorY - top);
}

/**
 * Where the checks land.
 *
 * Walked in time rather than spaced by eye: start at the left, ask the
 * strategy how long to wait, step that far, repeat. The bunching is therefore
 * the arithmetic rather than a drawing of it.
 */
function schedule() {
  const marks: { t: number; band: (typeof BANDS)[number] }[] = [];
  const TOTAL = 26 * 3600; // the window the panel covers, in seconds
  let elapsed = 0;

  for (let i = 0; i < 400 && elapsed < TOTAL; i++) {
    const t = elapsed / TOTAL;
    const band = intervalFor(distanceAt(t));
    marks.push({ t, band });
    // Compressed so a six-hour wait and a sixty-second one both stay visible.
    elapsed += Math.max(band.seconds, TOTAL / 150);
  }
  return marks;
}

export const Cadence = () => {
  /*
    Drawn is the resting state, not the reward for an event.

    This began gated behind an IntersectionObserver so the accelerando would
    play when the reader arrived. It meant the checks and the band labels did
    not exist until the observer fired — and when it did not, the panel showed
    a bare curve with the entire argument missing from it. A diagram has to be
    complete while the page is still; motion is an enhancement on top of that.
  */
  const [animate, setAnimate] = useState(false);
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setAnimate(true);
      return;
    }
    const io = new IntersectionObserver(
      entries =>
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          io.disconnect();
          setAnimate(true);
        }),
      { threshold: 0.2 },
    );
    io.observe(el);
    // If the observer never fires — an odd viewport, a print, a reader landing
    // mid-document — draw it anyway rather than leave it half made.
    const fallback = setTimeout(() => setAnimate(true), 1200);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  const marks = schedule();
  const floorY = H - PAD.bottom;
  const inner = W - PAD.left - PAD.right;
  const x = (t: number) => PAD.left + t * inner;

  const path = Array.from({ length: 120 }, (_, i) => {
    const t = i / 119;
    return `${i === 0 ? "M" : "L"} ${x(t).toFixed(1)} ${yFor(distanceAt(t)).toFixed(1)}`;
  }).join(" ");

  return (
    <figure className="m-0">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto max-w-full"
        role="img"
        aria-label="A price descending toward its floor, with scheduled checks bunching from six hours apart to sixty seconds apart as it approaches."
      >
        {/* Stave lines. The structure a score is written on. */}
        {[0.25, 0.5, 0.75].map(f => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + f * (floorY - PAD.top)}
            y2={PAD.top + f * (floorY - PAD.top)}
            stroke="var(--color-line)"
            strokeWidth="1"
          />
        ))}

        {/* The floor. The only thing on the panel that is not negotiable. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={floorY}
          y2={floorY}
          stroke="var(--color-signal)"
          strokeWidth="1.5"
          strokeDasharray="2 5"
          opacity="0.75"
        />
        <text x={PAD.left} y={floorY + 20} className="fill-signal" fontSize="11" fontFamily="var(--font-mono)">
          FLOOR
        </text>

        {/* The price. */}
        <path
          d={path}
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            strokeDasharray: 2400,
            strokeDashoffset: animate ? 0 : 2400,
            transition: "stroke-dashoffset 2.4s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />

        {/* The checks. Each one is a scheduled execution that did nothing. */}
        <g>
          {marks.map((m, i) => {
            const mx = x(m.t);
            const my = yFor(distanceAt(m.t));
            const urgent = m.band.seconds <= 300;
            return (
              <line
                key={i}
                x1={mx}
                x2={mx}
                y1={my}
                y2={floorY}
                stroke={urgent ? "var(--color-signal)" : "var(--color-line-bright)"}
                strokeWidth="1"
                opacity={animate ? (urgent ? 0.9 : 0.75) : 0}
                style={{ transition: `opacity 0.5s ease ${0.3 + m.t * 2.1}s` }}
              />
            );
          })}
        </g>

        {/*
          Band names, placed where each one begins.

          Staggered onto two rows on purpose: the bands they mark get closer
          together as the price falls — that is the whole point of the drawing —
          so labels set on one line collide exactly where the chart is most
          interesting.
        */}
        {BANDS.map((band, i) => {
          const t = Array.from({ length: 200 }, (_, k) => k / 199).find(v => distanceAt(v) <= band.from) ?? 0;
          if (band.from === 1) return null;
          const row = i % 2 === 0 ? PAD.top - 14 : PAD.top - 32;
          return (
            <g key={band.name} opacity={animate ? 1 : 0} style={{ transition: `opacity 0.6s ease ${0.6 + t * 1.6}s` }}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={row + 4}
                y2={floorY}
                stroke="var(--color-line-bright)"
                strokeWidth="1"
                strokeDasharray="1 4"
              />
              <text
                x={x(t) + (t > 0.86 ? -6 : 6)}
                y={row}
                textAnchor={t > 0.86 ? "end" : "start"}
                className="fill-paper-faint"
                fontSize="10.5"
                fontFamily="var(--font-mono)"
                letterSpacing="0.12em"
              >
                {band.label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {BANDS.map(b => (
          <span key={b.name} className="flex items-baseline gap-2">
            <span className="eyebrow">{b.name}</span>
            <span className="tabular text-paper-dim">every {b.label}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
};
