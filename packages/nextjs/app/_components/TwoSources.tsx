"use client";

import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * What the price guard sees, right now, before anything is armed.
 *
 * The most important thing this system does leaves no trace. A vault that
 * declines to sell emits an event and changes nothing — no swap, no balance
 * move, nothing an explorer highlights. So the refusal has to be visible
 * *before* you trust a vault with anything, which is what `PriceLens` is for.
 *
 * On testnet the two sources are wildly apart, because nothing arbitrages a
 * testnet. That is inconvenient for demonstrating a realistic sale and perfect
 * for demonstrating the thing that actually matters.
 */

// Verified on testnet — see ARCHITECTURE.md §3.5.
const POOL = "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a"; // SaucerSwap V2 WHBAR/USDC 0.3%
const HBAR_USD = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a"; // Chainlink HBAR/USD

/** The same struct a strategy is configured with, so this is what it would act on. */
const SOURCES = {
  pool: POOL,
  twapWindow: 60,
  feed: HBAR_USD,
  maxFeedAge: 86_400n, // generous: HBAR/USD updates on deviation as well as heartbeat
  maxDivergenceBps: 200n, // 2% — a realistic tolerance, which testnet will fail
  assetIsToken0: false, // WHBAR is token1 on this pool
  assetDecimals: 8,
  quoteDecimals: 6,
} as const;

type Reading = {
  agreed: boolean;
  twap: bigint;
  feed: bigint;
  divergenceBps: bigint;
  feedAge: bigint;
  reason: string;
};

const usd = (price1e18: bigint) => `$${(Number(price1e18) / 1e18).toFixed(4)}`;

/**
 * How far apart, in the unit a reader can hold. A few percent reads as a
 * percentage; a testnet gap of two thousand percent does not, and "22×" does.
 */
const apart = (r: Reading) => {
  if (r.divergenceBps < 10_000n) return `${(Number(r.divergenceBps) / 100).toFixed(1)}%`;
  const [hi, lo] = r.twap > r.feed ? [r.twap, r.feed] : [r.feed, r.twap];
  return `${(Number(hi) / Number(lo)).toFixed(1)}×`;
};

export const TwoSources = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data } = useScaffoldReadContract({
    contractName: "PriceLens",
    functionName: "read",
    args: [SOURCES],
  });

  const r = data as Reading | undefined;

  return (
    /*
      No heading of its own: the section header above already names this and
      says what it is for, and a panel that repeats its own section title is the
      surest sign a page was assembled rather than composed.
    */
    <div className="lift border border-line bg-ink-raised/40 p-6 backdrop-blur-sm sm:p-9">
      <div className="flex flex-wrap gap-x-16 gap-y-8">
        <Source
          label="SaucerSwap"
          detail="60-second TWAP"
          value={r ? usd(r.twap) : "—"}
          href={getBlockExplorerAddressLink(targetNetwork, POOL)}
        />
        <Source
          label="Chainlink"
          detail={r ? `${Number(r.feedAge)}s old` : "HBAR/USD"}
          value={r ? usd(r.feed) : "—"}
          href={getBlockExplorerAddressLink(targetNetwork, HBAR_USD)}
        />
        <div>
          <div className="eyebrow mb-2">Apart</div>
          <div className="tabular font-mono text-4xl leading-none text-signal">{r ? apart(r) : "—"}</div>
          <div className="text-xs text-paper-faint mt-2">tolerance 2%</div>
        </div>
      </div>

      {r ? (
        <div className="mt-8 border-l-2 border-signal pl-5 py-1">
          <span className="text-sm text-paper-dim block">
            {r.agreed ? (
              <>The sources corroborate each other, so a vault would act on this price.</>
            ) : (
              <>
                <span className="text-paper font-medium">Would refuse to trade</span> — {r.reason}. Nothing is sold, the
                reason is recorded on chain, and the vault looks again sooner.
              </>
            )}
          </span>
        </div>
      ) : null}

      <p className="text-xs text-paper-faint mt-8 mb-0 max-w-2xl leading-relaxed">
        The gap is a testnet artefact: nothing arbitrages a testnet, so the pool drifts and stays drifted. It is the
        wrong place to demonstrate a realistic sale and exactly the right place to demonstrate a refusal.
      </p>
    </div>
  );
};

const Source = ({ label, detail, value, href }: { label: string; detail: string; value: string; href: string }) => (
  <div>
    <div className="eyebrow mb-2">
      <a className="link" href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    </div>
    <div className="tabular font-mono text-4xl leading-none">{value}</div>
    <div className="text-xs text-paper-faint mt-2">{detail}</div>
  </div>
);
