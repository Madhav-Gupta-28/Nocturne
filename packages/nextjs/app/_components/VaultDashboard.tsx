"use client";

import { useState } from "react";
import { ExitSetup } from "./ExitSetup";
import { Panel, Stat, encodeHeartbeatConfig, formatDuration, formatHbar, useNow } from "./ui";
import type { Address } from "viem";
import { formatUnits, parseEther, toFunctionSelector } from "viem";
import { useReadContracts } from "wagmi";
import {
  useDeployedContractInfo,
  useHederaAccountId,
  useSelectedNetwork,
  useTargetNetwork,
} from "~~/hooks/scaffold-hbar";
import { useVaultRead, useVaultStatus, useVaultWrite } from "~~/hooks/useNocturneVault";
import { chainIdToHederaNetwork, getBlockExplorerAddressLink, mirrorNodeUrl } from "~~/utils/scaffold-hbar";

/**
 * Warn while there is still time to do something about it. Lower than the
 * contract's own FuelLow threshold of 5, which is for indexers: a brand-new
 * vault with a few runs of fuel should not open on a warning.
 */
const FUEL_WARN_RUNS = 2n;

/** The vault's own floor. Anything shorter is clamped on chain. */
const MIN_INTERVAL = 60;

/** `Heartbeat.beat()` — the only call this vault's strategy ever makes. */
const BEAT_SELECTOR = toFunctionSelector("function beat()");

/**
 * How late a run has to be before the chain is treated as broken rather than
 * imminent. A schedule normally fires within a second or two of its time, and
 * the vault allows itself 10 seconds of clock skew either way; a minute is well
 * past both, and past it the honest word is "overdue", not "due now".
 */
const OVERDUE_GRACE = 60;

export const VaultDashboard = ({ vault }: { vault: Address }) => {
  const now = useNow();
  const { status, fuelTinybar, decision, refetch } = useVaultStatus(vault);

  const { data: exitStrategy } = useDeployedContractInfo({ contractName: "ProtectiveExitStrategy" });
  const { data: running } = useVaultRead(vault, "strategy");
  const { data: heartbeatStrategy } = useDeployedContractInfo({ contractName: "HeartbeatStrategy" });
  const runs = (s?: { address?: string }) =>
    !!running && !!s?.address && String(running).toLowerCase() === s.address.toLowerCase();
  const isExit = runs(exitStrategy);
  const kind = isExit ? "exit" : runs(heartbeatStrategy) ? "heartbeat" : "other";
  const { data: storedConfig } = useVaultRead(vault, "config");
  const configured = ((storedConfig as string | undefined) ?? "0x").length > 2;

  const secondsToGo = status ? Number(status.nextRunAt) - now : 0;
  const overdue = !!status?.armed && secondsToGo < -OVERDUE_GRACE;

  return (
    <>
      <Panel title="Your vault" subtitle="Read from the chain. Nothing on this page is cached or assumed.">
        <div className="flex flex-wrap gap-10">
          <Stat label="runs" value={status ? status.runs.toString() : "—"} />
          <Stat label="refusals" value={status ? status.refusals.toString() : "—"} hint="declined, with a reason" />
          <Stat
            label="next run"
            value={!status ? "—" : !status.armed ? "not armed" : overdue ? "overdue" : formatDuration(secondsToGo)}
            hint={overdue ? `${formatDuration(-secondsToGo)} late` : undefined}
          />
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
          <div className="mt-5 border-l-2 border-signal-dead bg-signal-dead/10 px-4 py-3">
            <span className="text-sm text-paper-dim">
              {status.runsLeft === 0n
                ? "No runs left."
                : `${status.runsLeft} run${status.runsLeft === 1n ? "" : "s"} left.`}{" "}
              Each run must hold its whole gas reserve, about twice what it is charged, so top it up before it stops.
            </span>
          </div>
        ) : null}

        {overdue ? <Overdue vault={vault} onDone={refetch} /> : null}

        {/* Which controls to show depends on what the vault is actually running,
            read from the vault rather than remembered from how it was made. An
            armed vault of any kind can be disarmed; setting one up is per
            strategy, and the exit strategy has its own panel below. */}
        {status?.armed || !isExit ? (
          <Controls vault={vault} armed={status?.armed ?? false} kind={kind} configured={configured} onDone={refetch} />
        ) : null}

        <Fuel vault={vault} fuel={fuelTinybar} onDone={refetch} />
        <Tokens vault={vault} />
      </Panel>

      {isExit && !status?.armed ? <ExitSetup vault={vault} onDone={refetch} /> : null}

      <Proof vault={vault} />
    </>
  );
};

