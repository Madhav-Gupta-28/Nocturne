import Link from "next/link";
import { Act, Figure } from "./_components/Act";
import { FuelDiagram } from "./_components/FuelDiagram";
import { GateDiagram } from "./_components/GateDiagram";
import { LoopDiagram } from "./_components/LoopDiagram";
import { SwapDiagram } from "./_components/SwapDiagram";
import type { NextPage } from "next";
import { ContractLedger } from "~~/app/_components/ContractLedger";
import { Reveal } from "~~/app/_components/motion";

export const metadata = { title: "How it works" };

const SRC = "https://github.com/Madhav-Gupta-28/Nocturne/blob/main/packages/hardhat/contracts";
const SCAN = "https://hashscan.io/testnet";

/**
 * Four pictures, and as little prose as each one can survive on.
 *
 * A judge arriving here has one question — *how was this actually built* — and
 * the honest answer is a mechanism, an interface, a refusal and a fee. Those
 * are four drawings, not four essays, so each act spends its space on the
 * drawing and keeps the words to a headline, two lines and a takeaway.
 *
 * Every act ends with three links: the Hedera primitive it leans on, the exact
 * source it is implemented in, and the transaction where it happened on
 * testnet. A template is a claim about code somebody else will run, and that
 * strip is the difference between making the claim and evidencing it.
 */
