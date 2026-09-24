"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

/**
 * The ordering that is the whole design.
 *
 * Every execution does two things, and the order is not a detail — it is the
 * mechanism. The vault books its successor *first*, out of the same transaction
 * the network woke it with, and only then runs the strategy. Draw it the other
 * way round and the picture is a different product: one where a single bad run
 * ends the chain forever, silently, with a receipt that says SUCCESS.
 *
 * So the drawing puts the two steps in order inside each run, hangs the arc to
 * the next run off the *booking* rather than off the run as a whole, and then
 * shows run 15's work failing. The arc to run 16 leaves anyway. That is the
 * argument, and it cannot be made in a sentence.
 *
 * It rests finished: every box, arc and label is present before anything
 * animates. The animation walks a highlight through the sequence, which is an
 * enhancement, never a precondition — a diagram that only exists once an
 * observer fires is a diagram missing from every screenshot.
 */

const W = 1200;
const H = 300;

/*
  Narrow boxes and wide gaps, on purpose.

  The arc between two runs is the most important line in the drawing — it is
  the next run being created — so the gap it crosses has to be wide enough for
  it to be a curve rather than a hook. Boxes at 270 leave 175px of clear run
  between them, which is enough for a 50px rise to read as a gentle sweep.
*/
const RUNS = [
  { n: 14, x: 20, works: true },
  { n: 15, x: 465, works: false },
  { n: 16, x: 910, works: true },
];

const BOX_W = 270;
const BOX_TOP = 44;
const BOX_H = 186;

/** y of the two rows inside a run box. */
const BOOK_Y = BOX_TOP + 72;
const WORK_Y = BOX_TOP + 136;

/** Six beats: each run books, then works. */
const STEPS = 6;

export const LoopDiagram = () => {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: false, margin: "0px 0px -15% 0px" });
  const still = useReducedMotion();

  // -1 means "nothing highlighted", which is the resting state: the whole
  // diagram is readable before a single frame of animation has run.
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (!inView || still) return;
    let i = 0;
    setStep(0);
    const timer = setInterval(() => {
      i = (i + 1) % (STEPS + 2); // two empty beats, so the loop has a breath
      setStep(i < STEPS ? i : -1);
    }, 900);
    return () => clearInterval(timer);
  }, [inView, still]);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Each run books the next one before it does any work. Run fifteen's work fails, and the chain continues to run sixteen anyway."
    >
      <defs>
        <marker id="loop-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-signal)" />
        </marker>
        <filter id="loop-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/*
        The arcs, drawn first so the boxes sit on top of them.

        Each one leaves the *booking row* and lands on the next run's header,
        because that is literally where the next run comes from. A single cubic
        with its control points pulled horizontally gives a flat-topped sweep;
        lifting them vertically instead produces a hook that reads as a loop
        back rather than a hand-off forward.
      */}
      {RUNS.slice(0, -1).map((run, i) => {
        const from = run.x + BOX_W;
        const to = RUNS[i + 1].x;
        const land = BOX_TOP + 24;
        const lit = step === i * 2;
        return (
          <g key={`arc-${run.n}`}>
            <path
              d={`M ${from} ${BOOK_Y} C ${from + 90} ${BOOK_Y}, ${to - 96} ${land}, ${to - 8} ${land}`}
              fill="none"
              stroke="var(--color-signal)"
              strokeWidth={lit ? 2 : 1.25}
              opacity={lit ? 1 : 0.45}
              markerEnd="url(#loop-arrow)"
              style={{ transition: "opacity 0.4s ease, stroke-width 0.4s ease" }}
            />
            <text
              x={(from + to) / 2}
              y={BOX_TOP + 6}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="10.5"
              letterSpacing="0.16em"
              fill={lit ? "var(--color-signal)" : "var(--color-paper-faint)"}
              style={{ transition: "fill 0.4s ease" }}
            >
              THE NETWORK FIRES IT
            </text>
          </g>
        );
      })}

      {RUNS.map((run, i) => {
        const bookLit = step === i * 2;
        const workLit = step === i * 2 + 1;
        return (
          <g key={run.n}>
            {/* The run. A box that is only ever a container for two rows. */}
            <rect
              x={run.x}
              y={BOX_TOP}
              width={BOX_W}
              height={BOX_H}
              fill="var(--color-ink-sunken)"
              stroke={bookLit || workLit ? "var(--color-signal)" : "var(--color-line-bright)"}
              strokeWidth="1"
              opacity={bookLit || workLit ? 1 : 0.85}
              style={{ transition: "stroke 0.4s ease" }}
            />

            <text
              x={run.x + 20}
              y={BOX_TOP + 28}
              fontFamily="var(--font-mono)"
              fontSize="10.5"
              letterSpacing="0.18em"
              fill="var(--color-paper-faint)"
            >
              RUN {run.n}
            </text>

            {/* Step one: the booking. Always first, always the accent. */}
            <Row x={run.x} y={BOOK_Y} index="1" label={`books run ${run.n + 1}`} tone="signal" lit={bookLit} />

            {/* Step two: the work. Which is allowed to fail. */}
            <Row
              x={run.x}
              y={WORK_Y}
              index="2"
              label={run.works ? "runs the strategy" : "strategy reverts"}
              tone={run.works ? "paper" : "dead"}
              lit={workLit}
            />
          </g>
        );
      })}

      {/*
        The call itself, named. A judge reading this page wants to know which
        Hedera primitive is doing the work and at what address, and there is no
        reason to make them go and look.
      */}
      <g transform={`translate(${W / 2 - 250}, ${BOX_TOP + BOX_H + 22})`}>
        <rect width="500" height="40" fill="var(--color-signal-glow)" stroke="var(--color-signal-dim)" />
        <text x="250" y="25" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="13" fill="var(--color-paper)">
          0x16b.scheduleCall(address(this), …)
        </text>
      </g>
    </svg>
  );
};

/** One numbered step inside a run box. */
const Row = ({
  x,
  y,
  index,
  label,
  tone,
  lit,
}: {
  x: number;
  y: number;
  index: string;
  label: string;
  tone: "signal" | "paper" | "dead";
  lit: boolean;
}) => {
  const colour =
    tone === "signal" ? "var(--color-signal)" : tone === "dead" ? "var(--color-signal-dead)" : "var(--color-paper)";

  return (
    <g opacity={lit ? 1 : 0.62} style={{ transition: "opacity 0.4s ease" }}>
      {/* A rail that lights, rather than a border that moves. */}
      <rect x={x + 20} y={y - 16} width="3" height="32" fill={colour} />
      {lit ? <rect x={x + 20} y={y - 16} width="3" height="32" fill={colour} filter="url(#loop-glow)" /> : null}

      <text x={x + 36} y={y - 2} fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--color-paper-faint)">
        {index}
      </text>
      <text x={x + 56} y={y + 5} fontFamily="var(--font-sans)" fontSize="15" fill={colour}>
        {label}
      </text>
    </g>
  );
};
