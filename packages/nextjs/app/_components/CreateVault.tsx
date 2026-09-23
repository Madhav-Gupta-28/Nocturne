"use client";

import { useState } from "react";
import { Panel } from "./ui";
import { parseEther } from "viem";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";

/**
 * Creating a vault, and being honest about the deposit while doing it.
 *
 * The one thing a newcomer gets wrong here is thinking the deposit is a fee.
 * It is not — it is the vault's own balance, it pays for its own executions out
 * of it, and whatever is left comes back with `withdrawHbar`. So the panel
 * converts the figure into the only unit that means anything: how many runs it
 * buys.
 */

/** Roughly what one execution costs. Measured, not guessed — see the README. */
const HBAR_PER_RUN = 1.6;

/** The factory's constructor-deploy plus the transfer needs real headroom. */
const CREATE_GAS = 4_000_000n;

export const CreateVault = () => {
  const [fuel, setFuel] = useState("24");
  const { data: strategy } = useDeployedContractInfo({ contractName: "HeartbeatStrategy" });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "NocturneFactory",
    // The vault's constructor runs inside this call; simulating it through the
    // relay reports a gas figure low enough to strand the deployment.
    disableSimulate: true,
  });

  const amount = Number(fuel);
  const runs = Number.isFinite(amount) ? Math.floor(amount / HBAR_PER_RUN) : 0;

  return (
    <Panel
      title="Create a vault"
      subtitle="One vault per owner. It holds your funds, and it pays for its own executions out of the same balance."
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="form-control">
          <span className="label-text text-sm mb-1">Starting balance</span>
          <div className="join">
            <input
              className="input input-bordered join-item w-28"
              value={fuel}
              inputMode="decimal"
              aria-label="Starting balance in HBAR"
              onChange={e => setFuel(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="btn btn-disabled join-item no-animation">HBAR</span>
          </div>
        </label>

        <button
          className="btn btn-primary"
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

        <p className="text-sm opacity-60 m-0 pb-3">
          about <span className="font-semibold tabular-nums">{runs}</span> executions at ~{HBAR_PER_RUN} HBAR each.
          Withdraw the remainder any time.
        </p>
      </div>
    </Panel>
  );
};