/**
 * Putting HBAR in and taking it out.
 *
 * Anyone may top a vault up, so a third party can keep a public one alive; only
 * the owner can withdraw, and a withdrawal always goes to the owner. Withdrawing
 * everything from an armed vault does not disarm it: the next run is simply
 * refused for want of a reserve, which is why the button says what it does.
 */
const Fuel = ({ vault, fuel, onDone }: { vault: Address; fuel?: bigint; onDone: () => Promise<void> }) => {
  const [amount, setAmount] = useState("17");
  const { send, isPending } = useVaultWrite(vault);
  const valid = Number(amount) > 0;

  return (
    <div className="mt-8 flex flex-wrap items-end gap-4 border-t border-line pt-6">
      <label className="form-control">
        <span className="label-text text-sm mb-1">Top up</span>
        <div className="join">
          <input
            className="input input-bordered join-item w-24"
            value={amount}
            inputMode="decimal"
            aria-label="HBAR to add"
            onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          <span className="btn btn-disabled join-item no-animation">HBAR</span>
        </div>
      </label>
      <button
        className="btn btn-outline"
        disabled={isPending || !valid}
        onClick={async () => {
          // Weibar over JSON-RPC; the relay divides by 1e10 on the way in.
          await send({ functionName: "depositHbar", value: parseEther(amount) });
          await onDone();
        }}
      >
        {isPending ? "Working…" : "Add fuel"}
      </button>
      <button
        className="btn btn-ghost"
        disabled={isPending || !fuel}
        onClick={async () => {
          await send({ functionName: "withdrawHbar", args: [fuel] });
          await onDone();
        }}
      >
        Withdraw all {fuel !== undefined ? `(${formatHbar(fuel)} HBAR)` : ""}
      </button>
    </div>
  );
};

/** The tokens a vault in this template can end up holding. */
const TOKENS = [
  { symbol: "DAI", address: "0x0000000000000000000000000000000000001599" as Address, decimals: 8 },
  { symbol: "USDC", address: "0x0000000000000000000000000000000000001549" as Address, decimals: 6 },
  { symbol: "WHBAR", address: "0x0000000000000000000000000000000000003aD2" as Address, decimals: 8 },
] as const;

const BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Tokens the vault holds, each with a way out.
 *
 * An exit or a rebalance leaves proceeds in the vault. Without this the only way
 * to reach them was a script; `withdrawToken` always pays the owner.
 */
const Tokens = ({ vault }: { vault: Address }) => {
  const chainId = useSelectedNetwork().id;
  const { send, isPending } = useVaultWrite(vault);
  const { data, refetch } = useReadContracts({
    contracts: TOKENS.map(t => ({
      chainId,
      address: t.address,
      abi: BALANCE_OF,
      functionName: "balanceOf",
      args: [vault],
    })),
    query: { refetchInterval: 8_000 },
  });
  const held = TOKENS.map((t, i) => ({ ...t, balance: (data?.[i]?.result as bigint | undefined) ?? 0n })).filter(
    t => t.balance > 0n,
  );
  if (held.length === 0) return null;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <span className="eyebrow">Holding</span>
      {held.map(t => (
        <span key={t.symbol} className="flex items-center gap-3">
          <span className="tabular font-mono text-paper">
            {formatUnits(t.balance, t.decimals)} {t.symbol}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={isPending}
            onClick={async () => {
              await send({ functionName: "withdrawToken", args: [t.address, t.balance] });
              await refetch();
            }}
          >
            Withdraw
          </button>
        </span>
      ))}
    </div>
  );
};

