"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./motion";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";

/**
 * One night, played out.
 *
 * Every other claim on this site can be made in prose. This one cannot: the
 * argument is an *ordering* — book the successor, then do the work; check two
 * sources, then decide — and an ordering is something you watch, not something
 * you read. So the page plays a vault's night at four runs a few seconds long
 * and lets you watch the chain lay itself.
 *
 * It is a browser simulation and says so. Nothing here signs, submits, or needs
 * a wallet. The figures are the contract's real constants, though, which is why
 * the fuel arithmetic comes out at numbers that look strange: a vault reserves
 * the whole 3,000,000 gas allowance at 109 tinybar and is charged for the
 * 1,500,000 it burns, and the gap between those two is what killed the first
 * vault this project ever deployed.
 *
 * Each phase is paired with what kills it. That pairing is the project: all
 * four failures report SUCCESS, so none of them look like failures until the
 * automation has been dead for a week.
 */

type Beat = {
  /** Which phase panel lights up while this line is being written. */
  phase: number;
  /** Simulated wall clock, so the gaps between runs are visible. */
  at: string;
  text: string;
  /** Monospace value hung on the right of the line, where there is one. */
  value?: string;
  tone?: "plain" | "signal" | "dead";
};

const PHASES = [
  {
    n: "01",
    name: "Wake",
    does: "The network calls the vault. Inside, msg.sender is the vault's own address — that is the only thing separating its scheduled wake-up from an uninvited caller.",
    kills:
      "A 1,000,000 gas budget. The inner scheduleCall needs about 1.5M, runs out, and the outer call still reports SUCCESS.",
  },
  {
    n: "02",
    name: "Book",
    does: "It schedules its successor before it plans anything at all. The next run exists before there is any work that could revert.",
    kills:
      "Booking last. A strategy that reverts takes the booking with it, and the chain ends there with a green receipt.",
  },
  {
    n: "03",
    name: "Observe",
    does: "A SaucerSwap 60-second TWAP and a Chainlink feed are read, and have to agree inside a tolerance the owner set.",
    kills:
      "One source. On 11 July 2026 a single manipulated price took $9.05M out of Bonzo Lend, and roughly 40% of Hedera's TVL with it.",
  },
  {
    n: "04",
    name: "Settle",
    does: "It acts, or it refuses and records why. Either way it checks whether it can still afford the run it just booked.",
    kills:
      "Reserving the gas you burn instead of the gas you reserve. A vault holding 2.76 ℏ was refused a run that costs 1.63 ℏ, because the payer must cover the whole 3.27 ℏ allowance.",
  },
];

const SCRIPT: Beat[] = [
  { phase: 0, at: "22:00:02", text: "woke on a schedule the network fired", tone: "signal" },
  { phase: 0, at: "22:00:02", text: "msg.sender == address(this)", value: "self" },
  { phase: 1, at: "22:00:02", text: "booked run 14 — before any work", value: "04:00:02" },
  { phase: 2, at: "22:00:03", text: "SaucerSwap · 60s TWAP", value: "$0.0921" },
  { phase: 2, at: "22:00:03", text: "Chainlink · 296s old", value: "$0.0918" },
  { phase: 2, at: "22:00:03", text: "0.33% apart · tolerance 2%", value: "agree" },
  { phase: 3, at: "22:00:03", text: "above floor 0.0840 — held", value: "no trade" },
  { phase: 3, at: "22:00:03", text: "runway", value: "4 runs · 8.71 ℏ" },

  { phase: 0, at: "04:00:01", text: "woke — 6h later, nobody sent it", tone: "signal" },
  { phase: 1, at: "04:00:01", text: "booked run 15", value: "05:00:01" },
  { phase: 2, at: "04:00:02", text: "SaucerSwap · 60s TWAP", value: "$2.0503" },
  { phase: 2, at: "04:00:02", text: "Chainlink · 302s old", value: "$0.0915" },
  { phase: 2, at: "04:00:02", text: "2141% apart · tolerance 2%", value: "disagree", tone: "dead" },
  {
    phase: 3,
    at: "04:00:02",
    text: 'Refused(1, "sources disagree") — written on chain',
    value: "no trade",
    tone: "dead",
  },
  { phase: 3, at: "04:00:02", text: "the chain continues anyway", value: "3 runs left" },

  { phase: 0, at: "05:00:00", text: "woke — the interval tightened", tone: "signal" },
  { phase: 1, at: "05:00:00", text: "booked run 16", value: "05:05:00" },
  { phase: 2, at: "05:00:01", text: "both sources agree", value: "$0.0836" },
  { phase: 3, at: "05:00:01", text: "below floor 0.0840 — selling", value: "execute", tone: "signal" },
  { phase: 3, at: "05:00:04", text: "swapped 0.1 WHBAR", value: "0.204405 USDC", tone: "signal" },
  { phase: 3, at: "05:00:04", text: "runway", value: "2 runs · 5.44 ℏ" },
];

