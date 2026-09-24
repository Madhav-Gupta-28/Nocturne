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
 * constants and the intervals are what it would actually return.
 */

/**
 * The strategy's own bands, as fractions above the floor.
 *
 * `from: 1` means "a hundred per cent above the floor", which is the calm
 * regime. The descent below has to start above that number or the first band
 * is unreachable and the chart quietly contradicts its own caption — which is
 * exactly what it used to do, starting at 0.42 and never once entering calm.
 */
const BANDS = [
  { from: 1, label: "6 hours", seconds: 21_600, name: "calm" },
  { from: 0.15, label: "1 hour", seconds: 3_600, name: "watchful" },
  { from: 0.05, label: "5 minutes", seconds: 300, name: "close" },
  { from: 0.01, label: "60 seconds", seconds: 60, name: "imminent" },
];

const W = 1200;
const H = 412;
// The bottom padding holds the floor chip and nothing else.
const PAD = { top: 74, right: 26, bottom: 66, left: 26 };

/** The top of the plot, as a fraction above the floor. */
const CEILING = 1.75;

/** The window the panel covers, in seconds. */
const TOTAL = 48 * 3600;

/**
 * Price as a fraction above the floor, descending over the width.
 *
 * The exponent does two jobs at once and both matter. It decides how much
 * horizontal room each regime gets — at 1.6 calm runs to a third of the way
 * across, watchful to four fifths, and the last two share the remainder — and
 * it decides how long the line keeps a visible slope. Steeper than this and the
 * price lands on the floor two thirds of the way along and crawls, which reads
 * as a chart that has finished rather than a price still falling.
 */
const FALL = 1.6;
const distanceAt = (t: number) => CEILING * (1 - t) ** FALL;

const intervalFor = (distance: number) => BANDS.find(b => distance >= b.from) ?? BANDS[BANDS.length - 1];

/** The first t at which a band becomes current. Inverts the curve above. */
const startOf = (band: (typeof BANDS)[number]) => {
  if (band.from >= CEILING) return 0;
  return Math.max(0, 1 - (band.from / CEILING) ** (1 / FALL));
};

const floorY = H - PAD.bottom;
const inner = W - PAD.left - PAD.right;
const x = (t: number) => PAD.left + t * inner;
const yFor = (distance: number) => floorY - (distance / CEILING) * (floorY - PAD.top);

/**
 * Where the checks land.
 *
 * Walked in time rather than spaced by eye: start at the left, ask the strategy
 * how long to wait, step that far, repeat. The bunching is therefore the
 * arithmetic rather than a drawing of it.
 */
function schedule() {
  const marks: { t: number; band: (typeof BANDS)[number] }[] = [];
  let elapsed = 0;

  for (let i = 0; i < 400 && elapsed < TOTAL; i++) {
    const t = elapsed / TOTAL;
    const band = intervalFor(distanceAt(t));
    marks.push({ t, band });
    // Floored so a sixty-second interval does not render as a solid block of
    // ink. The point is that the checks bunch, not that they merge.
    elapsed += Math.max(band.seconds, TOTAL / 120);
  }
  return marks;
}

const MARKS = schedule();

const PATH = Array.from({ length: 160 }, (_, i) => {
  const t = i / 159;
  return `${i === 0 ? "M" : "L"} ${x(t).toFixed(1)} ${yFor(distanceAt(t)).toFixed(1)}`;
}).join(" ");

