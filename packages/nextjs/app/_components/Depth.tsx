"use client";

import Link from "next/link";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./motion";

/**
 * Depth over breadth, drawn as the shape it is.
 *
 * A template can call five Hedera services once each and look broader than
 * this one. The trade here is the opposite: one service is the engine, used
 * until its failure modes were found and written down, and everything else is
 * there because the engine needs it. So the engine is the big card and the rest
 * hang off it, and a reader counting logos sees what the count leaves out.
 */

const ENGINE_CALLS = ["scheduleCall", "hasScheduleCapacity", "deleteSchedule"];

const SUPPORT = [
  { name: "SaucerSwap V2", role: "30-min TWAP and the swap" },
  { name: "Chainlink", role: "The second opinion on price" },
  { name: "Token Service", role: "Holds HTS tokens in the vault" },
  { name: "Mirror Node", role: "Proves who paid each run" },
];

export const Depth = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead id="depth" title="One service, all the way down.">
      <p>
        Most templates touch many services once.{" "}
        <span className="text-paper">Nocturne is built on one, and knows how it breaks.</span>
      </p>
    </SectionHead>

    <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Reveal>
        <div className="lift relative h-full overflow-hidden border border-signal/45 bg-signal-glow/25 p-7 backdrop-blur-sm sm:p-9">
          <p className="eyebrow m-0 text-signal">The engine</p>
          <p className="display m-0 mt-4 text-[clamp(2rem,4vw,3.25rem)] leading-none">Schedule Service</p>

          <ul className="m-0 mt-8 flex list-none flex-wrap gap-2 p-0">
            {ENGINE_CALLS.map(c => (
              <li key={c} className="border border-signal/35 bg-ink-sunken/60 px-3 py-1.5 font-mono text-xs text-paper">
                {c}
              </li>
            ))}
          </ul>

          <div className="mt-10 flex items-end gap-4">
            <span className="display text-[4.5rem] leading-[0.8] text-signal">6</span>
            <span className="pb-1 text-sm leading-snug text-paper-dim">
              silent failure modes,
              <br />
              measured on testnet.{" "}
              <Link className="link text-paper" href="/docs/landmines">
                Read them
              </Link>
            </span>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-1">
        {SUPPORT.map((s, i) => (
          <Reveal key={s.name} delay={0.05 * i}>
            <div className="flex h-full flex-col justify-center bg-ink-raised/80 px-6 py-5">
              <p className="m-0 text-base text-paper">{s.name}</p>
              <p className="mb-0 mt-1 text-sm text-paper-dim">{s.role}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);
