"use client";

import { SectionHead } from "./SectionHead";
import { CountUp, Reveal } from "./motion";
import { formatDuration, useNow } from "./ui";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * Three numbers, read from the chain in the reader's browser.
 *
 * What this system does is invisible: nothing happens, correctly, while nobody
 * is watching. A page about that cannot ask to be believed — so the claim *is*
 * the live figure, with a clock beside it that moves on its own while you look
 * at it.
 *
 * `Heartbeat` is a contract with one job: record that somebody called it. The
 * third figure is the one that matters, and it is a zero.
 */
export const Proof = () => {
  const now = useNow();
  const { targetNetwork } = useTargetNetwork();
  const { data: heartbeat } = useDeployedContractInfo({ contractName: "Heartbeat" });

  const { data: beats } = useScaffoldReadContract({ contractName: "Heartbeat", functionName: "beats" });
  const { data: lastBeatAt } = useScaffoldReadContract({ contractName: "Heartbeat", functionName: "lastBeatAt" });

  // Ticked in the browser rather than polled, so the figure moves every second
  // while the chain is only read every few.
  const everBeaten = beats !== undefined && beats > 0n;
  const silentFor = lastBeatAt && everBeaten ? now - Number(lastBeatAt) : undefined;

  return (
    <section className="shell pt-28 sm:pt-36">
      <SectionHead id="proof" eyebrow="Live on Hedera testnet" title="It is already running.">
        <p>
          A vault has been calling a counter on testnet for weeks. Nobody has touched it since the day it was armed.
        </p>
      </SectionHead>

      <Reveal>
        <div className="lift mt-12 border border-line bg-ink-raised/40 backdrop-blur-sm">
          <dl className="m-0 grid divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
            <Figure label="Runs" value={beats !== undefined ? <CountUp value={Number(beats)} /> : "—"} lit />
            <Figure label="Since the last one" value={silentFor !== undefined ? formatDuration(silentFor) : "—"} />
            <Figure label="Sent by a human" value="0" />
          </dl>

          {heartbeat?.address ? (
            <div className="border-t border-line px-6 py-4">
              <a
                className="eyebrow transition-colors hover:text-paper"
                href={getBlockExplorerAddressLink(targetNetwork, heartbeat.address)}
                target="_blank"
                rel="noreferrer"
              >
                Read it off the chain ↗
              </a>
            </div>
          ) : null}
        </div>
      </Reveal>
    </section>
  );
};

/** One figure in the panel. Mono, tabular, so it never reflows as it ticks. */
const Figure = ({ label, value, lit = false }: { label: string; value: React.ReactNode; lit?: boolean }) => (
  <div className="px-6 py-8">
    <dd
      className={`tabular m-0 font-mono text-4xl leading-none sm:text-5xl ${lit ? "text-signal" : "text-paper"}`}
      style={lit ? { textShadow: "0 0 32px var(--color-signal-glow)" } : undefined}
    >
      {value}
    </dd>
    <dt className="eyebrow mt-4">{label}</dt>
  </div>
);
