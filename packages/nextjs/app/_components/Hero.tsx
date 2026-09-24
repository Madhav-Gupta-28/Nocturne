"use client";

import { formatDuration, useNow } from "./ui";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * The opening, and the whole argument in one screen.
 *
 * What this system does is invisible: nothing happens, correctly, while nobody
 * is watching. A page about that cannot open with a paragraph claiming it — so
 * the claim *is* the live number, with a clock beside it that moves on its own.
 * A reader who doubts the page can watch the second hand.
 *
 * `Heartbeat` is a contract with one job: record that somebody called it. Every
 * count on it was placed by a vault executing a schedule the network fired. It
 * is shown before any wallet is connected, because the claim is about the chain
 * rather than about the visitor.
 */
export const Hero = () => {
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
    <header className="night pt-20 pb-12 sm:pt-28 sm:pb-16">
      <p className="eyebrow rise m-0">Recurring on-chain jobs, without a keeper</p>

      <h1
        className="display rise m-0 mt-7 text-[3.25rem] sm:text-[5.5rem] lg:text-[6.75rem]"
        style={{ animationDelay: "60ms" }}
      >
        Close the tab.
        <br />
        <span className="text-brass">It already happened.</span>
      </h1>

      <div className="rise mt-12 grid lg:grid-cols-2 gap-x-16 gap-y-10 items-start" style={{ animationDelay: "160ms" }}>
        <p className="m-0 max-w-xl text-lg leading-relaxed text-paper-dim">
          A vault that books its own next execution with the Hedera Schedule Service. No keeper, no bot, no cron job on
          somebody&apos;s laptop — the thing that fires at 4am is the network itself.
        </p>

        {/*
          The evidence, set as an instrument panel rather than prose. A reader
          who doubts the claim can watch the second figure move.
        */}
        <div className="border border-line bg-ink-raised/60">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="eyebrow flex items-center gap-2">
              <span className="alive inline-block w-1.5 h-1.5 rounded-full bg-brass" aria-hidden />
              Live · Hedera testnet
            </span>
            {heartbeat?.address ? (
              <a
                className="eyebrow hover:text-paper transition-colors"
                href={getBlockExplorerAddressLink(targetNetwork, heartbeat.address)}
                target="_blank"
                rel="noreferrer"
              >
                Verify ↗
              </a>
            ) : null}
          </div>

          <dl className="m-0 divide-y divide-line">
            <Row label="Executions nobody sent" value={beats?.toString() ?? "—"} big />
            <Row label="Since the last one" value={silentFor !== undefined ? formatDuration(silentFor) : "—"} />
            <Row label="Sent by the owner" value="0" />
          </dl>

          <p className="m-0 border-t border-line px-5 py-4 text-xs leading-relaxed text-paper-faint">
            Each one was placed by a vault paying its own fee. The owner&apos;s account appears once, for the
            transaction that armed it, and never again.
          </p>
        </div>
      </div>
    </header>
  );
};

/** One figure in the panel. Mono, tabular, right-aligned so the column holds. */
const Row = ({ label, value, big = false }: { label: string; value: string; big?: boolean }) => (
  <div className="flex items-baseline justify-between gap-6 px-5 py-4">
    <dt className="eyebrow">{label}</dt>
    <dd className={`tabular m-0 font-mono ${big ? "text-4xl text-brass" : "text-xl"}`}>{value}</dd>
  </div>
);
