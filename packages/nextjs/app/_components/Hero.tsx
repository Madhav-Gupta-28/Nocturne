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
    <header className="pt-16 pb-14 sm:pt-24 sm:pb-20">
      <p className="label rise m-0">Recurring on-chain jobs, without a keeper</p>

      <h1
        className="rise font-display m-0 mt-5 text-[2.75rem] sm:text-6xl lg:text-7xl leading-[0.98] tracking-[-0.02em] text-balance"
        style={{ animationDelay: "60ms" }}
      >
        Close the tab.
        <br />
        <span className="text-paper-dim">Come back. It already happened.</span>
      </h1>

      <p
        className="rise mt-7 mb-0 max-w-2xl text-lg leading-relaxed text-paper-dim"
        style={{ animationDelay: "140ms" }}
      >
        A vault that books its own next execution with the Hedera Schedule Service. No keeper, no bot, no cron job on
        somebody&apos;s laptop — the thing that fires at 4am is the network itself.
      </p>

      {/* The evidence, given the weight of the headline rather than a card. */}
      <div
        className="rise mt-14 border-t border-line pt-8 flex flex-wrap items-end gap-x-14 gap-y-8"
        style={{ animationDelay: "220ms" }}
      >
        <div>
          <div className="label mb-3 flex items-center gap-2">
            <span className="alive inline-block w-1.5 h-1.5 rounded-full bg-brass" aria-hidden />
            Executions nobody sent
          </div>
          <div className="tabular font-display text-7xl sm:text-8xl leading-[0.85] text-brass">
            {beats?.toString() ?? "—"}
          </div>
        </div>

        <div className="pb-2">
          <div className="label mb-3">Since the last one</div>
          <div className="tabular font-mono text-3xl leading-none">
            {silentFor !== undefined ? formatDuration(silentFor) : "—"}
          </div>
        </div>

        <p className="pb-2 m-0 max-w-xs text-sm leading-relaxed text-paper-dim">
          Each one was placed by a vault paying its own fee. The owner&apos;s account appears once, for the transaction
          that armed it.{" "}
          {heartbeat?.address ? (
            <a
              className="link text-paper whitespace-nowrap"
              href={getBlockExplorerAddressLink(targetNetwork, heartbeat.address)}
              target="_blank"
              rel="noreferrer"
            >
              Check the counter →
            </a>
          ) : null}
        </p>
      </div>
    </header>
  );
};
