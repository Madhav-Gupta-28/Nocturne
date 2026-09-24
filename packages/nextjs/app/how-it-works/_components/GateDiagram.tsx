"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

/**
 * The refusal, drawn as the gate it actually is.
 *
 * This is the hardest thing on the site to make visible, because a refusal
 * changes nothing: no swap, no balance moves, no row on an explorer lights up.
 * The only trace is an event saying why. So the drawing has to supply the drama
 * the chain deliberately does not.
 *
 * Two sources feed one comparator, and the comparator has two exits. Showing
 * only the exit that testnet happens to take would teach half the mechanism —
 * so the figure alternates between the two cases, and the reader can pin either
 * one. The path not taken stays drawn, greyed, with a bar across it: what makes
 * a gate a gate is that the other way exists and is shut.
 *
 * Both scenarios are real. The agreeing pair is roughly what mainnet reads; the
 * disagreeing pair is what testnet reads right now, because nothing arbitrages
 * a testnet so the pool drifts from the feed and stays drifted.
 */

const W = 1200;
const H = 330;

type Scene = {
  key: string;
  twap: string;
  feed: string;
  gap: string;
  agree: boolean;
  note: string;
};

const SCENES: Scene[] = [
  {
    key: "agree",
    twap: "$0.0921",
    feed: "$0.0918",
    gap: "0.33%",
    agree: true,
    note: "inside the 2% tolerance",
  },
  {
    key: "disagree",
    twap: "$2.0503",
    feed: "$0.0915",
    gap: "2140%",
    agree: false,
    note: "testnet, right now",
  },
];

/** Geometry. Laid out left to right: sources, comparator, two exits. */
const SRC_X = 34;
const SRC_W = 286;
const GATE_X = 470;
const GATE_W = 220;
const OUT_X = 830;
const OUT_W = 336;
const MID_Y = 165;
const TOP_Y = 62;
const BOT_Y = 236;

