"use client";

import { formatDuration, useNow } from "./ui";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * The opening, and the whole argument in one screen.
 *
 * The thing this system does is invisible: nothing happens, correctly, while
 * nobody is watching. A page about that cannot open with a paragraph claiming
 * it — the claim has to *be* the live number, with a clock underneath it moving
 * on its own so the page is visibly not a screenshot.
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

  // Ticked locally rather than polled, so the number moves every second while
  // the chain is only read every few.
  const everBeaten = beats !== undefined && beats > 0n;
  const silentFor = lastBeatAt ? now - Number(lastBeatAt) : undefined;

  return (
    <header className="flex flex-col gap-8 pt-6 pb-10">
      <div className="flex flex-col gap-4">
        <p className="uppercase tracking-[0.2em] text-xs opacity-50 m-0">Recurring on-chain jobs, without a keeper</p>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold m-0 leading-[1.05] text-balance">
          Close the tab. <span className="hedera-gradient-text">Come back. It already happened.</span>
        </h1>
        <p className="opacity-70 max-w-2xl m-0 text-lg">
          A vault that books its own next execution with the Hedera Schedule Service. No keeper, no bot, no cron job on
          somebody&apos;s laptop — the thing that fires at 4am is the network itself.
        </p>
      </div>

      {/* The evidence, given the weight of the headline rather than a card. */}
      <div className="flex flex-wrap items-end gap-x-12 gap-y-6 border-t border-base-300 pt-8">
        <div>
          <div className="text-7xl font-bold tabular-nums leading-none hedera-gradient-text">
            {beats?.toString() ?? "—"}
          </div>
          <div className="text-sm opacity-60 mt-2">executions nobody sent</div>
        </div>

        <div className="pb-1">
          <div className="text-2xl font-semibold tabular-nums leading-none">
            {everBeaten && silentFor !== undefined ? formatDuration(silentFor) : "—"}
          </div>
          <div className="text-sm opacity-60 mt-2">since the last one</div>
        </div>

        <p className="text-sm opacity-60 m-0 max-w-xs pb-1">
          Every one was placed by a vault paying its own fee. The owner&apos;s account appears once, for the transaction
          that armed it.{" "}
          {heartbeat?.address ? (
            <a
              className="link"
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
