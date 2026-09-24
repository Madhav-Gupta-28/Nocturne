import Link from "next/link";
import { DebugContracts } from "./_components/DebugContracts";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Contracts",
  description: "Every contract this template deploys, what it is for, and a form to call it with.",
});

/**
 * The contract console.
 *
 * This is Scaffold-HBAR's debug page, kept rather than removed and given the
 * two things it was missing: a reason to be on it, and an explanation of what
 * anything is.
 *
 * Keeping it is deliberate. It is the one place a reviewer can call `arm()` or
 * read `reservePerRun()` without writing a script — so it turns every claim on
 * the rest of the site from something to be believed into something to be
 * checked, in a form, in about four seconds. Removing it would also make this
 * less of a Scaffold-HBAR template, which is the opposite of the point.
 *
 * What was wrong was never the machinery. It was that the page opened on a row
 * of contract names with no indication of what they were, and put its own title
 * at the bottom, underneath the content it was titling.
 */
const Debug: NextPage = () => (
  <div className="flex w-full grow flex-col pb-28">
    <div className="shell">
      <header className="glowfield pt-16 pb-14 sm:pt-24">
        <p className="eyebrow m-0">Contracts</p>
        <h1 className="display display-lit mb-0 mt-7 text-[clamp(2.2rem,6.4vw,5.5rem)]">
          Check it <span className="text-signal display-lit-signal">yourself.</span>
        </h1>
        <p className="mb-0 mt-9 max-w-2xl text-lg leading-relaxed text-paper-dim">
          Every contract this template deploys, live on testnet, with a form for each function. Reads are free and need
          no wallet — writes need one, and will ask you to sign.
        </p>

        {/*
          Three things somebody can do here, named. A console with no suggested
          first move is a console most people leave, and each of these answers a
          claim made somewhere else on the site.
        */}
        <ul className="mb-0 mt-10 grid list-none grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line p-0 sm:grid-cols-3">
          {[
            {
              call: "Heartbeat · beats",
              what: "The execution count the landing page shows, read straight off the chain.",
            },
            {
              call: "PriceLens · read",
              what: "How far apart the two price sources are right now, and whether a vault would refuse.",
            },
            {
              call: "NocturneFactory · totalVaults",
              what: "How many vaults this factory has built since it was deployed.",
            },
          ].map(item => (
            <li key={item.call} className="bg-ink-raised px-5 py-5">
              <p className="eyebrow m-0 text-signal">{item.call}</p>
              <p className="mb-0 mt-3 text-sm leading-relaxed text-paper-dim">{item.what}</p>
            </li>
          ))}
        </ul>

        <p className="mb-0 mt-8 text-sm text-paper-faint">
          New to the contracts?{" "}
          <Link href="/docs/vault-reference" className="text-paper underline underline-offset-2 hover:text-signal">
            The vault reference
          </Link>{" "}
          documents every function, and{" "}
          <Link href="/how-it-works" className="text-paper underline underline-offset-2 hover:text-signal">
            how it works
          </Link>{" "}
          draws how they fit together.
        </p>
      </header>

      <section className="border-t border-line pt-14">
        <DebugContracts />
      </section>
    </div>
  </div>
);

export default Debug;
