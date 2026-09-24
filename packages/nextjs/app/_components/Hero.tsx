"use client";

import Link from "next/link";
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
 *
 * It is set centred and against the sky, which is the one place on this site
 * where the layout is symmetrical. Everything after it returns to the left
 * margin — the opening is a title card, not the first section.
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
    <header className="night flex flex-col items-center pt-16 pb-10 text-center sm:pt-24 sm:pb-16">
      <p className="eyebrow rise m-0 flex items-center gap-2.5 border border-line bg-ink-raised/60 px-3.5 py-1.5">
        <span className="alive inline-block h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
        Live on Hedera testnet
      </p>

      <h1
        className="display rise m-0 mt-8 text-[2.75rem] text-balance sm:text-[4.5rem] lg:text-[5.25rem]"
        style={{ animationDelay: "60ms" }}
      >
        Close the tab.
        <br />
        <span className="text-signal">It already happened.</span>
      </h1>

      <p
        className="rise m-0 mt-8 max-w-2xl text-balance text-base leading-relaxed text-paper-dim sm:text-lg"
        style={{ animationDelay: "140ms" }}
      >
        A vault that books its own next execution with the Hedera Schedule Service. No keeper, no bot, no cron job on
        somebody&apos;s laptop — the thing that fires at 4am is the network itself.
      </p>

      <div className="rise mt-10 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "220ms" }}>
        {/*
          Outlines rather than a filled accent button. Moonlight is spent as
          light on this site, and a solid block of it here would turn the one
          colour the page has into a brand button.
        */}
        <a
          href="#vault"
          className="border border-paper px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-paper hover:text-ink"
        >
          Arm a vault
        </a>
        <Link
          href="/how-it-works"
          className="border border-line px-6 py-3 text-sm font-medium text-paper-dim transition-colors hover:border-line-bright hover:text-paper"
        >
          See what it does at 4am →
        </Link>
      </div>

      {/*
        The evidence, set as an instrument panel rather than prose. A reader who
        doubts the claim can watch the second figure move, then follow the link
        and read the same number off the chain.
      */}
      <div
        className="rise mt-16 w-full border border-line bg-ink-raised/50 text-left backdrop-blur-sm"
        style={{ animationDelay: "300ms" }}
      >
        <dl className="m-0 grid divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
          <Figure label="Executions nobody sent" value={beats?.toString() ?? "—"} lit />
          <Figure label="Since the last one" value={silentFor !== undefined ? formatDuration(silentFor) : "—"} />
          <Figure label="Sent by the owner" value="0" />
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="m-0 max-w-xl text-xs leading-relaxed text-paper-faint">
            Each one was placed by a vault paying its own fee. The owner&apos;s account appears once, for the
            transaction that armed it, and never again.
          </p>
          {heartbeat?.address ? (
            <a
              className="eyebrow shrink-0 transition-colors hover:text-paper"
              href={getBlockExplorerAddressLink(targetNetwork, heartbeat.address)}
              target="_blank"
              rel="noreferrer"
            >
              Read it off the chain ↗
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
};

/** One figure in the panel. Mono, tabular, so it never reflows as it ticks. */
const Figure = ({ label, value, lit = false }: { label: string; value: string; lit?: boolean }) => (
  <div className="px-5 py-6">
    <dd className={`tabular m-0 font-mono text-3xl leading-none sm:text-4xl ${lit ? "text-signal" : "text-paper"}`}>
      {value}
    </dd>
    <dt className="eyebrow mt-3">{label}</dt>
  </div>
);
