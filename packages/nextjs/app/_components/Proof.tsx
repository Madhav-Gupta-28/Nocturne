"use client";

import { SectionHead } from "./SectionHead";
import { TwoSources } from "./TwoSources";
import { Reveal } from "./motion";

/**
 * Two runs of one vault, both sent by the network, both on the record.
 *
 * The claim is not that a contract can call itself — a counter proves that and
 * nobody cares. It is that a contract can be trusted to act on money with
 * nobody watching, and the only honest evidence for that is the pair: it
 * declined when its two price sources disagreed, and it traded when told the
 * gap was acceptable. Either half alone proves nothing. A vault that only ever
 * refuses might be broken; one that only ever trades might not be checking.
 *
 * Every figure below was read back from the mirror node, not remembered. The
 * evidence is on testnet whichever network the site is pointed at, so the
 * links are too.
 */

const HASHSCAN = "https://hashscan.io/testnet";

const VAULT = "0.0.10690925";

const RUNS = [
  {
    run: 1,
    verdict: "Refused",
    headline: "Sources disagree",
    rows: [
      ["SaucerSwap TWAP", "$2.0503"],
      ["Chainlink", "$0.0915"],
      ["Apart", "22.4×"],
    ],
    outcome: "Sold nothing. Wrote down why.",
    fee: "1.78",
    tx: "1790220055.062657433",
  },
  {
    run: 2,
    verdict: "Executed",
    headline: "0.1 WHBAR → 0.204405 USDC",
    rows: [
      ["Actions", "approve, swap"],
      ["Venue", "SaucerSwap V2"],
      ["Tolerance", "widened on purpose"],
    ],
    outcome: "Swapped through the router, inside the scheduled call.",
    fee: "2.62",
    tx: "1790220899.081501493",
  },
] as const;

export const Proof = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead id="proof" title="It said no. Then it sold.">
      <p>
        A vault on Hedera testnet held 0.1 WHBAR against the live SaucerSwap pool and the live Chainlink feed. Nobody
        sent either of these transactions. The vault paid for both.
      </p>
    </SectionHead>

    <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
      {RUNS.map((r, i) => (
        <Reveal key={r.run} delay={i * 0.08}>
          <Run {...r} />
        </Reveal>
      ))}
    </div>

    <Reveal>
      <p className="mb-0 mt-6 text-sm leading-relaxed text-paper-faint">
        Run 3 refused too — <span className="text-paper-dim">nothing held</span>. It does not sell twice.{" "}
        <a className="link text-paper-dim" href={`${HASHSCAN}/contract/${VAULT}`} target="_blank" rel="noreferrer">
          The whole vault on HashScan ↗
        </a>
      </p>
    </Reveal>

    {/*
      The same two sources, read now, in your browser. The runs above are
      history; this is what a vault armed today would see.
    */}
    <Reveal>
      <p className="eyebrow mb-5 mt-16">Live · what the guard sees right now</p>
      <TwoSources />
    </Reveal>
  </section>
);

type RunProps = (typeof RUNS)[number];

const Run = ({ run, verdict, headline, rows, outcome, fee, tx }: RunProps) => {
  const refused = verdict === "Refused";

  return (
    <article
      className={`lift flex h-full flex-col border bg-ink-raised/40 backdrop-blur-sm ${
        refused ? "border-line" : "border-signal/40"
      }`}
    >
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow">Run {run}</span>
        <span className={`eyebrow ${refused ? "text-signal-dead" : "text-signal"}`}>{verdict}</span>
      </header>

      <div className="flex grow flex-col px-6 py-7">
        <p className="m-0 font-mono text-2xl leading-tight text-paper sm:text-[1.7rem]">{headline}</p>

        <dl className="m-0 mt-7 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-paper-faint">{k}</dt>
              <dd className="tabular m-0 text-right font-mono text-paper-dim">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mb-0 mt-7 text-sm leading-relaxed text-paper-dim">{outcome}</p>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
        <span className="eyebrow">
          Fee {fee} HBAR · paid by the vault · <span className="text-paper">sent by a human: 0</span>
        </span>
        <a
          className="eyebrow transition-colors hover:text-paper"
          href={`${HASHSCAN}/transaction/${tx}`}
          target="_blank"
          rel="noreferrer"
        >
          Transaction ↗
        </a>
      </footer>
    </article>
  );
};
