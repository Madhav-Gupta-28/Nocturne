"use client";

import { SectionHead } from "./SectionHead";
import { CountUp, Reveal } from "./motion";
import { formatDuration, useNow } from "./ui";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * The evidence, set as an instrument rather than as prose.
 *
 * What this system does is invisible: nothing happens, correctly, while nobody
 * is watching. A page about that cannot open with a paragraph claiming it — so
 * the claim *is* the live figure, with a clock beside it that moves on its own.
 *
 * `Heartbeat` is a contract with one job: record that somebody called it. Every
 * count on it was placed by a vault executing a schedule the network fired, and
 * none of them were sent by a person. It is shown before any wallet connects,
 * because the claim is about the chain rather than about the visitor.
 *
 * The ledger underneath is read from the generated deployment file, so it can
 * never drift from what is actually on testnet: if a contract is redeployed,
 * this table changes with it.
 */

/** What each deployed contract is for, in one line a reviewer can check. */
const ROLES: Record<string, string> = {
  NocturneFactory: "Builds one vault per owner and keeps the mapping",
  Heartbeat: "Records that somebody called it. Nothing else",
  HeartbeatStrategy: "Fixed cadence. The smallest strategy that can exist",
  ProtectiveExitStrategy: "Sells to a floor, and refuses when sources disagree",
  DriftRebalanceStrategy: "Holds a ratio, and tightens as it drifts",
  PriceLens: "Reads both price sources so a frontend can see what a vault sees",
};

const ORDER = [
  "NocturneFactory",
  "Heartbeat",
  "ProtectiveExitStrategy",
  "DriftRebalanceStrategy",
  "HeartbeatStrategy",
  "PriceLens",
];

export const Proof = () => {
  const now = useNow();
  const { targetNetwork } = useTargetNetwork();

  const { data: beats } = useScaffoldReadContract({ contractName: "Heartbeat", functionName: "beats" });
  const { data: lastBeatAt } = useScaffoldReadContract({ contractName: "Heartbeat", functionName: "lastBeatAt" });

  // Ticked in the browser rather than polled, so the figure moves every second
  // while the chain is only read every few.
  const everBeaten = beats !== undefined && beats > 0n;
  const silentFor = lastBeatAt && everBeaten ? now - Number(lastBeatAt) : undefined;

  const chain = (deployedContracts as Record<number, Record<string, { address: string }>>)[targetNetwork.id] ?? {};
  const rows = ORDER.filter(name => chain[name]).map(name => ({ name, address: chain[name].address }));

  return (
    <section className="shell pt-28 sm:pt-36">
      <SectionHead id="proof" eyebrow="Live · Hedera testnet" title="Executions nobody sent.">
        <p>
          Every count below was placed by a vault paying its own fee out of its own balance. The owner&apos;s account
          appears exactly once, for the transaction that armed it, and never again.
        </p>
        <p>
          The figures are read from the chain in your browser. The clock is not — it ticks locally, so you can watch the
          silence grow between two reads.
        </p>
      </SectionHead>

      <Reveal>
        <div className="lift mt-12 border border-line bg-ink-raised/40 backdrop-blur-sm">
          <dl className="m-0 grid divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
            <Figure
              label="Executions nobody sent"
              value={beats !== undefined ? <CountUp value={Number(beats)} /> : "—"}
              lit
            />
            <Figure label="Since the last one" value={silentFor !== undefined ? formatDuration(silentFor) : "—"} />
            <Figure label="Sent by the owner" value="0" />
          </dl>
        </div>
      </Reveal>

      {/*
        The ledger. Mono, hairline-ruled, and read from the generated deployment
        file rather than typed here — a table of addresses that can go stale is
        worse than no table at all.
      */}
      <Reveal delay={0.06}>
        <div className="lift mt-6 border border-line bg-ink-raised/30">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="eyebrow">On chain · {rows.length} contracts · verified source</span>
            <span className="eyebrow hidden sm:block">Open on HashScan</span>
          </div>

          <ul className="m-0 list-none divide-y divide-line p-0">
            {rows.map(({ name, address }) => (
              <li key={name}>
                <a
                  href={getBlockExplorerAddressLink(targetNetwork, address)}
                  target="_blank"
                  rel="noreferrer"
                  className="group grid items-baseline gap-x-6 gap-y-1 px-5 py-4 transition-colors hover:bg-signal-glow/40 sm:grid-cols-[13rem_minmax(0,1fr)_auto]"
                >
                  <span className="font-mono text-sm text-paper transition-colors group-hover:text-signal">{name}</span>
                  <span className="text-sm text-paper-dim">{ROLES[name]}</span>
                  <span className="font-mono text-xs text-paper-faint transition-colors group-hover:text-paper">
                    {address.slice(0, 10)}…{address.slice(-6)} <span aria-hidden>↗</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </section>
  );
};

/** One figure in the panel. Mono, tabular, so it never reflows as it ticks. */
const Figure = ({ label, value, lit = false }: { label: string; value: React.ReactNode; lit?: boolean }) => (
  <div className="px-6 py-7">
    <dd
      className={`tabular m-0 font-mono text-4xl leading-none sm:text-5xl ${lit ? "text-signal" : "text-paper"}`}
      style={lit ? { textShadow: "0 0 32px var(--color-signal-glow)" } : undefined}
    >
      {value}
    </dd>
    <dt className="eyebrow mt-4">{label}</dt>
  </div>
);