/** The same line, closed along the floor, for the area wash underneath it. */
const AREA = `${PATH} L ${x(1).toFixed(1)} ${floorY} L ${x(0).toFixed(1)} ${floorY} Z`;

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

  return (
    <figure className="lift m-0 overflow-hidden border border-line bg-ink-raised/40 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <span className="eyebrow">Price vs. floor · 48 hours · one tick per scheduled check</span>
        <span className="eyebrow text-signal">nextInterval()</span>
      </div>

      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-full"
        role="img"
        aria-label="A price descending toward its floor, with scheduled checks bunching from six hours apart to sixty seconds apart as it approaches."
      >
        <defs>
          {/*
            The wash under the price. It carries no data the line does not
            already carry — its job is to give the curve a body, so the chart
            reads as a falling quantity rather than as a stray stroke.
          */}
          <linearGradient id="cadence-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-signal)" stopOpacity="0.22" />
            <stop offset="55%" stopColor="var(--color-signal)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--color-signal)" stopOpacity="0" />
          </linearGradient>

          {/* The line cools as it falls: paper while there is room, signal at the floor. */}
          <linearGradient id="cadence-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-paper)" />
            <stop offset="62%" stopColor="var(--color-paper)" />
            <stop offset="100%" stopColor="var(--color-signal)" />
          </linearGradient>

          {/* A real bloom rather than a fake one: blur a copy and lay the sharp line over it. */}
          <filter id="cadence-glow" x="-20%" y="-60%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="tick-glow" x="-200%" y="-50%" width="500%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        {/*
          The four regimes, as columns.

          Each one is tinted a little more than the one before, so the change of
          state is visible as a change of ground rather than only as a change in
          tick spacing. This is the fact the chart exists to carry.
        */}
        {BANDS.map((band, i) => {
          const from = startOf(band);
          const to = i + 1 < BANDS.length ? startOf(BANDS[i + 1]) : 1;
          return (
            <rect
              key={`band-${band.name}`}
              x={x(from)}
              y={PAD.top - 26}
              width={Math.max(0, x(to) - x(from))}
              height={floorY - PAD.top + 26}
              fill="var(--color-signal)"
              opacity={animate ? 0.015 + i * 0.022 : 0}
              style={{ transition: `opacity 0.9s ease ${0.2 + i * 0.16}s` }}
            />
          );
        })}

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

        {/* The checks. Each one is a scheduled execution that did nothing. */}
        <g>
          {MARKS.map((m, i) => {
            const mx = x(m.t);
            const my = yFor(distanceAt(m.t));
            const urgent = m.band.seconds <= 300;
            return (
              <g key={i}>
                {urgent ? (
                  <line
                    x1={mx}
                    x2={mx}
                    y1={my}
                    y2={floorY}
                    stroke="var(--color-signal)"
                    strokeWidth="1.5"
                    filter="url(#tick-glow)"
                    opacity={animate ? 0.55 : 0}
                    style={{ transition: `opacity 0.5s ease ${0.3 + m.t * 2.1}s` }}
                  />
                ) : null}
                <line
                  x1={mx}
                  x2={mx}
                  y1={my}
                  y2={floorY}
                  stroke={urgent ? "var(--color-signal)" : "var(--color-line-bright)"}
                  strokeWidth="1"
                  opacity={animate ? (urgent ? 0.95 : 0.8) : 0}
                  style={{ transition: `opacity 0.5s ease ${0.3 + m.t * 2.1}s` }}
                />
                {/* A head on every check, so a tick reads as a moment and not as a rule. */}
                <circle
                  cx={mx}
                  cy={my}
                  r={urgent ? 1.9 : 1.4}
                  fill={urgent ? "var(--color-signal)" : "var(--color-paper-faint)"}
                  opacity={animate ? 1 : 0}
                  style={{ transition: `opacity 0.5s ease ${0.3 + m.t * 2.1}s` }}
                />
              </g>
            );
          })}
        </g>

        {/* The body of the price. */}
        <path
          d={AREA}
          fill="url(#cadence-area)"
          opacity={animate ? 1 : 0}
          style={{ transition: "opacity 1.4s ease 0.5s" }}
        />

        {/* The price itself, drawn left to right. */}
        <path
          d={PATH}
          fill="none"
          stroke="url(#cadence-line)"
          strokeWidth="2.5"
          strokeLinecap="round"
          filter="url(#cadence-glow)"
          style={{
            strokeDasharray: 2600,
            strokeDashoffset: animate ? 0 : 2600,
            transition: "stroke-dashoffset 2.4s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />

        {/* Where it ends up: on the floor, still checking. */}
        <circle
          cx={x(1)}
          cy={yFor(distanceAt(1))}
          r="5"
          fill="var(--color-signal)"
          opacity={animate ? 1 : 0}
          style={{ transition: "opacity 0.6s ease 2.2s" }}
        >
          <animate attributeName="r" values="5;9;5" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite" />
        </circle>

        {/* The floor. The only thing on the panel that is not negotiable. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={floorY}
          y2={floorY}
          stroke="var(--color-signal)"
          strokeWidth="1.5"
          strokeDasharray="2 6"
          opacity="0.8"
        />
        <g transform={`translate(${PAD.left}, ${floorY + 12})`}>
          <rect width="58" height="20" fill="var(--color-signal)" opacity="0.14" />
          <text
            x="10"
            y="14"
            className="fill-signal"
            fontSize="10.5"
            fontFamily="var(--font-mono)"
            letterSpacing="0.16em"
          >
            FLOOR
          </text>
        </g>

        {/*
          Band names, at the boundary where each regime begins.

          Staggered onto two rows on purpose: the boundaries get closer together
          as the price falls — that is the whole point of the drawing — so
          labels set on one line collide exactly where the chart is most
          interesting.
        */}
        {BANDS.map((band, i) => {
          if (i === 0) return null;
          const t = startOf(band);
          const row = i % 2 === 0 ? PAD.top - 20 : PAD.top - 44;
          const flip = t > 0.86;
          return (
            <g key={band.name} opacity={animate ? 1 : 0} style={{ transition: `opacity 0.6s ease ${0.6 + t * 1.6}s` }}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={row + 6}
                y2={floorY}
                stroke="var(--color-line-bright)"
                strokeWidth="1"
                strokeDasharray="1 4"
              />
              <text
                x={x(t) + (flip ? -8 : 8)}
                y={row}
                textAnchor={flip ? "end" : "start"}
                className="fill-paper-dim"
                fontSize="10.5"
                fontFamily="var(--font-mono)"
                letterSpacing="0.16em"
              >
                {band.label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>

      {/* The legend, which is also the strategy's constants. */}
      <dl className="m-0 grid grid-cols-2 divide-line border-t border-line sm:grid-cols-4 sm:divide-x">
        {BANDS.map((b, i) => (
          <div key={b.name} className="px-5 py-4">
            <dt className="eyebrow flex items-center gap-2">
              <span
                className="inline-block h-2 w-2"
                style={{ background: "var(--color-signal)", opacity: 0.25 + i * 0.25 }}
                aria-hidden
              />
              {b.name}
            </dt>
            <dd className="tabular m-0 mt-2 font-mono text-lg text-paper">every {b.label}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
};
