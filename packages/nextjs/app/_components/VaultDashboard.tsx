"use client";

import { useState } from "react";
import { Panel, Stat, encodeHeartbeatConfig, formatDuration, formatHbar, useNow } from "./ui";
import type { Address } from "viem";
import { useDeployedContractInfo, useHederaAccountId, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { useVaultStatus, useVaultWrite } from "~~/hooks/useNocturneVault";
import { chainIdToHederaNetwork, getBlockExplorerAddressLink, mirrorNodeUrl } from "~~/utils/scaffold-hbar";

/** Warn while there is still time to do something about it. */
const FUEL_WARN_RUNS = 5n;

/** The vault's own floor. Anything shorter is clamped on chain. */
const MIN_INTERVAL = 60;

export const VaultDashboard = ({ vault }: { vault: Address }) => {
  const now = useNow();
  const { status, fuelTinybar, decision, refetch } = useVaultStatus(vault);

  const secondsToGo = status ? Number(status.nextRunAt) - now : 0;

  return (
    <>
      <Panel title="Your vault" subtitle="Read from the chain. Nothing on this page is cached or assumed.">
        <div className="flex flex-wrap gap-10">
          <Stat label="runs" value={status ? status.runs.toString() : "—"} />
          <Stat label="refusals" value={status ? status.refusals.toString() : "—"} hint="declined, with a reason" />
          <Stat label="next run" value={!status ? "—" : status.armed ? formatDuration(secondsToGo) : "not armed"} />
          <Stat
            label="runway"
            value={status ? `${status.runsLeft}` : "—"}
            hint={fuelTinybar !== undefined ? `${formatHbar(fuelTinybar)} HBAR left` : undefined}
          />
        </div>

        <div className="mt-6">
          <div className="text-sm opacity-50 uppercase tracking-wider">what it would do right now</div>
          <div className="text-2xl mt-1">{decision ?? "nothing configured yet"}</div>
        </div>

        {status && status.runsLeft <= FUEL_WARN_RUNS && status.armed ? (
          <div className="alert alert-warning mt-5 py-3">
            <span className="text-sm">
              Fuel is nearly out. When a vault cannot pay, it stops booking its successor — quietly, with no error
              anywhere. Top it up to keep the chain alive.
            </span>
          </div>
        ) : null}

        <Controls vault={vault} armed={status?.armed ?? false} onDone={refetch} />
      </Panel>

      <Proof vault={vault} />
    </>
  );
};

/**
 * Arming takes three transactions, in this order, and the order is not
 * cosmetic: the vault refuses to execute a plan that reaches an address it was
 * never told about, and refuses to arm on a config its strategy has not
 * validated. Doing it in the UI rather than hiding it in a script is the point —
 * a template is read for how it works.
 */
const Controls = ({ vault, armed, onDone }: { vault: Address; armed: boolean; onDone: () => Promise<void> }) => {
  const [interval, setIntervalSeconds] = useState("120");
  const { data: heartbeat } = useDeployedContractInfo({ contractName: "Heartbeat" });
  const { send, isPending } = useVaultWrite(vault);

  const seconds = Number(interval);
  const valid = Number.isFinite(seconds) && seconds >= MIN_INTERVAL;

  if (armed) {
    return (
      <div className="flex flex-wrap items-center gap-4 mt-8">
        <button
          className="btn btn-outline"
          disabled={isPending}
          onClick={async () => {
            await send({ functionName: "disarm" });
            await onDone();
          }}
        >
          {isPending ? "Working…" : "Disarm"}
        </button>
        <span className="text-sm opacity-60">
          Disarming deletes the pending schedule and refunds what it was holding.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-4 mt-8">
      <label className="form-control">
        <span className="label-text text-sm mb-1">Beat every</span>
        <div className="join">
          <input
            className="input input-bordered join-item w-24"
            value={interval}
            inputMode="numeric"
            aria-label="Interval in seconds"
            onChange={e => setIntervalSeconds(e.target.value.replace(/[^0-9]/g, ""))}
          />
          <span className="btn btn-disabled join-item no-animation">seconds</span>
        </div>
      </label>

      <button
        className="btn btn-primary"
        disabled={isPending || !heartbeat?.address || !valid}
        onClick={async () => {
          const target = heartbeat!.address as Address;
          await send({ functionName: "setAllowedTarget", args: [target, true] });
          await send({ functionName: "configure", args: [encodeHeartbeatConfig(target, BigInt(seconds))] });
          // Only this one books a schedule, so only this one needs the gas for it.
          await send({ functionName: "arm", books: true });
          await onDone();
        }}
      >
        {isPending ? "Working…" : "Arm it"}
      </button>

      <p className="text-sm opacity-60 m-0 pb-3 max-w-sm">
        Three transactions: allow the target, set the config, arm. After the third one you can close the tab — the
        network books everything from there.
        {!valid && seconds > 0 ? ` Minimum interval is ${MIN_INTERVAL} seconds.` : ""}
      </p>
    </div>
  );
};

/**
 * The part that matters, and the part most easily faked.
 *
 * A scheduled transaction's id carries the account that *created* the schedule,
 * which makes a mirror-node listing look as though the owner sent every call.
 * They did not. The fee comes out of the vault, and the only place that shows is
 * the transfer list. Saying which field to read is the difference between
 * evidence and a screenshot.
 */
const Proof = ({ vault }: { vault: Address }) => {
  const { targetNetwork } = useTargetNetwork();
  const { accountId } = useHederaAccountId(vault, targetNetwork.id);
  const mirror = mirrorNodeUrl(chainIdToHederaNetwork(targetNetwork.id));

  return (
    <Panel title="Check it yourself" subtitle="Read the transfer list, not the transaction id.">
      <p className="opacity-70 mt-0 text-sm max-w-2xl">
        Open the vault&apos;s transactions below. Each execution has{" "}
        <code className="text-xs">{accountId ?? "the vault"}</code> paying its own fee in the{" "}
        <code className="text-xs">transfers</code> array. Your account appears once, for the transaction that armed it,
        and never again.
      </p>
      <div className="flex flex-col gap-1 text-sm">
        <a className="link" href={getBlockExplorerAddressLink(targetNetwork, vault)} target="_blank" rel="noreferrer">
          Vault on HashScan →
        </a>
        {accountId ? (
          <a
            className="link"
            href={`${mirror}/api/v1/transactions?account.id=${accountId}&limit=10&order=desc`}
            target="_blank"
            rel="noreferrer"
          >
            Raw transactions on the mirror node →
          </a>
        ) : null}
      </div>
    </Panel>
  );
};
