"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { useReservePerRun } from "~~/hooks/useNocturneVault";

/**
 * Creating a vault, and being honest about the deposit while doing it.
 *
 * The one thing a newcomer gets wrong here is thinking the deposit is a fee.
 * It is not — it is the vault's own balance, it pays for its own executions out
 * of it, and whatever is left comes back with `withdrawHbar`. So the panel
 * converts the figure into the only unit that means anything: how many runs it
 * buys.
 */

/** The factory's constructor-deploy plus the transfer needs real headroom. */
const CREATE_GAS = 4_000_000n;

/** The strategies this template ships, in the order a newcomer should meet them. */
const CHOICES = [
  {
    key: "HeartbeatStrategy",
    name: "Heartbeat",
    blurb: "Calls a counter on a fixed interval, forever. The simplest possible strategy, and the liveness proof.",
  },
  {
    key: "ProtectiveExitStrategy",
    name: "Protective exit",
    blurb:
      "Watches a SaucerSwap pool against a Chainlink feed and sells when a floor breaks — unless the two disagree.",
  },
] as const;

export const CreateVault = () => {
  const [fuel, setFuel] = useState("24");
  const [choice, setChoice] = useState<(typeof CHOICES)[number]["key"]>("HeartbeatStrategy");

  const heartbeat = useDeployedContractInfo({ contractName: "HeartbeatStrategy" });
  const exit = useDeployedContractInfo({ contractName: "ProtectiveExitStrategy" });
  const strategy = choice === "HeartbeatStrategy" ? heartbeat.data : exit.data;
  const reserve = useReservePerRun();
  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "NocturneFactory",
    // The vault's constructor runs inside this call; simulating it through the
    // relay reports a gas figure low enough to strand the deployment.
    disableSimulate: true,
  });

  // Quoted against what a run reserves, not what it is charged. The two differ
  // by about a factor of two, and quoting the smaller one is how a vault ends
  // up refused while it still holds HBAR.
  const hbarPerRun = reserve === undefined ? undefined : Number(reserve) / 1e8;
  const amount = Number(fuel);
  const runs = hbarPerRun && Number.isFinite(amount) ? Math.floor(amount / hbarPerRun) : undefined;

  return (
    /*
      Laid out as an instrument rather than a form. The strategy choice is two
      selectable panels instead of radio buttons, because the choice is between
      two behaviours and the sentence describing each one is the thing being
      chosen; a 16px radio next to a paragraph makes the paragraph look like
      help text.
    */
    <div className="lift border border-line bg-ink-raised/40 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow">Create a vault</span>
        <span className="eyebrow">One per owner</span>
      </div>

      <fieldset className="m-0 grid gap-px border-0 bg-line p-0 sm:grid-cols-2">
        <legend className="sr-only">Strategy</legend>
        {CHOICES.map(c => {
          const on = choice === c.key;
          return (
            <label
              key={c.key}
              className={`relative cursor-pointer bg-ink-raised px-6 py-6 transition-colors ${
                on ? "bg-signal-glow" : "hover:bg-ink"
              }`}
            >
              <input type="radio" name="strategy" className="sr-only" checked={on} onChange={() => setChoice(c.key)} />
              {/* A rail that lights, matching the phase panels in the simulation. */}
              <span
                className="absolute inset-y-0 left-0 w-0.5 origin-top bg-signal transition-transform duration-300"
                style={{ transform: on ? "scaleY(1)" : "scaleY(0)" }}
                aria-hidden
              />
              <span className={`display block text-xl ${on ? "text-signal" : "text-paper"}`}>{c.name}</span>
              <span className="mt-3 block text-sm leading-relaxed text-paper-dim">{c.blurb}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-end gap-6 border-t border-line px-6 py-6">
        <label className="block">
          <span className="eyebrow mb-3 block">Starting balance</span>
          <span className="flex items-stretch border border-line-bright">
            <input
              className="tabular w-28 bg-transparent px-4 py-3 font-mono text-lg text-paper outline-none focus:border-signal"
              value={fuel}
              inputMode="decimal"
              aria-label="Starting balance in HBAR"
              onChange={e => setFuel(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="eyebrow flex items-center border-l border-line-bright px-4">HBAR</span>
          </span>
        </label>

        <button
          className="btn-signal disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isMining || !strategy?.address || !(amount > 0)}
          onClick={async () => {
            await writeContractAsync({
              functionName: "createVault",
              args: [strategy?.address],
              // Weibar on the way in: the relay divides by 1e10, and the same
              // balance reads back as tinybar inside the EVM.
              value: parseEther(fuel),
              gas: CREATE_GAS,
            });
          }}
        >
          {isMining ? "Creating…" : "Create vault"}
        </button>

        <p className="m-0 max-w-md text-sm leading-relaxed text-paper-faint">
          {runs === undefined || hbarPerRun === undefined ? (
            "Reading the current gas price…"
          ) : (
            <>
              About <span className="tabular font-mono text-paper">{runs}</span> executions. Each one has to reserve{" "}
              <span className="tabular font-mono text-paper">{hbarPerRun.toFixed(2)}</span> HBAR at today&apos;s gas
              price, though it is charged about half that. Withdraw the remainder any time.
            </>
          )}
        </p>
      </div>
    </div>
  );
};
