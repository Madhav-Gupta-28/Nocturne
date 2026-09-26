"use client";

import { useRef } from "react";
import { SectionHead } from "./SectionHead";
import { EASE, Reveal } from "./motion";
import { formatDuration, useNow } from "./ui";
import { motion, useInView, useReducedMotion } from "framer-motion";
import type { Address } from "viem";
import { useVaultStatus } from "~~/hooks/useNocturneVault";

/**
 * Same code, same 2% rule, two markets — and one vault still on duty.
 *
 * The claim is not that a contract can call itself. It is that one can be
 * trusted to act on money with nobody watching, and the honest evidence is a
 * pair: it refused a market whose price was wrong, and sold into one whose
 * price was right. Either half alone proves nothing.
 *
 * The gap is drawn, not described. Two bars per market, to scale: on WHBAR one
 * bar is twenty-two times the other; on DAI they are the same length. A reader
 * sees why the vault decided what it did before reading a word.
 *
 * Every figure in `RUNS` was read back from the mirror node after the fact.
 */

const HASHSCAN = "https://hashscan.io/testnet";

type Run = {
  asset: string;
  refused: boolean;
  verdict: string;
  /** What happened to the position, as the mirror node recorded it. */
  result: string;
  pool: number;
  feed: number;
  apart: string;
  fee: string;
  tx: string;
};

const RUNS: Run[] = [
  {
    asset: "WHBAR",
    refused: true,
    verdict: "Refused to sell",
    result: "Kept all 0.1 WHBAR",
    pool: 2.0382,
    feed: 0.092,
    apart: "22× apart",
    fee: "1.81",
    tx: "1790319391.014683746",
  },
  {
    asset: "DAI",
    refused: false,
    verdict: "Sold 1 DAI",
    result: "For 1.001757 USDC",
    pool: 1.0023,
    feed: 0.9999,
    apart: "0.24% apart",
    fee: "2.64",
    tx: "1790319308.034520104",
  },
];

/** The DAI depeg guard left running: floor $0.85, checked every six hours. */
const ON_DUTY: Address = "0xaFa895f727Fb0287fCB3E08DD9dA13287356837f";

/**
 * The same vault as a Hedera account. Scheduled runs are listed on HashScan's
 * account page; the contract page shows only calls sent over JSON-RPC.
 */
const ON_DUTY_ACCOUNT = "0.0.10710268";

export const Proof = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead id="proof" title="Same rule. Two markets.">
      <p>
        Two vaults on testnet, same code, both told to stay within 2%.{" "}
        <span className="text-paper">One refused. One sold. Nobody sent either run.</span>
      </p>
    </SectionHead>

    <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
      {RUNS.map((r, i) => (
        <Reveal key={r.asset} delay={i * 0.08}>
          <RunCard run={r} />
        </Reveal>
      ))}
    </div>

    <Reveal>
      <OnDuty vault={ON_DUTY} account={ON_DUTY_ACCOUNT} />
    </Reveal>
  </section>
);

const RunCard = ({ run }: { run: Run }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const still = useReducedMotion();
  const top = Math.max(run.pool, run.feed);
  const tone = run.refused ? "text-signal-dead" : "text-signal";

  return (
    <article
      ref={ref}
      className={`lift flex h-full flex-col border bg-ink-raised/40 backdrop-blur-sm ${
        run.refused ? "border-line" : "border-signal/40"
      }`}
    >
      <div className="flex grow flex-col p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{run.asset}</span>
          <span className={`eyebrow ${tone}`}>{run.apart}</span>
        </div>

        <p className={`display m-0 mt-5 text-[clamp(1.9rem,3.4vw,2.75rem)] leading-none ${tone}`}>{run.verdict}</p>
        <p className="mb-0 mt-3 font-mono text-sm text-paper-dim">{run.result}</p>

        <dl className="m-0 mt-8 space-y-4">
          {[
            ["SaucerSwap", run.pool],
            ["Chainlink", run.feed],
          ].map(([name, price], i) => (
            <div key={name as string}>
              <div className="flex items-baseline justify-between">
                <dt className="text-sm text-paper-dim">{name}</dt>
                <dd className="tabular m-0 font-mono text-sm text-paper">${(price as number).toFixed(4)}</dd>
              </div>
              <div className="mt-2 h-2 bg-ink-sunken">
                <motion.div
                  className={`h-full ${run.refused ? (i === 0 ? "bg-signal-dead" : "bg-paper-faint") : "bg-signal"}`}
                  initial={still ? false : { width: 0 }}
                  animate={inView || still ? { width: `${((price as number) / top) * 100}%` } : undefined}
                  transition={{ duration: 1.1, delay: 0.15 + i * 0.12, ease: EASE }}
                />
              </div>
            </div>
          ))}
        </dl>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 sm:px-8">
        <span className="eyebrow">Fee {run.fee} HBAR, paid by the vault</span>
        <a
          className="eyebrow transition-colors hover:text-paper"
          href={`${HASHSCAN}/transaction/${run.tx}`}
          target="_blank"
          rel="noreferrer"
        >
          Transaction ↗
        </a>
      </footer>
    </article>
  );
};

/**
 * The vault that is still working, read live.
 *
 * The cards above are history. This is a vault a reader can watch: the
 * countdown moves in the browser, the run count moves when the network calls
 * it, and nothing here is cached.
 */
const OnDuty = ({ vault, account }: { vault: Address; account: string }) => {
  const now = useNow();
  const { status, decision } = useVaultStatus(vault);
  const due = status ? Number(status.nextRunAt) - now : undefined;

  return (
    <a
      href={`${HASHSCAN}/account/${account}`}
      target="_blank"
      rel="noreferrer"
      className="lift group mt-6 flex flex-wrap items-center gap-x-10 gap-y-4 border border-signal/40 bg-ink-raised/40 px-6 py-5 backdrop-blur-sm transition-colors hover:bg-signal-glow/30 sm:px-8"
    >
      <span className="eyebrow flex items-center gap-2.5 text-signal">
        <span className="alive inline-block h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
        On duty now
      </span>
      <Stat label="DAI depeg guard" value={decision ?? "—"} />
      <Stat label="Runs so far" value={status ? status.runs.toString() : "—"} />
      <Stat label="Next check" value={due === undefined ? "—" : formatDuration(due)} />
      <Stat label="Sent by a human" value="0" />
      <span className="eyebrow ml-auto transition-colors group-hover:text-paper">HashScan ↗</span>
    </a>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <span className="flex flex-col">
    <span className="tabular font-mono text-lg leading-none text-paper">{value}</span>
    <span className="eyebrow mt-1.5">{label}</span>
  </span>
);
