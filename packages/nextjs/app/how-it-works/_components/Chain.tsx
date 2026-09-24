"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The ordering that is the whole design.
 *
 * Each execution books its successor *before* it plans anything. That sentence
 * is easy to nod at and easy to get wrong, and getting it wrong is fatal in a
 * way nothing warns you about: if planning reverted and took the booking with
 * it, the chain would end there, silently, with a transaction that reported
 * success.
 *
 * So the drawing puts the two in order and lets you watch. The successor link
 * is struck first, in brass, while the work beneath it is still being decided.
 * The third run refuses — and the chain continues anyway, which is the point.
 */

type Run = { n: number; outcome: "executed" | "refused"; note: string };

const RUNS: Run[] = [
  { n: 1, outcome: "executed", note: "held" },
  { n: 2, outcome: "executed", note: "held" },
  { n: 3, outcome: "refused", note: "sources disagree" },
  { n: 4, outcome: "executed", note: "held" },
];

export const Chain = () => {
  const [step, setStep] = useState(-1);
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries =>
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          io.disconnect();
          // One beat per run, so the eye follows the chain being laid rather
          // than arriving at a finished picture.
          RUNS.forEach((_, i) => setTimeout(() => setStep(i), 260 * i));
        }),
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <ol ref={ref} className="m-0 p-0 list-none grid gap-px bg-line border border-line sm:grid-cols-4">
      {RUNS.map((run, i) => {
        const on = step >= i;
        return (
          <li
            key={run.n}
            className="bg-ink-raised p-5 transition-opacity duration-500"
            style={{ opacity: on ? 1 : 0.2 }}
          >
            <div className="label flex items-center justify-between">
              <span>Run {String(run.n).padStart(2, "0")}</span>
              {i === RUNS.length - 1 && on ? <span className="alive text-brass">●</span> : null}
            </div>

            {/* Booked first. Struck in brass because it is the only thing on
                this panel that must never be skipped. */}
            <div className="mt-4 flex items-center gap-2">
              <span
                className="h-px flex-1 bg-brass origin-left transition-transform duration-500 ease-out"
                style={{ transform: on ? "scaleX(1)" : "scaleX(0)" }}
              />
              <span className="label text-brass whitespace-nowrap">books {String(run.n + 1).padStart(2, "0")}</span>
            </div>

            <div className="mt-5">
              <div className={run.outcome === "refused" ? "text-paper-dim" : "text-paper"}>
                {run.outcome === "refused" ? "Refused" : "Executed"}
              </div>
              <div className="text-xs text-paper-faint mt-1">{run.note}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
};