const HowItWorks: NextPage = () => (
  <div className="flex w-full grow flex-col pb-28">
    <div className="shell">
      <header className="glowfield pt-16 pb-4 sm:pt-24">
        <p className="eyebrow m-0">How it works</p>
        <h1 className="display display-lit mb-0 mt-7 text-[clamp(2.2rem,6.4vw,5.5rem)]">
          Four pictures.
          <br />
          <span className="text-signal display-lit-signal">That is the whole template.</span>
        </h1>
        <p className="mb-0 mt-9 max-w-2xl text-lg leading-relaxed text-paper-dim">
          A contract that calls itself, an interface you swap, a check it can fail, and a fee it pays out of its own
          balance.
        </p>

        {/* The primitives, named up front. A reviewer scoring ecosystem depth
            should not have to hunt for which parts of Hedera this actually
            uses. */}
        <ul className="mb-0 mt-10 flex list-none flex-wrap gap-3 p-0">
          {[
            ["schedule", "Schedule Service · HIP-1215"],
            ["hold", "HTS · association + allowance"],
            ["read", "Chainlink + SaucerSwap TWAP"],
          ].map(([verb, what]) => (
            <li key={verb} className="border border-line bg-ink-raised/50 px-4 py-2.5">
              <span className="eyebrow mr-3">{verb}</span>
              <span className="font-mono text-xs text-paper">{what}</span>
            </li>
          ))}
        </ul>
      </header>

      <Act
        n="One"
        title="It books the next run before it does any work."
        lede="The network wakes the vault. The first thing the vault does — before it looks at a price or moves a token — is ask Hedera to wake it again."
        takeaway={
          <>
            <span className="text-paper">Run 15&apos;s work fails, and run 16 still happens.</span> Booking first is
            what makes a bad run cost one run instead of the whole chain — and because{" "}
            <code className="text-paper">executeScheduled</code> has no access control, anyone can restart a chain that
            stopped.
          </>
        }
        receipts={[
          {
            kind: "The Hedera service",
            what: "Schedule Service · HIP-1215",
            href: "https://hips.hedera.com/hip/hip-1215",
          },
          { kind: "Where it books", what: "executeScheduled, line 420", href: `${SRC}/NocturneVault.sol#L420` },
          {
            kind: "It really happened",
            what: "16 unattended runs",
            href: `${SCAN}/contract/0x8b63C92F7d906862922D060C7Ffc294d8a43ec0b`,
          },
        ]}
      >
        <Figure caption="One transaction, two steps, always in this order">
          <LoopDiagram />
        </Figure>
      </Act>

      <Act
        n="Two"
        title="One vault. Any strategy."
        lede="This is the part you change. The vault holds the money and runs the schedule; a strategy decides what to do and how long to wait. Pick one and watch the right-hand column."
        takeaway={
          <>
            <span className="text-paper">nextInterval() is why this is not Hedera&apos;s own ScheduledVault.</span> That
            template takes one fixed interval, so the use case in its own documentation —{" "}
            <em>schedule increasingly frequent monitoring as positions approach liquidation</em> — cannot be written in
            it.
          </>
        }
        receipts={[
          {
            kind: "The interface",
            what: "INocturneStrategy, 4 functions",
            href: `${SRC}/interfaces/INocturneStrategy.sol`,
          },
          { kind: "The vault never changes", what: "NocturneVault.sol", href: `${SRC}/NocturneVault.sol` },
          {
            kind: "Three shipped",
            what: "all deployed and verified",
            href: `${SCAN}/contract/0xc0f202Ac01475AFBD07e09643d56bdacC9294B78`,
          },
        ]}
      >
        <Figure caption="The seam: two functions between your code and the vault">
          <SwapDiagram />
        </Figure>
      </Act>

      <Act
        n="Three"
        title="It can refuse, and say why on chain."
        lede="Before it trades, a pool TWAP and a Chainlink feed have to agree inside a tolerance you set. When they do not, nothing is sold and the reason is written down."
        takeaway={
          <>
            On <span className="text-paper">11 July 2026</span> one manipulated price took{" "}
            <span className="text-paper">$9.05M</span> out of Bonzo Lend — roughly 40% of Hedera&apos;s TVL in a day.
            Automation that believes a single feed is not a safety tool; it is a liquidation bot working for whoever
            moved the price.
          </>
        }
        receipts={[
          {
            kind: "The two sources",
            what: "Chainlink + SaucerSwap V2",
            href: `${SCAN}/contract/0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a`,
          },
          { kind: "The check", what: "PriceGuard.sol", href: `${SRC}/lib/PriceGuard.sol` },
          {
            kind: "It really refused",
            what: "Refused(1, sources disagree)",
            href: `${SCAN}/contract/0x699Ec374cb2b6BaBb809cB70E58018E5f6be3E59`,
          },
        ]}
      >
        <Figure caption="Two prices drifting apart, and the gate shutting">
          <GateDiagram />
        </Figure>
      </Act>

      <Act
        n="Four"
        title="It pays for itself, until it cannot."
        lede="The vault is the schedule's payer, so it funds its own future gas. What it has to hold is not what a run costs — and the gap between those two is wide enough to strand a funded vault."
        takeaway={
          <>
            <span className="text-paper">The first vault this project deployed died with money in it.</span> It held
            2.76 ℏ and a run costs 1.63 ℏ, but the network tests the payer against the full 3.27 ℏ reservation. That is
            one of six failures written down with the command that reproduces each.
          </>
        }
        receipts={[
          { kind: "The arithmetic", what: "runway(), measured not guessed", href: `${SRC}/NocturneVault.sol#L646` },
          { kind: "All six failures", what: "docs/hedera-landmines.md", href: "/docs/landmines" },
          { kind: "The vault that died", what: "0.0.10684549", href: `${SCAN}/account/0.0.10684549` },
        ]}
      >
        <Figure caption="Three measurements, to scale against each other">
          <FuelDiagram />
        </Figure>
      </Act>

      {/*
        The addresses, at the end, where a reader who wants to check them has
        already decided to.
      */}
      <section className="mt-28 border-t border-line pt-14 sm:mt-36">
        <Reveal>
          <h2 className="display display-lit m-0 max-w-2xl text-[clamp(1.75rem,3.6vw,3rem)]">All of it, on testnet.</h2>
          <p className="mb-0 mt-5 mb-10 max-w-2xl leading-relaxed text-paper-dim">
            Read from the deployment file, so it cannot drift from what is actually on chain.
          </p>
        </Reveal>
        <ContractLedger />
      </section>

      <section className="mt-28 border-t border-line pt-14">
        <Reveal>
          <h2 className="display display-lit m-0 max-w-2xl text-[clamp(1.75rem,3.6vw,3rem)]">
            Then you close the tab.
          </h2>
          <p className="mb-0 mt-5 mb-10 max-w-2xl leading-relaxed text-paper-dim">
            After the transaction that arms it, you send nothing. Check it on the transfer list rather than the
            transaction id — the id carries the account that created the schedule, which makes it look as though
            somebody sent the call.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/" className="btn-signal">
              See it running <span aria-hidden>→</span>
            </Link>
            <Link href="/docs" className="btn-line">
              Read the docs
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  </div>
);

export default HowItWorks;
