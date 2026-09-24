import Link from "next/link";
import { Chain } from "./_components/Chain";
import { Gate } from "./_components/Gate";
import type { NextPage } from "next";
import { Cadence } from "~~/app/_components/Cadence";

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
  <div className="flex flex-col items-center grow w-full px-5 sm:px-8 pb-32">
    <div className="w-full max-w-5xl">
      <header className="night pt-20 pb-16 sm:pt-28">
        <p className="eyebrow m-0">How it works</p>
        <h1 className="display text-[3rem] sm:text-[5rem] mt-7 mb-0 max-w-4xl">
          A contract cannot wake up.
          <br />
          <span className="text-brass">On Hedera it no longer has to.</span>
        </h1>
        <p className="mt-7 mb-0 max-w-2xl text-lg leading-relaxed text-paper-dim">
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

      <section className="pt-14 mt-20 rule">
        <h2 className="font-display text-3xl sm:text-4xl leading-tight m-0 max-w-2xl">Then you close the tab.</h2>
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
  <section className="pt-14 mt-20 rule first-of-type:mt-0">
    <div className="grid lg:grid-cols-[4rem_1fr] gap-x-8">
      <span className="eyebrow pt-2 self-start">{n}</span>
      <div>
        <h2 className="display text-3xl sm:text-[2.75rem] m-0 max-w-3xl">{title}</h2>
        <p className="mt-5 mb-10 max-w-2xl text-paper-dim leading-relaxed">{lede}</p>
        {children}
      </div>
    </div>
  </section>
);

/** A note under a drawing: the fact that makes it matter. */
const Aside = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-7 mb-0 max-w-2xl border-l-2 border-line-bright pl-5 text-sm leading-relaxed text-paper-dim">
    {children}
  </p>
);

export default HowItWorks;
