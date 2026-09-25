"use client";

import { useRef } from "react";
import { Reveal } from "./motion";
import { motion, useInView, useReducedMotion } from "framer-motion";

/**
 * The problem, before the solution.
 *
 * A landing page that opens with what a thing does asks the reader to take on
 * faith that the thing was needed. This is the two sentences that make the rest
 * of the page worth reading, and it is the shortest section on the site: the
 * problem is not complicated, it has just never been said plainly.
 *
 * Centred, on purpose. Every other section here is left-aligned with its
 * argument beside it — putting this one on the axis makes it read as the
 * premise rather than as another feature, and gives the comparison underneath
 * something to sit symmetrically beneath.
 *
 * The three rows are the whole pitch. Same questions, two answers, and they
 * arrive a row at a time so the eye is walked down them rather than handed a
 * finished table.
 */

const ROWS = [
  { ask: "What runs it", keeper: "A server you rent", here: "The Hedera network" },
  { ask: "Who pays", keeper: "Your card, monthly", here: "The contract itself" },
  { ask: "If it stops", keeper: "Nothing tells you", here: "Its runway warns you first" },
];

export const Problem = () => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -20% 0px" });
  const still = useReducedMotion();
  const play = Boolean(still) || inView;

  return (
    <section className="shell pt-28 sm:pt-36">
      <Reveal>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="display display-lit mb-0 text-[clamp(2rem,5vw,4rem)]">Other chains need a bot.</h2>
          <p className="mx-auto mb-0 mt-8 max-w-xl text-balance text-lg leading-relaxed text-paper-dim">
            A contract can&apos;t wake itself up, so somebody runs a server to do it.{" "}
            <span className="text-paper">On Hedera, the network can.</span>
          </p>
        </div>
      </Reveal>

      <div ref={ref} className="mt-16">
        <Reveal>
          <div className="lift grid grid-cols-[minmax(0,1fr)] border border-line bg-ink-raised/40 backdrop-blur-sm sm:grid-cols-2">
            <Head title="A keeper bot" note="Everywhere else" />
            <Head title="Nocturne" note="On Hedera" lit />

            {ROWS.map((row, i) => (
              <Fragment key={row.ask}>
                <Cell ask={row.ask} answer={row.keeper} index={i} play={play} still={Boolean(still)} />
                <Cell ask={row.ask} answer={row.here} index={i} play={play} still={Boolean(still)} lit />
              </Fragment>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
};

/**
 * Both halves of a row are siblings of the grid, not children of a wrapper.
 *
 * A wrapper would become the grid item and the two answers would stop lining
 * up with each other — which is the only reason a comparison table reads at a
 * glance. So each row emits two cells straight into the same grid.
 */
const Fragment = ({ children }: { key?: string; children: React.ReactNode }) => <>{children}</>;

const Head = ({ title, note, lit = false }: { title: string; note: string; lit?: boolean }) => (
  <div className={`border-b border-line px-6 py-6 ${lit ? "bg-signal-glow/50 sm:border-l" : ""}`}>
    <p className={`display mb-0 text-2xl ${lit ? "text-signal" : "text-paper-dim"}`}>{title}</p>
    <p className="eyebrow mb-0 mt-2">{note}</p>
  </div>
);

const Cell = ({
  ask,
  answer,
  index,
  play,
  still,
  lit = false,
}: {
  ask: string;
  answer: string;
  index: number;
  play: boolean;
  still: boolean;
  lit?: boolean;
}) => (
  <motion.div
    initial={still ? false : { opacity: 0 }}
    animate={play ? { opacity: 1 } : undefined}
    transition={{ duration: 0.5, delay: 0.15 + index * 0.12 + (lit ? 0.06 : 0) }}
    className={`flex items-baseline justify-between gap-6 border-b border-line px-6 py-5 ${
      lit ? "bg-signal-glow/25 sm:border-l" : ""
    }`}
  >
    {/*
      The question is repeated in both halves. On a phone the grid is one
      column, and an answer with no question above it means nothing; on a wide
      screen the repetition is what makes the two columns scan as a pair.
    */}
    <span className="eyebrow">{ask}</span>
    <span className={`text-right text-base ${lit ? "text-paper" : "text-paper-dim"}`}>{answer}</span>
  </motion.div>
);
