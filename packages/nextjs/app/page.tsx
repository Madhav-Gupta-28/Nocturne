"use client";

import { Cadence } from "./_components/Cadence";
import { CreateVault } from "./_components/CreateVault";
import { Hero } from "./_components/Hero";
import { TwoSources } from "./_components/TwoSources";
import { VaultDashboard } from "./_components/VaultDashboard";
import { Panel } from "./_components/ui";
import type { NextPage } from "next";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/**
 * One page, one claim: this runs without you.
 *
 * Everything on it is read from the chain — the run counter, the countdown, the
 * runway, and the strategy's own words for what it would do next. The one thing
 * a screenshot cannot prove is the thing that matters most, so the page does not
 * ask to be believed: it links to the mirror node and says which field to read.
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
    <div className="flex flex-col items-center grow w-full px-5 sm:px-8 pb-32">
      <div className="w-full max-w-5xl flex flex-col gap-4">
        <Hero />
        <Accelerando />
        <TwoSources />
        {!isConnected ? <ConnectPrompt /> : vault ? <VaultDashboard vault={vault} /> : <CreateVault />}
        <HowItWorks />
      </div>
    </div>
  );
};

const ConnectPrompt = () => (
  <Panel title="Connect a wallet">
    <p className="opacity-70 m-0">
      Nocturne makes one vault per owner, so it needs to know who you are. Everything above is read from the chain and
      is true whether or not you connect.
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
  <section className="pt-16 rule">
    <h2 className="display text-4xl sm:text-5xl m-0 mb-6 max-w-3xl">Cheap to watch. Until it is not.</h2>
    <p className="text-paper-dim max-w-2xl mt-0 mb-9 leading-relaxed">
      The strategy picks the interval, not the vault. Hedera&apos;s own{" "}
      <code className="text-paper">ScheduledVault</code> takes one fixed number, so the use case in their own
      documentation — <em>contracts schedule increasingly frequent monitoring as positions approach liquidation</em> —
      cannot be written in it.
    </p>
    <Cadence />
  </section>
);

const HowItWorks = () => (
  <section className="pt-16 rule">
    <h2 className="display text-4xl sm:text-5xl m-0 mb-10">Why this is not a cron job</h2>
    <ol className="mt-8 mb-0 p-0 list-none flex flex-col">
      {[
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
      ].map(item => (
        <li key={item.n} className="grid sm:grid-cols-[3rem_1fr] gap-x-6 gap-y-2 border-b border-line py-7 first:pt-0">
          <span className="eyebrow pt-1">{item.n}</span>
          <div>
            <h3 className="display text-2xl sm:text-3xl m-0 mb-4">{item.head}</h3>
            <p className="m-0 text-paper-dim leading-relaxed max-w-2xl">{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  </section>
);

export default Home;
