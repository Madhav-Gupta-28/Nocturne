"use client";

import { SectionHead } from "./SectionHead";
import { Reveal } from "./motion";

/**
 * The problem, before the solution.
 *
 * A landing page that opens with what a thing does is asking the reader to
 * take on faith that the thing was needed. This section is the two sentences
 * that make the rest of the page worth reading, and it is deliberately the
 * shortest section on the site: the problem is not complicated, it has just
 * never been said plainly.
 *
 * The two panels are the whole argument. One column is how this is done today
 * and the other is how it is done here, with the same four rows in the same
 * order, so the difference is read rather than explained.
 */

const ROWS = [
  { label: "What calls it", today: "A server you rent", here: "The Hedera network" },
  { label: "Who keeps it alive", today: "You, forever", here: "Nobody" },
  { label: "Who pays", today: "Your card, monthly", here: "The vault, per run" },
  { label: "When it dies", today: "Silently", here: "When the HBAR runs out" },
];

export const Problem = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead eyebrow="The problem" title="A contract cannot wake itself up.">
      <p>
        Every repeating job on a blockchain today is really a machine someone owns, sitting in a data centre, that has
        to stay online and keep getting paid.
      </p>
      <p className="text-paper">When it stops, your job stops — and nothing tells you.</p>
    </SectionHead>

    <Reveal>
      <div className="lift mt-12 grid grid-cols-[minmax(0,1fr)] border border-line bg-ink-raised/40 backdrop-blur-sm sm:grid-cols-2">
        <Column title="A keeper" note="How it is done today" rows={ROWS.map(r => [r.label, r.today] as const)} />
        <Column title="Nocturne" note="How it is done here" rows={ROWS.map(r => [r.label, r.here] as const)} lit />
      </div>
    </Reveal>
  </section>
);

const Column = ({
  title,
  note,
  rows,
  lit = false,
}: {
  title: string;
  note: string;
  rows: ReadonlyArray<readonly [string, string]>;
  lit?: boolean;
}) => (
  <div className={`border-line max-sm:border-t sm:[&+&]:border-l ${lit ? "bg-signal-glow/40" : ""}`}>
    <div className="border-b border-line px-6 py-5">
      <p className={`display m-0 text-2xl ${lit ? "text-signal" : "text-paper-dim"}`}>{title}</p>
      <p className="eyebrow mb-0 mt-2">{note}</p>
    </div>

    <dl className="m-0 divide-y divide-line">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-6 px-6 py-4">
          <dt className="eyebrow">{label}</dt>
          <dd className={`m-0 text-right text-sm ${lit ? "text-paper" : "text-paper-dim"}`}>{value}</dd>
        </div>
      ))}
    </dl>
  </div>
);
