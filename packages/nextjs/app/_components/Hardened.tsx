"use client";

import { SectionHead } from "./SectionHead";
import { Reveal } from "./motion";

/**
 * Nocturne next to the template it starts from.
 *
 * Scaffold-HBAR ships `ScheduledVault` in its `payments-scheduler` template, and
 * anyone who knows that template will read Nocturne as a version of it. So the
 * page says so first, then shows what changed, leading with the one difference
 * a test makes impossible to argue with: what three uninvited calls do.
 *
 * Every row is checked. The first three are assertions in
 * `test/ScheduledVault.comparison.test.ts`, which runs Hedera's contract beside
 * Nocturne's on the same scheduler; the rest are read from its source.
 */

const REPO = "https://github.com/Madhav-Gupta-28/Nocturne/blob/main";
const TEST = `${REPO}/packages/hardhat/test/ScheduledVault.comparison.test.ts`;
const TEMPLATE =
  "https://github.com/hedera-dev/scaffold-hbar/blob/templates/payments-scheduler/packages/foundry/contracts/ScheduledVault.sol";

const ROWS = [
  { ask: "When it runs", theirs: "A fixed interval", ours: "The strategy picks, 60s to 60 days" },
  { ask: "Order", theirs: "Runs the plan, then books", ours: "Books the next run first" },
  { ask: "A strategy may", theirs: "Do anything, even send HBAR", ours: "Call only what you allowed" },
  { ask: "Fuel", theirs: "Not tracked", ours: "Runs left, counted" },
  { ask: "Price", theirs: "The venue's own quote", ours: "Two sources must agree" },
];

export const Hardened = () => (
  <section className="shell pt-28 sm:pt-36">
    <SectionHead id="hardened" title="Hedera's pattern, hardened.">
      <p>
        Scaffold-HBAR ships a{" "}
        <a className="link text-paper" href={TEMPLATE} target="_blank" rel="noreferrer">
          ScheduledVault
        </a>
        . Nocturne keeps its shape: a vault, a factory, a strategy.{" "}
        <span className="text-paper">Then it closes the gaps that matter once there is money in it.</span>
      </p>
    </SectionHead>

    <Reveal>
      <div className="lift mt-12 border border-signal/40 bg-ink-raised/40 backdrop-blur-sm">
        <p className="eyebrow m-0 border-b border-line px-6 py-4 sm:px-8">
          A stranger calls it three times, right after setup
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2">
          <Outcome who="Hedera's ScheduledVault" runs="3" schedules="4" dead />
          <Outcome who="Nocturne" runs="0" schedules="1" />
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 sm:px-8">
          <span className="text-sm text-paper-dim">
            Each extra schedule re-books itself, paid by the vault. Nocturne ignores a call before the booked second.
          </span>
          <a className="eyebrow transition-colors hover:text-paper" href={TEST} target="_blank" rel="noreferrer">
            Run the test ↗
          </a>
        </footer>
      </div>
    </Reveal>

    <Reveal>
      <div className="lift mt-6 grid grid-cols-[minmax(0,1fr)] border border-line bg-ink-raised/40 backdrop-blur-sm sm:grid-cols-2">
        <div className="hidden border-b border-line px-6 py-4 sm:block">
          <p className="eyebrow m-0">ScheduledVault</p>
        </div>
        <div className="hidden border-b border-line bg-signal-glow/50 px-6 py-4 sm:block sm:border-l">
          <p className="eyebrow m-0 text-signal">Nocturne</p>
        </div>
        {ROWS.map(r => (
          <Pair key={r.ask} {...r} />
        ))}
      </div>
    </Reveal>
  </section>
);

const Outcome = ({
  who,
  runs,
  schedules,
  dead = false,
}: {
  who: string;
  runs: string;
  schedules: string;
  dead?: boolean;
}) => (
  <div className={`px-6 py-6 sm:px-8 ${dead ? "" : "bg-signal-glow/25 sm:border-l sm:border-line"}`}>
    <p className={`m-0 text-sm ${dead ? "text-paper-dim" : "text-signal"}`}>{who}</p>
    <p className="m-0 mt-4 flex items-baseline gap-8">
      <Figure value={runs} label="plan runs" dead={dead} />
      <Figure value={schedules} label="schedules left" dead={dead} />
    </p>
  </div>
);

const Figure = ({ value, label, dead }: { value: string; label: string; dead: boolean }) => (
  <span className="flex flex-col">
    <span className={`display text-[3rem] leading-none ${dead ? "text-signal-dead" : "text-signal"}`}>{value}</span>
    <span className="eyebrow mt-2">{label}</span>
  </span>
);

/*
  On a wide screen the two column heads say whose answer is whose. On a phone
  the grid is one column and the heads stack above everything, so each cell
  names its vault itself.
*/
const Pair = ({ ask, theirs, ours }: { ask: string; theirs: string; ours: string }) => (
  <>
    <div className="flex items-baseline justify-between gap-6 border-b border-line px-6 py-4">
      <span className="eyebrow">
        {ask}
        <span className="block sm:hidden">ScheduledVault</span>
      </span>
      <span className="text-right text-sm text-paper-dim">{theirs}</span>
    </div>
    <div className="flex items-baseline justify-between gap-6 border-b border-line bg-signal-glow/25 px-6 py-4 sm:border-l">
      <span className="eyebrow">
        {ask}
        <span className="block text-signal sm:hidden">Nocturne</span>
      </span>
      <span className="text-right text-sm text-paper">{ours}</span>
    </div>
  </>
);
