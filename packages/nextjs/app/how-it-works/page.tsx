import Link from "next/link";
import { Chain } from "./_components/Chain";
import { Gate } from "./_components/Gate";
import type { NextPage } from "next";
import { Cadence } from "~~/app/_components/Cadence";
import { ContractLedger } from "~~/app/_components/ContractLedger";
import { TwoSources } from "~~/app/_components/TwoSources";

export const metadata = { title: "How it works" };

/**
 * The argument, in the order it has to be made.
 *
 * Four moves: the network is the keeper; the successor is booked before the
 * work; the strategy owns the tempo; and the whole thing can refuse. Each one
 * gets the drawing it needs, because three of the four are invisible by
 * construction — a chain that continues, a wait that lengthens, a sale that
 * does not happen.
 */
const HowItWorks: NextPage = () => (
  <div className="flex w-full grow flex-col pb-28">
    <div className="shell">
      <header className="glowfield pt-14 pb-16 sm:pt-20">
        <p className="eyebrow m-0">How it works</p>
        <h1 className="display mt-8 mb-0 text-[clamp(2.2rem,6.4vw,6rem)]">
          A contract cannot wake up.
          <br />
          <span className="text-signal">On Hedera it no longer has to.</span>
        </h1>
        <p className="mt-10 mb-0 max-w-2xl text-lg leading-relaxed text-paper-dim">
          Every piece of on-chain automation in production is a contract plus an off-chain process that pokes it — a
          keeper, a cron job, a funded relayer with an uptime problem. HIP-1215 lets a contract schedule its own next
          call from inside the EVM, and the consensus nodes execute it.
        </p>
      </header>

      <Move
        n="01"
        title="It books its successor before it does any work."
        lede="A scheduled execution is the only chance to book the next one. If planning reverted and took the booking with it, the chain would end there — silently, with a transaction that reported success. So the order is not a detail; it is the design."
      >
        <Chain />
        <Aside>
          Run 03 refuses and the chain continues anyway. A strategy that reverts costs one run, never the chain — and
          because <code className="text-paper">executeScheduled</code> has no access control, anyone can restart one
          that stopped.
        </Aside>
      </Move>

      <Move
        n="02"
        title="The strategy owns the tempo, not the vault."
        lede="There is no correct constant. Checking hourly costs about 38 HBAR a day whether or not anything is happening; checking daily can sleep through the move it exists to catch. Only the strategy knows which of those is currently wrong, so nextInterval() sits on the interface beside plan()."
      >
        <Cadence />
        <Aside>
          Hedera&apos;s own <code className="text-paper">ScheduledVault</code> takes one fixed interval and its strategy
          interface returns actions only. The use case in their documentation —{" "}
          <em>contracts schedule increasingly frequent monitoring as positions approach liquidation</em> — cannot be
          expressed in it.
        </Aside>
      </Move>

      <Move
        n="03"
        title="It can refuse, and say why on chain."
        lede="A stop-loss that trusts one price can be triggered by whoever last moved that price. Two sources have to agree within a tolerance you set before anything is sold — and when they do not, the vault records the reason and looks again sooner."
      >
        <Gate />

        {/*
          What the guard is looking at right now, read from testnet in the
          reader's browser. It sits under the drawing rather than on the
          landing page because it answers "is that real?", which is a question
          somebody only asks once they have understood the drawing.
        */}
        <div className="mt-10">
          <TwoSources />
        </div>

        <Aside>
          On <strong className="text-paper">11 July 2026</strong> an attacker pushed one oracle price twelve orders of
          magnitude and took <strong className="text-paper">$9.05M</strong> out of Bonzo Lend — about 40% of
          Hedera&apos;s TVL in a day. Automation that believes a single feed is not a safety tool; it is a liquidation
          bot working for whoever moved the price.
        </Aside>
      </Move>

      <Move
        n="04"
        title="And it pays for itself, until it cannot."
        lede="The vault is the schedule's payer, so it funds its own future gas. What it must hold is not what a run costs — the network tests it against the whole gas allowance and then charges for the gas burned, and those differ by more than a factor of two."
      >
        <div className="grid sm:grid-cols-3 gap-px bg-line border border-line">
          {[
            { k: "Reserved per run", v: "3.27", u: "HBAR", note: "3,000,000 gas at 109 tinybar" },
            { k: "Actually charged", v: "1.63", u: "HBAR", note: "about 1.43M gas burned" },
            { k: "Dies holding", v: "2.76", u: "HBAR", note: "more than a run costs" },
          ].map(x => (
            <div key={x.k} className="bg-ink-raised p-6">
              <div className="eyebrow mb-3">{x.k}</div>
              <div className="tabular font-mono text-3xl leading-none">
                {x.v} <span className="text-sm text-paper-faint">{x.u}</span>
              </div>
              <div className="text-xs text-paper-faint mt-2">{x.note}</div>
            </div>
          ))}
        </div>
        <Aside>
          That gap killed the first demo vault with money still in it. It is the fifth of six failures documented in{" "}
          <Link className="link text-paper" href="/docs/landmines">
            the landmines
          </Link>
          , each measured on testnet with the command that measured it.
        </Aside>
      </Move>

      {/*
        The addresses, at the end, where a reader who wants to check them has
        already decided to. Six rows of hex on the way in is six rows of hex
        between somebody and the point.
      */}
      <section className="mt-24 border-t border-line pt-14">
        <h2 className="display m-0 max-w-2xl text-[clamp(1.6rem,3.2vw,2.75rem)]">All of it, on testnet.</h2>
        <p className="mt-5 mb-8 max-w-2xl leading-relaxed text-paper-dim">
          Every contract this template deploys, with verified source. The table is read from the deployment file, so it
          cannot drift from what is actually on chain.
        </p>
        <ContractLedger />
      </section>

      <section className="mt-24 border-t border-line pt-14">
        <h2 className="display m-0 max-w-2xl text-[clamp(1.6rem,3.2vw,2.75rem)]">Then you close the tab.</h2>
        <p className="mt-5 mb-8 max-w-2xl text-paper-dim leading-relaxed">
          After the transaction that arms it, the owner sends nothing. Every execution afterwards is the network calling
          the vault, and the vault paying its own fee. The way to check that is the transfer list — not the transaction
          id, which carries the account that created the schedule and makes it look as though somebody sent the call.
        </p>
        <Link className="link text-paper" href="/">
          See it running →
        </Link>
      </section>
    </div>
  </div>
);

const Move = ({ n, title, lede, children }: { n: string; title: string; lede: string; children: React.ReactNode }) => (
  <section className="mt-24 border-t border-line pt-14">
    {/*
      The number and the claim on the left, the argument on the right, the
      drawing under both. Same split the landing page uses, so a reader who
      arrives here from it does not have to learn a second layout.
    */}
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <p className="eyebrow m-0 mb-5">{n}</p>
        <h2 className="display m-0 text-[clamp(1.6rem,3.2vw,2.75rem)]">{title}</h2>
      </div>
      <p className="m-0 max-w-xl leading-relaxed text-paper-dim lg:pt-8">{lede}</p>
    </div>
    <div className="mt-12">{children}</div>
  </section>
);

/** A note under a drawing: the fact that makes it matter. */
const Aside = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-7 mb-0 max-w-2xl border-l-2 border-line-bright pl-5 text-sm leading-relaxed text-paper-dim">
    {children}
  </p>
);

export default HowItWorks;