/**
 * What to do when the chain has stopped.
 *
 * It ends in one of two ways, and neither leaves anything a wallet would show
 * you. Either an execution failed to book its successor, or — much more often —
 * the successor was booked, fired on time, and the vault could not pay for it.
 * The second is what happened to the first long-running demo vault: it held 2.76
 * HBAR, more than the 1.63 each of its thirteen runs had been charged, and the
 * fourteenth was refused with INSUFFICIENT_PAYER_BALANCE because the reserve is
 * the whole gas allowance rather than the gas burned.
 *
 * The recovery is deliberately open to anyone: `executeScheduled` has no access
 * control, and it books the next run before it does any work. So a stalled vault
 * is one call away from alive again, and the person making that call does not
 * have to be its owner.
 */
const Overdue = ({ vault, onDone }: { vault: Address; onDone: () => Promise<void> }) => {
  const { send, isPending } = useVaultWrite(vault);

  return (
    <div className="alert alert-error mt-5 py-3 flex-col items-start gap-3">
      <span className="text-sm">
        This run is late, which means the chain stopped. Almost always the balance could not cover the next run&apos;s
        gas reserve — check the runway above, and remember it is refused while it still holds HBAR. Top it up, then
        restart it. Anyone can: the call is not owner-only.
      </span>
      <button
        className="btn btn-sm"
        disabled={isPending}
        onClick={async () => {
          await send({ functionName: "executeScheduled", books: true });
          await onDone();
        }}
      >
        {isPending ? "Working…" : "Run it now"}
      </button>
    </div>
  );
};

/**
 * Arming takes three transactions, in this order, and the order is not
 * cosmetic: the vault refuses to execute a plan that reaches an address it was
 * never told about, and refuses to arm on a config its strategy has not
 * validated. Doing it in the UI rather than hiding it in a script is the point —
 * a template is read for how it works.
 */
const Controls = ({
  vault,
  armed,
  kind,
  configured,
  onDone,
}: {
  vault: Address;
  armed: boolean;
  kind: "heartbeat" | "exit" | "other";
  configured: boolean;
  onDone: () => Promise<void>;
}) => {
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
          Disarming deletes the pending schedule. The HBAR stays in the vault until you withdraw it.
        </span>
      </div>
    );
  }

  /*
    A strategy this page has no setup form for — the rebalancer, or one you
    wrote — is configured by script. If it has a config, re-arming it is one
    call; the heartbeat form below would send the wrong config to it.
  */
  if (kind !== "heartbeat") {
    return configured ? (
      <div className="flex flex-wrap items-center gap-4 mt-8">
        <button
          className="btn btn-primary"
          disabled={isPending}
          onClick={async () => {
            await send({ functionName: "arm", books: true });
            await onDone();
          }}
        >
          {isPending ? "Working…" : "Arm it"}
        </button>
        <span className="text-sm opacity-60">Re-arms with the config already stored in the vault.</span>
      </div>
    ) : (
      <p className="text-sm opacity-60 mt-8 mb-0">
        This strategy is set up by script. See <code>scripts/armRebalanceVault.ts</code>.
      </p>
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
          // Name the function, not just the contract. Allowing an address
          // wholesale would let any strategy call anything on it.
          await send({ functionName: "setAllowedCall", args: [target, BEAT_SELECTOR, true] });
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
        <code className="text-xs">transfers</code> array. Your account appears only on the setup transactions you sent,
        and never on a run.
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
