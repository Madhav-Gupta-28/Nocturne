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
 * transaction reports SUCCESS, and the automation is silently dead.
 *
 * Headroom is not free, though, and the cost lands on the wallet rather than the
 * vault: the sender has to hold the whole limit times the gas price before the
 * relay will submit anything, even though only the gas burned is charged. Arming
 * measured 1,501,968 gas, so 2.5M is comfortable headroom that reserves ~2.9
 * HBAR, where 4M would reserve ~4.6 and can leave an owner unable to arm a vault
 * they just funded.
 */
const GAS_BOOKING = 2_500_000n;
const GAS_PLAIN = 1_000_000n;

/** Weibar per tinybar. The relay quotes gas prices 1e10 larger than the EVM. */
const WEIBAR_PER_TINYBAR = 10_000_000_000n;

/**
 * `NocturneVault.MIN_SCHEDULE_GAS`, which is what every schedule is booked with
 * and therefore what each one reserves. Mirrored here because the figure is
 * needed before any vault exists to be asked.
 */
const GAS_BOOKING_RESERVE = 3_000_000n;

/** `NocturneVault.GAS_PER_RUN`: what a run is charged for, as opposed to what it reserves. */
const GAS_PER_RUN = 1_500_000n;

/**
 * How many runs `tinybar` of fuel buys, by the vault's own `runway()` formula.
 *
 * The balance has to clear one reserve for a run to be accepted, and each run
 * then costs only the charge, so it is `(balance - reserve) / charge + 1`, not
 * `balance / reserve`. Dividing by the reserve quotes a 24 HBAR vault at 7 runs
 * when the contract will report 13.
 */
export function useRunsFor(tinybar: bigint | undefined): number | undefined {
  const chainId = useSelectedNetwork().id;
  const { data: weibarPerGas } = useGasPrice({ chainId });
  if (weibarPerGas === undefined || tinybar === undefined) return undefined;
  const reserve = (GAS_BOOKING_RESERVE * weibarPerGas) / WEIBAR_PER_TINYBAR;
  const charge = (GAS_PER_RUN * weibarPerGas) / WEIBAR_PER_TINYBAR;
  if (tinybar < reserve) return 0;
  return Number((tinybar - reserve) / charge + 1n);
}

/**
 * One `view` on a vault, by name.
 *
 * The dashboard needs a few reads that are not part of `status()` — which
 * strategy a vault runs, whether a given call is allowed, what it holds. Each is
 * cheap and independent, so they are fetched individually rather than bundled
 * into another aggregate view that would then need changing every time the UI
 * wants one more thing.
 */
export function useVaultRead(address: Address | undefined, functionName: string, args: readonly unknown[] = []) {
  const chainId = useSelectedNetwork().id;
  return useReadContract({
    chainId,
    address,
    abi: VAULT_ABI,
    functionName,
    args,
    query: { enabled: !!address, refetchInterval: 8_000, retry: false },
  });
}

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

/**
 * The network's gas price, in weibar, for sending as a legacy `gasPrice`.
 *
 * Without it a wallet sends an EIP-1559 transaction with `maxFeePerGas` at
 * about twice the network price, and the relay will not submit anything unless
 * the sender holds `maxFeePerGas x gasLimit`. For `createVault` at 4M gas that
 * is ~8.7 HBAR of headroom on top of the fuel, against ~4.6 with the network
 * price, and it fails as a bare "insufficient funds". Measured on testnet; the
 * charge afterwards is the same either way.
 */
export function useNetworkGasPrice(): bigint | undefined {
  const chainId = useSelectedNetwork().id;
  return useGasPrice({ chainId }).data;
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
  const gasPrice = useNetworkGasPrice();
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
        gasPrice,
      }),
    );
  };

  return { send, isPending };
}
