import { DebugContracts } from "./_components/DebugContracts";
import type { NextPage } from "next";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Contracts",
  description: "Call any deployed contract from the browser. Reads are free.",
});

/**
 * The contract console.
 *
 * This is Scaffold-HBAR's debug page, kept rather than removed, and it earns
 * its place for one reason: it is the only place a reviewer can call a function
 * without writing a script. That turns every claim on the rest of the site from
 * something to be believed into something to be checked, in a form, in seconds.
 *
 * Removing it would also make this less of a Scaffold-HBAR template, which is
 * the opposite of the point.
 *
 * The page itself says almost nothing. The contract cards below carry their own
 * explanations, and a page of prose above a tool is a page nobody reads on the
 * way to the tool.
 */
const Debug: NextPage = () => (
  <div className="flex w-full grow flex-col pb-28">
    <div className="shell">
      <header className="glowfield flex flex-wrap items-end justify-between gap-6 pt-16 pb-12 sm:pt-20">
        <div>
          <h1 className="display mb-0 text-[clamp(2.4rem,7vw,6rem)]">
            <span className="display-lit">Call it</span> <span className="marker">yourself.</span>
          </h1>
          <p className="mb-0 mt-8 max-w-lg text-lg leading-relaxed text-paper-dim">
            Every deployed contract, live on testnet. Reads are free — writes need a wallet.
          </p>
        </div>

        <RainbowKitCustomConnectButton />
      </header>

      <section className="border-t border-line pt-12">
        <DebugContracts />
      </section>
    </div>
  </div>
);

export default Debug;
