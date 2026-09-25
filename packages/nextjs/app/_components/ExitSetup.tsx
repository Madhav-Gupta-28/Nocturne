"use client";

import { useState } from "react";
import { Panel } from "./ui";
import type { Address } from "viem";
import { encodeAbiParameters, parseAbiParameters, parseEther, parseUnits, toFunctionSelector } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useSelectedNetwork, useTransactor } from "~~/hooks/scaffold-hbar";
import { useNetworkGasPrice, useVaultRead, useVaultWrite } from "~~/hooks/useNocturneVault";

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

// Verified on testnet — see ARCHITECTURE.md §3.5 and §3.6.
const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003aD1" as Address; // wrapper
const USDC = "0x0000000000000000000000000000000000001549" as Address; // HTS, 6 dp
const ROUTER = "0x0000000000000000000000000000000000159398" as Address; // V2 SwapRouter
const USDC_DECIMALS = 6;

/**
 * The two markets a vault can protect, with the settings the demo scripts use.
 *
 * They differ in one way that matters: whether the pool agrees with Chainlink.
 * The USDC/DAI pool tracks DAI/USD to a fraction of a percent, so a vault there
 * sells when its floor breaks. The USDC/WHBAR pool sits ~22x from HBAR/USD
 * because nothing arbitrages a testnet, so a vault there refuses. Same code,
 * same 2% tolerance; the market decides.
 */
const MARKETS = {
  DAI: {
    token: "0x0000000000000000000000000000000000001599" as Address, // HTS, 8 dp
    decimals: 8,
    pool: "0xb431866114b634f611774ec0d094bf11cb91c7e4" as Address, // USDC/DAI 0.05%
    fee: 500,
    feed: "0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389" as Address, // Chainlink DAI/USD
    maxFeedAge: 90_000n, // longer than the feed's 24h heartbeat, which lands up to 36s late
    floor: "1.001",
    position: "1",
    expect: "The pool agrees with Chainlink, so with a floor above today's price the first run sells.",
    howToGet: "Buy DAI on SaucerSwap, or run scripts/armExitVault.ts with PRESET=sell, which buys it for you.",
  },
  WHBAR: {
    token: "0x0000000000000000000000000000000000003aD2" as Address, // HTS, 8 dp
    decimals: 8,
    pool: "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a" as Address, // USDC/WHBAR 0.30%
    fee: 3000,
    feed: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a" as Address, // Chainlink HBAR/USD
    maxFeedAge: 86_400n, // HBAR/USD also updates on deviation
    floor: "0.10",
    position: "0.1",
    expect: "The pool is ~22x from Chainlink on testnet, so the first run refuses. Refusing is the feature.",
    howToGet: `Wrap HBAR by calling deposit() on ${WHBAR_CONTRACT}, after associating WHBAR with your account.`,
  },
} as const;

type MarketName = keyof typeof MARKETS;

const APPROVE = toFunctionSelector("function approve(address,uint256)");
const EXACT_INPUT_SINGLE = toFunctionSelector(
  "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
);

/**
 * An HTS token approval runs through the token's EVM facade and costs far more
 * than an ERC-20 one; 600k gas ran out of gas on testnet, 1M did not.
 */
