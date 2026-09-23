"use client";

import { Abi, Address } from "viem";
import { useAccount, useGasPrice, useReadContract, useWriteContract } from "wagmi";
import runtimeContracts from "~~/contracts/runtimeContracts";
import { useSelectedNetwork, useTransactor } from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";

/**
 * Reading and writing a vault.
 *
 * The scaffold's own `useScaffoldReadContract` takes a contract *name* and
 * looks the address up in `deployedContracts.ts`. A vault has no entry there:
 * the factory makes one per owner at an address nobody knew in advance, so the
 * address has to come from the caller and only the ABI is shared. That ABI is
 * generated at deploy time — see `packages/hardhat/scripts/generateRuntimeAbis.ts`.
 */

const VAULT_ABI = runtimeContracts.NocturneVault.abi as unknown as Abi;

/**
 * Gas limits, explicit, because Hedera's relay under-estimates.
 *
 * `arm` and `executeScheduled` both book a schedule through HIP-1215, which
 * needs roughly 1.4M gas of its own on top of the call. An estimate that comes
 * back low here does not revert — the schedule simply never gets created, the
 * transaction reports SUCCESS, and the automation is silently dead. Unused gas
 * is refunded, so the headroom is close to free and the alternative is not.
 */
const GAS_BOOKING = 4_000_000n;
const GAS_PLAIN = 1_000_000n;

/** Tinybar per HBAR. In-EVM balances are 8 decimals, not 18. */
export const TINYBAR = 100_000_000n;

/** Weibar per tinybar. The relay quotes gas prices 1e10 larger than the EVM. */
const WEIBAR_PER_TINYBAR = 10_000_000_000n;

/**
 * What one execution requires a vault to hold, in tinybar.
 *
 * Not what a run costs — what it reserves. The network tests the payer against
 * the whole gas allowance before accepting the transaction and then charges
 * only for the gas burned, which is roughly half. A vault holding one run's
 * worth of *cost* is refused; that is how the first demo vault died with 2.76
 * HBAR in it. See `docs/hedera-landmines.md`, landmine 5.
 *
 * An existing vault answers this itself with `reservePerRun()`. This hook is
 * for the case before one exists, where there is nothing to ask.
 *
 * The relay's `eth_gasPrice` runs a few percent above the price the EVM reports,
 * so the figure here is slightly high — the safe direction for a deposit.
 */
export function useReservePerRun(): bigint | undefined {
  const chainId = useSelectedNetwork().id;
  const { data: weibarPerGas } = useGasPrice({ chainId });
  if (weibarPerGas === undefined) return undefined;
  return (GAS_BOOKING_RESERVE * weibarPerGas) / WEIBAR_PER_TINYBAR;
}

/**
 * `NocturneVault.MIN_SCHEDULE_GAS`, which is what every schedule is booked with
 * and therefore what each one reserves. Mirrored here because the figure is
 * needed before any vault exists to be asked.
 */
const GAS_BOOKING_RESERVE = 3_000_000n;

export type VaultStatus = {
  armed: boolean;
  runs: bigint;
  refusals: bigint;
  nextRunAt: bigint;
  runsLeft: bigint;
};

/**
 * Everything the dashboard needs, in two calls plus one that may revert.
 *
 * `preview` asks the strategy what it would do right now. It reverts when no
 * strategy is configured yet, and it can revert for reasons outside our control
 * (a pool with no observation window, a feed that is down), so it is read
 * separately and its absence is a normal state rather than an error.
 */
export function useVaultStatus(address?: Address) {
  const chainId = useSelectedNetwork().id;
  const enabled = !!address;

  const status = useReadContract({
    chainId,
    address,
    abi: VAULT_ABI,
    functionName: "status",
    query: { enabled, refetchInterval: 5_000 },
  });

  const fuel = useReadContract({
    chainId,
    address,
    abi: VAULT_ABI,
    functionName: "fuel",
    query: { enabled, refetchInterval: 5_000 },
  });

  const preview = useReadContract({
    chainId,
    address,
    abi: VAULT_ABI,
    functionName: "preview",
    query: { enabled, refetchInterval: 5_000, retry: false },
  });

  const raw = status.data as [boolean, bigint, bigint, bigint, bigint] | undefined;
  const explained = preview.data as [string, bigint, bigint] | undefined;

  return {
    status: raw && { armed: raw[0], runs: raw[1], refusals: raw[2], nextRunAt: raw[3], runsLeft: raw[4] },
    fuelTinybar: fuel.data as bigint | undefined,
    /** What the strategy would do right now, in words. */
    decision: explained?.[0],
    decisionValues: explained && ([explained[1], explained[2]] as const),
    isLoading: status.isLoading,
    refetch: async () => {
      await Promise.all([status.refetch(), fuel.refetch(), preview.refetch()]);
    },
  };
}

type VaultCall = {
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  /** Set when the call books a schedule and therefore needs the larger limit. */
  books?: boolean;
};

/**
 * Writes to a vault, with the scaffold's transaction notifications.
 *
 * Deliberately does not simulate first. A simulation of `arm` runs against the
 * relay's view of the Hedera Schedule Service at 0x16b, which is a system
 * contract the relay does not model; the call reads as failing when it would
 * succeed on chain. The vault validates its own preconditions with real
 * reverts, so the useful errors still surface.
 */
export function useVaultWrite(address?: Address) {
  const { chain } = useAccount();
  const selectedNetwork = useSelectedNetwork();
  const writeTx = useTransactor();
  const { writeContractAsync, isPending } = useWriteContract();

  const send = async ({ functionName, args = [], value, books }: VaultCall) => {
    if (!address) {
      notification.error("No vault yet — create one first.");
      return;
    }
    if (!chain?.id) {
      notification.error("Please connect your wallet");
      return;
    }
    if (chain.id !== selectedNetwork.id) {
      notification.error(`Wallet is on the wrong network. Please switch to ${selectedNetwork.name}`);
      return;
    }

    return writeTx(() =>
      writeContractAsync({
        abi: VAULT_ABI,
        address,
        functionName,
        args,
        value,
        gas: books ? GAS_BOOKING : GAS_PLAIN,
      }),
    );
  };

  return { send, isPending };
}
