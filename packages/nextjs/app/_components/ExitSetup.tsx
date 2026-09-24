"use client";

import { useState } from "react";
import { Panel } from "./ui";
import type { Address } from "viem";
import { encodeAbiParameters, parseAbiParameters, parseEther, parseUnits, toFunctionSelector } from "viem";
import { useReadContract } from "wagmi";
import { useDeployedContractInfo, useSelectedNetwork } from "~~/hooks/scaffold-hbar";
import { useVaultRead, useVaultWrite } from "~~/hooks/useNocturneVault";

/**
 * Arming a protective exit, one step at a time.
 *
 * This is deliberately not a single button. Setting a vault up to sell a real
 * position takes seven transactions, and each one exists for a reason a reader
 * should be able to see: two HTS associations because Hedera will not let an
 * account hold a token it has not opted into, two `setAllowedCall`s because
 * consent is per function rather than per contract, and a config that is
 * validated before it is stored rather than at 3am inside a scheduled call.
 *
 * **Every step reads its own completion from the chain.** Nothing is remembered
 * in the browser, so closing the tab half way through loses nothing and the
 * panel picks up wherever the chain actually is.
 */

// Verified on testnet — see ARCHITECTURE.md §3.5.
const WHBAR_TOKEN = "0x0000000000000000000000000000000000003aD2" as Address; // HTS, 8 dp
const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003aD1" as Address; // wrapper
const USDC = "0x0000000000000000000000000000000000001549" as Address; // HTS, 6 dp
const ROUTER = "0x0000000000000000000000000000000000159398" as Address; // V2 SwapRouter
const POOL = "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a" as Address;
const HBAR_USD = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a" as Address;

const WHBAR_DECIMALS = 8;
const USDC_DECIMALS = 6;

const APPROVE = toFunctionSelector("function approve(address,uint256)");
const EXACT_INPUT_SINGLE = toFunctionSelector(
  "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
);

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ExitSetup = ({ vault, onDone }: { vault: Address; onDone: () => Promise<void> }) => {
  const chainId = useSelectedNetwork().id;
  const { send, isPending } = useVaultWrite(vault);
  const { data: exitStrategy } = useDeployedContractInfo({ contractName: "ProtectiveExitStrategy" });

  const [position, setPosition] = useState("0.1");
  const [floor, setFloor] = useState("0.05");

  // Each of these is the chain's own answer to "has this step happened yet".
  const whbarAllowed = useVaultRead(vault, "allowedCall", [WHBAR_TOKEN, APPROVE]);
  const routerAllowed = useVaultRead(vault, "allowedCall", [ROUTER, EXACT_INPUT_SINGLE]);
  const config = useVaultRead(vault, "config");
  const held = useReadContract({
    chainId,
    address: WHBAR_TOKEN,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [vault],
    query: { enabled: !!vault, refetchInterval: 8_000, retry: false },
  });

  const hasPosition = ((held.data as bigint | undefined) ?? 0n) > 0n;
  const configured = ((config.data as string | undefined) ?? "0x").length > 2;
  const allowed = Boolean(whbarAllowed.data) && Boolean(routerAllowed.data);

  const refresh = async () => {
    await Promise.all([whbarAllowed.refetch(), routerAllowed.refetch(), config.refetch(), held.refetch()]);
    await onDone();
  };

  return (
    <Panel
      title="Set up a protective exit"
      subtitle="Seven transactions against live SaucerSwap and Chainlink. Each step checks the chain, so you can stop and come back."
    >
      <ol className="flex flex-col gap-4 m-0 p-0 list-none">
        <Step
          n={1}
          title="Let the vault hold WHBAR and USDC"
          detail="Hedera will not let an account receive a token it has not associated. Doing this after the swap would fail at delivery, once the approve had already landed. Safe to repeat — the vault records the response code either way."
          busy={isPending}
          action="Associate both"
          onClick={async () => {
            await send({ functionName: "associate", args: [WHBAR_TOKEN] });
            await send({ functionName: "associate", args: [USDC] });
            await refresh();
          }}
        />

        <Step
          n={2}
          title="Give it something to protect"
          detail="You need WHBAR in your own wallet first — wrap it below, then deposit."
          done={hasPosition}
          busy={isPending}
          action="Deposit"
          input={{ value: position, onChange: setPosition, suffix: "WHBAR" }}
          onClick={async () => {
            await send({
              functionName: "depositToken",
              args: [WHBAR_TOKEN, parseUnits(position || "0", WHBAR_DECIMALS)],
            });
            await refresh();
          }}
        />

        <Step
          n={3}
          title="Allow exactly two calls"
          detail="approve() on WHBAR and exactInputSingle() on the router. Allowing the token wholesale would also permit transfer(attacker, balance) — the same grant."
          done={allowed}
          busy={isPending}
          action="Allow both"
          onClick={async () => {
            await send({ functionName: "setAllowedCall", args: [WHBAR_TOKEN, APPROVE, true] });
            await send({ functionName: "setAllowedCall", args: [ROUTER, EXACT_INPUT_SINGLE, true] });
            await refresh();
          }}
        />

        <Step
          n={4}
          title="Set the floor and store the config"
          detail="Validated as it is stored. A bad config fails here, in front of you, rather than inside a scheduled call nobody is watching."
          done={configured}
          busy={isPending}
          action="Configure"
          input={{ value: floor, onChange: setFloor, suffix: "USDC floor" }}
          onClick={async () => {
            await send({ functionName: "configure", args: [encodeExitConfig(vault, parseEther(floor || "0"))] });
            await refresh();
          }}
        />
      </ol>

      <div className="divider my-4" />

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn btn-primary"
          disabled={isPending || !configured || !allowed || !exitStrategy}
          onClick={async () => {
            await send({ functionName: "arm", books: true });
            await refresh();
          }}
        >
          {isPending ? "Working…" : "Arm it"}
        </button>
        <span className="text-sm opacity-60 max-w-md">
          After this the network calls it. Expect the first run to <strong>refuse</strong> — the two sources are far
          apart on testnet, and refusing is the feature.
        </span>
      </div>

      <p className="text-xs opacity-50 mt-4 mb-0">
        No WHBAR yet? Wrap some by sending HBAR to <code className="text-xs">{WHBAR_CONTRACT}</code> via its{" "}
        <code className="text-xs">deposit()</code> function, then associate WHBAR with your own account. The script at{" "}
        <code className="text-xs">scripts/armExitVault.ts</code> does all of this in one command.
      </p>
    </Panel>
  );
};