const APPROVE_GAS = 1_000_000n;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
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

  const [market, setMarket] = useState<MarketName>("DAI");
  const m = MARKETS[market];
  const [position, setPosition] = useState<string>(m.position);
  const [floor, setFloor] = useState<string>(m.floor);

  const choose = (name: MarketName) => {
    setMarket(name);
    setPosition(MARKETS[name].position);
    setFloor(MARKETS[name].floor);
  };

  // The deposit is a pull: the vault calls transferFrom, so the wallet has to
  // approve the vault for the amount first. That approval is sent to the token,
  // from the wallet, not through the vault.
  const writeTx = useTransactor();
  const gasPrice = useNetworkGasPrice();
  const { writeContractAsync } = useWriteContract();
  const approveVault = (amount: bigint) =>
    writeTx(() =>
      writeContractAsync({
        address: m.token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vault, amount],
        gas: APPROVE_GAS,
        gasPrice,
      }),
    );

  // Each of these is the chain's own answer to "has this step happened yet".
  const tokenAllowed = useVaultRead(vault, "allowedCall", [m.token, APPROVE]);
  const routerAllowed = useVaultRead(vault, "allowedCall", [ROUTER, EXACT_INPUT_SINGLE]);
  const config = useVaultRead(vault, "config");
  const held = useReadContract({
    chainId,
    address: m.token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [vault],
    query: { enabled: !!vault, refetchInterval: 8_000, retry: false },
  });

  const hasPosition = ((held.data as bigint | undefined) ?? 0n) > 0n;
  const configured = ((config.data as string | undefined) ?? "0x").length > 2;
  const allowed = Boolean(tokenAllowed.data) && Boolean(routerAllowed.data);

  const refresh = async () => {
    await Promise.all([tokenAllowed.refetch(), routerAllowed.refetch(), config.refetch(), held.refetch()]);
    await onDone();
  };

  return (
    <Panel
      title="Set up a protective exit"
      subtitle="Seven transactions against live SaucerSwap and Chainlink. Each step checks the chain, so you can stop and come back."
    >
      <div className="mb-6 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Market">
        <span className="eyebrow mr-2">Market</span>
        {(Object.keys(MARKETS) as MarketName[]).map(name => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={market === name}
            onClick={() => choose(name)}
            className={`eyebrow cursor-pointer border px-3 py-1.5 transition-colors ${
              market === name ? "border-signal text-signal" : "border-line text-paper-dim hover:text-paper"
            }`}
          >
            {name} / USDC
          </button>
        ))}
      </div>

      <ol className="flex flex-col gap-4 m-0 p-0 list-none">
        <Step
          n={1}
          title={`Let the vault hold ${market} and USDC`}
          detail="Hedera will not let an account receive a token it has not associated. Doing this after the swap would fail at delivery, once the approve had already landed. Safe to repeat — the vault records the response code either way."
          busy={isPending}
          action="Associate both"
          onClick={async () => {
            await send({ functionName: "associate", args: [m.token] });
            await send({ functionName: "associate", args: [USDC] });
            await refresh();
          }}
        />

        <Step
          n={2}
          title="Give it something to protect"
          detail={`You need ${market} in your own wallet first. ${m.howToGet}`}
          done={hasPosition}
          busy={isPending}
          action="Approve and deposit"
          input={{ value: position, onChange: setPosition, suffix: market }}
          onClick={async () => {
            const amount = parseUnits(position || "0", m.decimals);
            await approveVault(amount);
            await send({ functionName: "depositToken", args: [m.token, amount] });
            await refresh();
          }}
        />

        <Step
          n={3}
          title="Allow exactly two calls"
          detail={`approve() on ${market} and exactInputSingle() on the router. Allowing the token wholesale would also permit transfer(attacker, balance), the same grant.`}
          done={allowed}
          busy={isPending}
          action="Allow both"
          onClick={async () => {
            await send({ functionName: "setAllowedCall", args: [m.token, APPROVE, true] });
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
            await send({
              functionName: "configure",
              args: [encodeExitConfig(vault, market, parseEther(floor || "0"))],
            });
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
        <span className="text-sm opacity-60 max-w-md">After this the network calls it. {m.expect}</span>
      </div>
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
function encodeExitConfig(vault: Address, market: MarketName, floor1e18: bigint) {
  const m = MARKETS[market];
  return encodeAbiParameters(
    parseAbiParameters(
      "address,address,address,address,uint24,uint256,uint256,uint8,uint8,(address,uint32,address,uint256,uint256,bool,uint8,uint8)",
    ),
    [
      vault,
      m.token,
      USDC,
      ROUTER,
      m.fee,
      floor1e18,
      100n, // 1% slippage on the swap's minimum output
      m.decimals,
      USDC_DECIMALS,
      [
        m.pool,
        1800, // 30-minute TWAP, so one trade cannot move the reading
        m.feed,
        m.maxFeedAge,
        200n, // 2% divergence tolerance, the stock setting
        false, // USDC is token0 on both pools, so the asset is token1
        m.decimals,
        USDC_DECIMALS,
      ],
    ],
  );
}