export const GateDiagram = () => {
  const host = useRef<HTMLDivElement>(null);
  const inView = useInView(host, { once: false, margin: "0px 0px -15% 0px" });
  const still = useReducedMotion();

  const [i, setI] = useState(1); // testnet's answer, which is the interesting one
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!inView || still || pinned) return;
    const timer = setInterval(() => setI(n => (n + 1) % SCENES.length), 3800);
    return () => clearInterval(timer);
  }, [inView, still, pinned]);

  const scene = SCENES[i];
  const open = scene.agree;

  return (
    <div ref={host}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Two price sources feed one check. ${
          open
            ? "They agree, so the swap runs."
            : "They disagree, so nothing is sold and the reason is written on chain."
        }`}
      >
        <defs>
          <marker id="gate-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          <filter id="gate-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* ── the two sources ───────────────────────────────────────── */}
        <Source y={TOP_Y} label="SAUCERSWAP · 60s TWAP" value={scene.twap} />
        <Source y={BOT_Y} label="CHAINLINK · HBAR/USD" value={scene.feed} />

        {/* Both feed the same comparator. Drawn as one joint so the point —
            that neither source decides alone — is structural. */}
        {[TOP_Y, BOT_Y].map(y => (
          <path
            key={y}
            d={`M ${SRC_X + SRC_W} ${y} C ${SRC_X + SRC_W + 70} ${y}, ${GATE_X - 70} ${MID_Y}, ${GATE_X} ${MID_Y}`}
            fill="none"
            stroke="var(--color-line-bright)"
            strokeWidth="1.5"
            color="var(--color-line-bright)"
            markerEnd="url(#gate-arrow)"
          />
        ))}

        {/* ── the comparator ────────────────────────────────────────── */}
        <g>
          <rect
            x={GATE_X}
            y={MID_Y - 52}
            width={GATE_W}
            height="104"
            fill="var(--color-ink-sunken)"
            stroke={open ? "var(--color-signal)" : "var(--color-signal-dead)"}
            strokeWidth="1.5"
            style={{ transition: "stroke 0.5s ease" }}
          />
          <text
            x={GATE_X + GATE_W / 2}
            y={MID_Y - 26}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="10.5"
            letterSpacing="0.16em"
            fill="var(--color-paper-faint)"
          >
            APART
          </text>
          <text
            x={GATE_X + GATE_W / 2}
            y={MID_Y + 8}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="26"
            fill={open ? "var(--color-signal)" : "var(--color-signal-dead)"}
            style={{ transition: "fill 0.5s ease" }}
          >
            {scene.gap}
          </text>
          <text
            x={GATE_X + GATE_W / 2}
            y={MID_Y + 34}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="10.5"
            letterSpacing="0.14em"
            fill="var(--color-paper-faint)"
          >
            TOLERANCE 2%
          </text>
        </g>

        {/* ── the two exits ─────────────────────────────────────────── */}
        <Branch y={TOP_Y} live={open} label="It swaps" sub="approve, then sell to the floor" tone="signal" />
        <Branch y={BOT_Y} live={!open} label="It refuses" sub='Refused(run, "sources disagree")' tone="dead" />
      </svg>

      {/* The two cases, as controls. Pinning one stops the alternation, which
          matters for anyone trying to read the numbers rather than watch. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
        <span className="eyebrow mr-2">The two cases</span>
        {SCENES.map((s, n) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setI(n);
              setPinned(true);
            }}
            aria-pressed={i === n}
            className={`eyebrow cursor-pointer border px-3 py-1.5 transition-colors ${
              i === n
                ? "border-signal text-signal"
                : "border-line text-paper-dim hover:border-line-bright hover:text-paper"
            }`}
          >
            {s.agree ? "They agree" : "They disagree"} · {s.note}
          </button>
        ))}
      </div>
    </div>
  );
};

const Source = ({ y, label, value }: { y: number; label: string; value: string }) => (
  <g>
    <rect
      x={SRC_X}
      y={y - 36}
      width={SRC_W}
      height="72"
      fill="var(--color-ink-sunken)"
      stroke="var(--color-line-bright)"
    />
    <text
      x={SRC_X + 18}
      y={y - 12}
      fontFamily="var(--font-mono)"
      fontSize="10.5"
      letterSpacing="0.14em"
      fill="var(--color-paper-faint)"
    >
      {label}
    </text>
    <text x={SRC_X + 18} y={y + 20} fontFamily="var(--font-mono)" fontSize="24" fill="var(--color-paper)">
      {value}
    </text>
  </g>
);

/**
 * One exit from the comparator.
 *
 * The dead branch keeps its full geometry and loses only its colour, plus a bar
 * across the path. A branch that disappears when it is not taken teaches a
 * one-way pipe; a branch that stays and is visibly blocked teaches a gate.
 */
const Branch = ({
  y,
  live,
  label,
  sub,
  tone,
}: {
  y: number;
  live: boolean;
  label: string;
  sub: string;
  tone: "signal" | "dead";
}) => {
  const colour = tone === "signal" ? "var(--color-signal)" : "var(--color-signal-dead)";
  const stroke = live ? colour : "var(--color-line-bright)";
  const mid = (GATE_X + GATE_W + OUT_X) / 2;

  return (
    <g>
      <path
        d={`M ${GATE_X + GATE_W} ${MID_Y} C ${GATE_X + GATE_W + 70} ${MID_Y}, ${OUT_X - 70} ${y}, ${OUT_X} ${y}`}
        fill="none"
        stroke={stroke}
        strokeWidth={live ? 2 : 1.25}
        color={stroke}
        markerEnd="url(#gate-arrow)"
        style={{ transition: "stroke 0.5s ease, stroke-width 0.5s ease" }}
      />

      {/* The bar across the path not taken. */}
      {!live ? (
        <g stroke="var(--color-paper-faint)" strokeWidth="1.5">
          <line x1={mid - 9} y1={(MID_Y + y) / 2 - 9} x2={mid + 9} y2={(MID_Y + y) / 2 + 9} />
          <line x1={mid - 9} y1={(MID_Y + y) / 2 + 9} x2={mid + 9} y2={(MID_Y + y) / 2 - 9} />
        </g>
      ) : null}

      <rect
        x={OUT_X}
        y={y - 36}
        width={OUT_W}
        height="72"
        fill={live ? "var(--color-ink-sunken)" : "transparent"}
        stroke={live ? colour : "var(--color-line)"}
        strokeWidth={live ? 1.5 : 1}
        style={{ transition: "stroke 0.5s ease" }}
      />
      {live ? (
        <rect x={OUT_X} y={y - 36} width={OUT_W} height="72" fill={colour} opacity="0.1" filter="url(#gate-glow)" />
      ) : null}

      <text
        x={OUT_X + 20}
        y={y - 8}
        fontFamily="var(--font-sans)"
        fontSize="17"
        fill={live ? colour : "var(--color-paper-faint)"}
        style={{ transition: "fill 0.5s ease" }}
      >
        {label}
      </text>
      <text
        x={OUT_X + 20}
        y={y + 18}
        fontFamily="var(--font-mono)"
        fontSize="12"
        fill={live ? "var(--color-paper-dim)" : "var(--color-paper-faint)"}
        opacity={live ? 1 : 0.6}
      >
        {sub}
      </text>
    </g>
  );
};