const Step = ({
  n,
  title,
  detail,
  done,
  busy,
  action,
  input,
  onClick,
}: {
  n: number;
  title: string;
  detail: string;
  /** Omitted when the chain exposes no flag to read it back from. */
  done?: boolean;
  busy: boolean;
  action: string;
  input?: { value: string; onChange: (v: string) => void; suffix: string };
  onClick: () => Promise<void>;
}) => (
  <li className="flex gap-4 items-start">
    <span
      className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-sm font-semibold ${
        done ? "bg-success text-success-content" : "bg-base-300"
      }`}
      aria-hidden
    >
      {done ? "✓" : n}
    </span>
    <div className="grow">
      <div className="font-semibold">{title}</div>
      <p className="text-sm opacity-60 mt-0 mb-2">{detail}</p>
      <div className="flex flex-wrap items-center gap-2">
        {input ? (
          <div className="join">
            <input
              className="input input-bordered input-sm join-item w-24"
              value={input.value}
              inputMode="decimal"
              aria-label={input.suffix}
              onChange={e => input.onChange(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="btn btn-sm btn-disabled join-item no-animation">{input.suffix}</span>
          </div>
        ) : null}
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={onClick}>
          {busy ? "Working…" : action}
        </button>
      </div>
    </div>
  </li>
);

/**
 * `abi.encode` of `ProtectiveExitStrategy.Config`.
 *
 * Written out rather than fetched from `encodeConfig` on chain so the shape is
 * visible here: nine fields, then the nested `PriceGuard.Sources`. Both structs
 * are entirely static, so this is a flat tuple encode.
 */
function encodeExitConfig(vault: Address, floor1e18: bigint) {
  return encodeAbiParameters(
    parseAbiParameters(
      "address,address,address,address,uint24,uint256,uint256,uint8,uint8,(address,uint32,address,uint256,uint256,bool,uint8,uint8)",
    ),
    [
      vault,
      WHBAR_TOKEN,
      USDC,
      ROUTER,
      3000,
      floor1e18,
      500n, // 5% slippage on the swap's minimum output
      WHBAR_DECIMALS,
      USDC_DECIMALS,
      [
        POOL,
        60, // 60-second TWAP window
        HBAR_USD,
        86_400n, // generous: HBAR/USD updates on deviation as well as heartbeat
        200n, // 2% divergence tolerance — testnet will fail this, by design
        false, // WHBAR is token1 on this pool
        WHBAR_DECIMALS,
        USDC_DECIMALS,
      ],
    ],
  );
}
