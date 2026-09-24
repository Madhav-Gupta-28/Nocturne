"use client";

import Link from "next/link";
import { CreateVault } from "./_components/CreateVault";
import { Hero } from "./_components/Hero";
import { Problem } from "./_components/Problem";
import { Proof } from "./_components/Proof";
import { RunTheNight } from "./_components/RunTheNight";
import { SectionHead } from "./_components/SectionHead";
import { VaultDashboard } from "./_components/VaultDashboard";
import { Reveal } from "./_components/motion";
import type { NextPage } from "next";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/**
 * One page, five sections, one claim: you set it once and it keeps running.
 *
 * It is ordered as an argument and nothing is on it twice. The opening says
 * what you get; `Problem` says why that was hard; `Proof` shows the chain
 * agreeing; `RunTheNight` plays the mechanism, because the ordering inside a
 * run is something you watch rather than something you read; and only then
 * does the page ask for a wallet.
 *
 * Everything that answers a second question — the cadence diagram, the two
 * price sources, the deployed addresses — lives on `/how-it-works`. It is all
 * good material and none of it belongs in front of somebody who is still
 * deciding whether to care.
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
      <Problem />
      <Proof />
      <RunTheNight />

      {/*
        The wallet is asked for last, and only here. Everything above is true
        whether or not you connect, which is the point of putting it first.
      */}
      <section className="shell pt-28 sm:pt-36">
        <SectionHead
          id="vault"
          eyebrow={isConnected ? "Your vault" : "Two minutes on testnet"}
          title={vault ? "Your vault." : "Make one."}
        >
          <p>Pick what it should do, fund it, sign once. After that the network is the only thing that touches it.</p>
        </SectionHead>

        <Reveal>
          <div className="mt-12">
            {!isConnected ? <ConnectPrompt /> : vault ? <VaultDashboard vault={vault} /> : <CreateVault />}
          </div>
        </Reveal>
      </section>

      <Closer />
    </div>
  );
};

const ConnectPrompt = () => (
  <div className="lift border border-line bg-ink-raised/40 p-8 backdrop-blur-sm sm:p-10">
    <p className="m-0 max-w-xl text-lg leading-relaxed text-paper-dim">
      Connect a wallet to build one. Nothing above this line needed a wallet, and nothing above it changes when you
      connect.
    </p>
  </div>
);

/**
 * The way out.
 *
 * A landing page that ends at the bottom of its last panel leaves the reader
 * with nowhere to go. This is one line and two links: the deeper page for
 * somebody who is now interested, and the source for somebody who is not going
 * to believe any of it until they have read it.
 */
const Closer = () => (
  <section className="shell pt-28 sm:pt-36">
    <Reveal>
      <div className="border-t border-line pt-14">
        <h2 className="display display-section display-lit m-0 max-w-3xl">
          The whole thing is <span className="text-signal">six contracts</span> and a page of tests.
        </h2>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/how-it-works" className="btn-signal">
            How it works <span aria-hidden>→</span>
          </Link>
          <a href="https://github.com/Madhav-Gupta-28/Nocturne" target="_blank" rel="noreferrer" className="btn-line">
            Read the source ↗
          </a>
        </div>
      </div>
    </Reveal>
  </section>
);

export default Home;
