"use client";

import { Cadence } from "./_components/Cadence";
import { CreateVault } from "./_components/CreateVault";
import { Hero } from "./_components/Hero";
import { Proof } from "./_components/Proof";
import { RunTheNight } from "./_components/RunTheNight";
import { SectionHead } from "./_components/SectionHead";
import { TwoSources } from "./_components/TwoSources";
import { VaultDashboard } from "./_components/VaultDashboard";
import { Reveal } from "./_components/motion";
import { Panel } from "./_components/ui";
import type { NextPage } from "next";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/**
 * One page, one claim: this runs without you.
 *
 * It is ordered as an argument rather than as a feature list. The opening makes
 * the claim; `Proof` shows the chain agreeing with it; `RunTheNight` plays the
 * mechanism so the ordering can be watched rather than described; the cadence
 * diagram makes the one point that prose cannot carry; and only then does the
 * page ask for a wallet.
 *
 * Everything numeric on it is read from the chain — the run counter, the
 * countdown, the runway, and the strategy's own words for what it would do
 * next. The one thing a screenshot cannot prove is the thing that matters most,
 * so the page does not ask to be believed: it links to the explorer and says
 * which field to read.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();

  // One vault per owner is the whole model; the factory keeps the mapping so
  // the frontend needs no storage of its own.
  const { data: latest } = useScaffoldReadContract({
    contractName: "NocturneFactory",
    functionName: "latestVaultOf",
    args: [address],
  });

  const vault = latest && latest !== ZERO ? (latest as Address) : undefined;

  return (
    <div className="flex w-full grow flex-col pb-28">
      <Hero />
      <Proof />
      <RunTheNight />
      <Accelerando />

      <section className="shell pt-28 sm:pt-36">
        <SectionHead eyebrow="Read live from testnet" title="Two sources, and what they say.">
          <p>
            A vault will not trade on a single price. Before it acts, a pool TWAP and a Chainlink feed have to agree
            inside a tolerance its owner set — and when they do not, it records the disagreement and looks again sooner.
          </p>
        </SectionHead>
        <Reveal>
          <div className="mt-12">
            <TwoSources />
          </div>
        </Reveal>
      </section>

      {/*
        The wallet is asked for last, and only here. Everything above is true
        whether or not you connect, which is the point of putting it first.
      */}
      <section className="shell pt-28 sm:pt-36">
        <SectionHead
          id="vault"
          eyebrow={isConnected ? "Your vault" : "Connect a wallet"}
          title={vault ? "Your vault, live." : "Arm one yourself."}
        >
          <p>
            Nocturne makes one vault per owner. You choose the strategy and the fuel, sign once to arm it, and then the
            network is the only thing that touches it.
          </p>
        </SectionHead>

        <Reveal>
          <div className="mt-12">
            {!isConnected ? <ConnectPrompt /> : vault ? <VaultDashboard vault={vault} /> : <CreateVault />}
          </div>
        </Reveal>
      </section>

      <HowItWorks />
    </div>
  );
};

const ConnectPrompt = () => (
  <Panel title="No wallet connected">
    <p className="m-0 text-paper-dim">
      Connect one to build a vault, fund it, and arm it. Nothing above this line needed a wallet, and nothing above it
      changes when you connect one.
    </p>
  </Panel>
);

/**
 * The claim that needs a picture rather than a sentence.
 *
 * Every other point on this page can be made in prose. This one cannot: "the
 * strategy chooses the interval" means nothing until you watch the checks bunch
 * up as the floor gets close.
 */
const Accelerando = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead id="cadence" eyebrow="Interval chosen per run, not per vault" title="Cheap to watch. Until it is not.">
      <p>
        The strategy picks the interval, not the vault. Hedera&apos;s own{" "}
        <code className="text-paper">ScheduledVault</code> takes one fixed number, so the use case in their own
        documentation — <em>contracts schedule increasingly frequent monitoring as positions approach liquidation</em> —
        cannot be written in it.
      </p>
    </SectionHead>
    <Reveal>
      <div className="mt-12">
        <Cadence />
      </div>
    </Reveal>
  </section>
);

const REASONS = [
  {
    n: "01",
    head: "It books its successor before it does any work",
    body: "Each execution schedules the next one first and only then plans. A strategy that reverts costs one run instead of the whole chain — and because executeScheduled has no access control, anyone can restart a chain that stopped.",
  },
  {
    n: "02",
    head: "It can refuse, and say why on chain",
    body: "Before it trades, a pool TWAP and a Chainlink feed have to agree. On 11 July 2026 a single manipulated price took $9.05M out of Bonzo Lend, and roughly 40% of Hedera's TVL with it.",
  },
  {
    n: "03",
    head: "Reserving too little gas is the quiet killer",
    body: "The work succeeds, the receipt says SUCCESS, and the automation never runs again. That one and five others are written down with the commands to reproduce them.",
  },
];

const HowItWorks = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead eyebrow="Three of the six" title="Why this is not a cron job.">
      <p>
        A keeper is a machine you own, a bill you pay and an uptime you are responsible for. This is none of those — and
        the ways it can still fail are specific, measured, and written down.
      </p>
    </SectionHead>

    <ol className="m-0 mt-4 list-none p-0">
      {REASONS.map((item, i) => (
        <Reveal as="li" key={item.n} delay={i * 0.05}>
          <div className="grid gap-x-10 gap-y-3 border-b border-line py-9 sm:grid-cols-[4rem_minmax(0,1fr)]">
            <span className="eyebrow pt-2">{item.n}</span>
            <div>
              <h3 className="display m-0 mb-4 text-2xl sm:text-[2rem]">{item.head}</h3>
              <p className="m-0 max-w-3xl leading-relaxed text-paper-dim">{item.body}</p>
            </div>
          </div>
        </Reveal>
      ))}
    </ol>
  </section>
);

export default Home;