type Status = "idle" | "running" | "settled";

export const RunTheNight = () => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -20% 0px" });
  const still = useReducedMotion();

  /*
    It rests finished, not empty.

    The transcript is the argument, so it has to exist before anything fires —
    in a screenshot, in a print, in a short window, and for anyone whose browser
    never runs the observer. Coming into view replays it from the top, which is
    the enhancement; arriving at a completed panel is the floor.
  */
  const [shown, setShown] = useState(SCRIPT.length);
  const [status, setStatus] = useState<Status>("settled");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const play = useCallback(() => {
    stop();
    setShown(0);
    setStatus("running");

    SCRIPT.forEach((_, i) => {
      // A beat that starts a new run waits a little longer, so the gaps between
      // runs read as the vault sleeping rather than as a stutter.
      const pause = SCRIPT.slice(0, i + 1).reduce((total, b, j) => total + (j > 0 && b.phase === 0 ? 620 : 260), 0);
      timers.current.push(setTimeout(() => setShown(i + 1), pause));
    });

    const total = SCRIPT.reduce((sum, b, j) => sum + (j > 0 && b.phase === 0 ? 620 : 260), 0);
    timers.current.push(setTimeout(() => setStatus("settled"), total + 150));
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setShown(0);
    setStatus("idle");
  }, [stop]);

  // Guards the replay so it happens once per mount even if `useInView` reports
  // again after a resize or a layout shift.
  const played = useRef(false);

  // Plays itself the first time it comes into view, so the argument is made
  // without asking. Someone who has asked for reduced motion gets the finished
  // transcript immediately instead.
  useEffect(() => {
    if (!inView || played.current) return;
    played.current = true;
    if (still) return;
    play();
    return stop;
  }, [inView, still, play, stop]);

  useEffect(() => stop, [stop]);

  const activePhase = shown > 0 ? SCRIPT[shown - 1].phase : -1;
  const visible = SCRIPT.slice(0, shown);

  return (
    <section ref={ref} className="shell pt-28 sm:pt-36">
      <SectionHead id="simulation" eyebrow="Browser simulation · no wallet, no transaction" title="Run the night.">
        <p>
          Four runs of a vault holding a floor, played at the constants the contracts actually use. Watch the second run
          refuse — and watch the chain continue anyway, which is the part that is easy to get wrong and fatal when you
          do.
        </p>
      </SectionHead>

      <Reveal>
        <div className="lift mt-12 grid grid-cols-[minmax(0,1fr)] border border-line bg-ink-raised/40 backdrop-blur-sm lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {/* The four phases, and the four ways each one dies quietly. */}
          <ol className="m-0 list-none divide-y divide-line border-b border-line p-0 lg:border-b-0 lg:border-r">
            {PHASES.map((phase, i) => {
              const on = activePhase === i;
              return (
                <li
                  key={phase.n}
                  className="relative px-6 py-6 transition-colors duration-500"
                  style={{ background: on ? "var(--color-signal-glow)" : undefined }}
                >
                  {/* A rail that lights rather than a border that moves. */}
                  <span
                    className="absolute inset-y-0 left-0 w-0.5 origin-top bg-signal transition-transform duration-500"
                    style={{ transform: on ? "scaleY(1)" : "scaleY(0)" }}
                    aria-hidden
                  />

                  <p className="eyebrow m-0 flex items-center gap-3">
                    <span className={on ? "text-signal" : undefined}>{phase.n}</span>
                    <span className={on ? "text-paper" : "text-paper-dim"}>{phase.name}</span>
                  </p>

                  <p className="m-0 mt-4 text-sm leading-relaxed text-paper-dim">{phase.does}</p>

                  <p className="m-0 mt-4 border-l border-signal-dead/40 pl-4 text-xs leading-relaxed text-paper-faint">
                    <span className="eyebrow mr-2 text-signal-dead">Kills it</span>
                    {phase.kills}
                  </p>
                </li>
              );
            })}
          </ol>

          {/* The transcript. */}
          <div className="flex min-h-[28rem] flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <span className="eyebrow flex items-center gap-2.5">
                {status === "running" ? (
                  <span className="alive inline-block h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
                ) : (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-paper-faint" aria-hidden />
                )}
                Nocturne / vault transcript
              </span>

              <div className="flex items-center gap-2">
                <span className="eyebrow">
                  {status === "running" ? "Running…" : status === "settled" ? "Settled" : "Idle"}
                </span>
                <button
                  type="button"
                  onClick={play}
                  className="eyebrow cursor-pointer border border-line-bright px-3 py-1.5 text-paper-dim transition-colors hover:border-paper hover:text-paper"
                >
                  {status === "idle" ? "Run" : "Run again"}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="eyebrow cursor-pointer px-2 py-1.5 transition-colors hover:text-paper"
                >
                  Reset
                </button>
              </div>
            </div>

            <ol className="m-0 grow list-none divide-y divide-line p-0">
              <AnimatePresence initial={false}>
                {visible.map((beat, i) => (
                  <motion.li
                    key={`${beat.at}-${i}`}
                    initial={still ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.28 }}
                    className="grid grid-cols-[2.25rem_1fr] items-baseline gap-x-4 px-5 py-2.5 font-mono text-[13px] sm:grid-cols-[2.25rem_4.75rem_1fr_auto]"
                  >
                    <span className="text-paper-faint">{String(i + 1).padStart(2, "0")}</span>
                    <span className="hidden text-paper-faint sm:block">{beat.at}</span>
                    <span
                      className={
                        beat.tone === "signal"
                          ? "text-signal"
                          : beat.tone === "dead"
                            ? "text-signal-dead"
                            : "text-paper-dim"
                      }
                    >
                      {beat.text}
                    </span>
                    {beat.value ? <span className="tabular hidden text-paper sm:block">{beat.value}</span> : null}
                  </motion.li>
                ))}
              </AnimatePresence>

              {status === "running" ? (
                <li className="px-5 py-2.5 font-mono text-[13px] text-signal">
                  <span className="caret">▍</span>
                </li>
              ) : null}
            </ol>

            {/* The receipt, once the night is over. */}
            <AnimatePresence>
              {status === "settled" ? (
                <motion.dl
                  initial={still ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45 }}
                  className="m-0 grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-4"
                >
                  <Receipt label="Runs" value="4" />
                  <Receipt label="Refused" value="1" />
                  <Receipt label="Owner sent" value="0" />
                  <Receipt label="Runway left" value="2" lit />
                </motion.dl>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        <p className="m-0 mt-5 max-w-3xl text-xs leading-relaxed text-paper-faint">
          The disagreement in run two is a testnet artefact rather than a staged one: nothing arbitrages a testnet, so
          the pool drifts from the feed and stays drifted. It is the wrong place to demonstrate a realistic sale and
          exactly the right place to demonstrate a refusal.
        </p>
      </Reveal>
    </section>
  );
};

const Receipt = ({ label, value, lit = false }: { label: string; value: string; lit?: boolean }) => (
  <div className="px-5 py-4">
    <dt className="eyebrow">{label}</dt>
    <dd className={`tabular m-0 mt-2 font-mono text-2xl leading-none ${lit ? "text-signal" : "text-paper"}`}>
      {value}
    </dd>
  </div>
);
