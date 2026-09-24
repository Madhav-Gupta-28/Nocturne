"use client";

import { Beats } from "./_components/Beats";
import { CreateVault } from "./_components/CreateVault";
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
    <div className="flex flex-col items-center grow w-full px-4 pt-10 pb-20">
      <div className="w-full max-w-4xl flex flex-col gap-6">
        <Hero />
        <Beats />
        <TwoSources />
        {!isConnected ? <ConnectPrompt /> : vault ? <VaultDashboard vault={vault} /> : <CreateVault />}
        <HowItWorks />
      </div>
    </div>
  );
};

const Hero = () => (
  <header className="flex flex-col gap-4 mb-2">
    <h1 className="text-5xl font-bold m-0 leading-tight">
      Close the tab.
      <br />
      <span className="opacity-50">Come back. It already happened.</span>
    </h1>
    <p className="opacity-70 max-w-2xl m-0">
      A vault that books its own next execution with the Hedera Schedule Service. No keeper, no bot, no cron job on
      somebody&apos;s laptop — the thing that fires at 4am is the network itself. It decides how long to wait from what
      it can see, and it refuses to trade when its two price sources disagree.
    </p>
  </header>
);

const ConnectPrompt = () => (
  <Panel title="Connect a wallet">
    <p className="opacity-70 m-0">
      Nocturne makes one vault per owner, so it needs to know who you are. Everything above is read from the chain and
      is true whether or not you connect.
    </p>
  </Panel>
);

const HowItWorks = () => (
  <Panel title="Why this is not a cron job">
    <ul className="list-disc list-outside pl-5 opacity-80 flex flex-col gap-3 m-0 text-sm">
      <li>
        The vault books its own next run through HIP-1215, and it books it <em>before</em> it does any work. A strategy
        that reverts then costs one run instead of the whole chain.
      </li>
      <li>
        The strategy picks the interval, not the vault. A position far from trouble is checked every six hours and one
        near its floor every sixty seconds — at ~1.6 HBAR a run, that is the difference between 6 and 460 HBAR a day.
      </li>
      <li>
        Before it trades, a pool TWAP and a Chainlink feed have to agree. On 11 July 2026 a single manipulated price
        took $9.05M out of Bonzo Lend, and roughly 40% of Hedera&apos;s TVL with it.
      </li>
      <li>
        Reserving too little gas is the quiet killer: the work succeeds, the receipt says SUCCESS, and the automation
        never runs again. That one and three others are written down in{" "}
        <code className="text-xs">docs/hedera-landmines.md</code>, with the commands to reproduce them.
      </li>
    </ul>
  </Panel>
);

export default Home;
