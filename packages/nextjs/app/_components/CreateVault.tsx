"use client";

import { useState } from "react";
import { Panel } from "./ui";
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

export const CreateVault = () => {
  const [fuel, setFuel] = useState("24");
  const { data: strategy } = useDeployedContractInfo({ contractName: "HeartbeatStrategy" });
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

        <p className="text-sm opacity-60 m-0 pb-3 max-w-xs">
          {runs === undefined || hbarPerRun === undefined ? (
            "reading the current gas price…"
          ) : (
            <>
              about <span className="font-semibold tabular-nums">{runs}</span> executions. Each one has to reserve{" "}
              <span className="tabular-nums">{hbarPerRun.toFixed(2)}</span> HBAR at today&apos;s gas price, though it is
              charged about half that. Withdraw the remainder any time.
            </>
          )}
        </p>
      </div>
    </Panel>
  );
};
