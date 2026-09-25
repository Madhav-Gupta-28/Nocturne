"use client";

import { SectionHead } from "./SectionHead";
import { Reveal } from "./motion";

/**
 * How big this gets.
 *
 * The template ships three strategies. The argument for the template is every
 * strategy it does not ship: each one is a new file against a four-function
 * interface, with the engine, the fuel accounting and the price guard already
 * written. So the section lists jobs, and marks honestly which exist today.
 *
 * The keeper line is sourced. Chainlink's own list of Automation networks does
 * not include Hedera, which is the gap the Schedule Service fills natively.
 */

const JOBS = [
  { job: "Stop-loss and depeg guards", shipped: true },
  { job: "Portfolio rebalancing", shipped: true },
  { job: "Heartbeats", shipped: true },
  { job: "Dollar-cost averaging" },
  { job: "Loan protection" },
  { job: "Vesting and payroll" },
  { job: "LP compounding" },
  { job: "Agent jobs" },
];

const AUTOMATION_NETWORKS = "https://docs.chain.link/chainlink-automation/overview/supported-networks";

export const Unlocks = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead id="unlocks" title="Every repeating job on Hedera.">
      <p>
        Chainlink Automation, the keeper network other EVM chains rent,{" "}
        <a className="link text-paper" href={AUTOMATION_NETWORKS} target="_blank" rel="noreferrer">
          does not run on Hedera
        </a>
        . The Schedule Service makes automation native. Nocturne makes it a template:{" "}
        <span className="text-paper">each new job is one file and four functions.</span>
      </p>
    </SectionHead>

    <Reveal>
      <ul className="lift m-0 mt-12 grid list-none grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line p-0 sm:grid-cols-2 lg:grid-cols-4">
        {JOBS.map(j => (
          <li key={j.job} className={`flex flex-col px-6 py-6 ${j.shipped ? "bg-signal-glow/40" : "bg-ink-raised/80"}`}>
            <span className={`eyebrow ${j.shipped ? "text-signal" : ""}`}>
              {j.shipped ? "Ships today" : "One file away"}
            </span>
            <p className="mb-0 mt-4 text-lg leading-snug text-paper">{j.job}</p>
          </li>
        ))}
      </ul>
    </Reveal>
  </section>
);
