"use client";

import { CreateVault } from "./_components/CreateVault";
import { Depth } from "./_components/Depth";
import { Hero } from "./_components/Hero";
import { Problem } from "./_components/Problem";
import { Proof } from "./_components/Proof";
import { RunTheNight } from "./_components/RunTheNight";
import { SectionHead } from "./_components/SectionHead";
import { Unlocks } from "./_components/Unlocks";
import { VaultDashboard } from "./_components/VaultDashboard";
import { Reveal } from "./_components/motion";
import type { NextPage } from "next";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/**
 * One page, one claim: you set it once and it keeps running.
 *
 * Ordered as an argument, nothing on it twice. What you get; why that needed a
 * bot until now; two real vaults deciding with nobody watching; the mechanism,
 * played; why it is built deep on one service; how far it goes; and only then
 * a wallet, for somebody who wants one of their own.
 *
 * The diagrams live on `/how-it-works` and the addresses on `/debug`.
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
      <Depth />
      <Unlocks />

      {/*
        The wallet is asked for last, and only here. Everything above is true
        whether or not you connect, which is the point of putting it first.
      */}
      <section className="shell pt-28 sm:pt-36">
        <SectionHead id="vault" title={vault ? "Your vault." : "Make one."}>
          <p>Choose a job, fund it, sign once. After that the network is the only thing that touches it.</p>
        </SectionHead>

        <Reveal>
          <div className="mt-12">
            {!isConnected ? <ConnectPrompt /> : vault ? <VaultDashboard vault={vault} /> : <CreateVault />}
          </div>
        </Reveal>
      </section>
    </div>
  );
};

/**
 * The only place the landing page asks for a wallet.
 *
 * It carries the connect button itself rather than pointing at one in the
 * header, because there is no longer one in the header — and a prompt that
 * says "connect" while the control to do it lives somewhere else is a small
 * puzzle nobody should have to solve.
 */
const ConnectPrompt = () => (
  <div className="lift flex flex-wrap items-center justify-between gap-8 border border-line bg-ink-raised/40 p-8 backdrop-blur-sm sm:p-10">
    <p className="m-0 max-w-md text-lg leading-relaxed text-paper-dim">
      Everything above is true without a wallet. You need one only to build a vault of your own.
    </p>
    <RainbowKitCustomConnectButton />
  </div>
);

export default Home;
