import { ethers, deployments, network } from "hardhat";
import type { NocturneVault, ProtectiveExitStrategy } from "../typechain-types";

/**
 * Puts a real protective exit on testnet, end to end.
 *
 * This is the run a mock cannot stand in for. It creates a vault, gives it an
 * HTS token to hold, points it at a live SaucerSwap V2 pool and a live
 * Chainlink feed, and arms it. After that the network, not this script, is what
 * calls it.
 *
 *   PRESET=refuse npx hardhat run scripts/armExitVault.ts --network hederaTestnet
 *
 * Every preset uses the same code and the same 2% divergence tolerance. What
 * differs is the market each vault is pointed at.
 *
 *   refuse  WHBAR on the WHBAR/USDC pool, floor $0.10. Chainlink puts HBAR
 *           below the floor, so the owner wants out. But the pool prices WHBAR
 *           near $2.04 — nothing arbitrages a testnet — so the two sources are
 *           ~22x apart and the vault refuses to sell into a price it cannot
 *           corroborate.
 *
 *   sell    DAI on the USDC/DAI pool, floor $1.001: sell the moment DAI is
 *           below its peg. This pool and Chainlink's DAI/USD agree to within a
 *           fraction of a percent, so the same guard passes and the vault sells
 *           through the SaucerSwap router. On testnet the feed sits a hair
 *           under $1, so the floor is already broken on arrival.
 *
 *   guard   DAI again, with a depeg floor of $0.85. Far enough from the price
 *           that the strategy checks every six hours and holds. This is the
 *           configuration you would actually run, and the one left on duty.
 *
 * Pass `VAULT=0x...` to retune a vault that already exists instead of building
 * another. Association, position and allow-list are then skipped; the script
 * reconfigures, optionally tops up the fuel (`TOP_UP`) and re-arms. `configure`
 * disarms by design, so re-arming is not optional.
 */

// Verified on testnet — see ARCHITECTURE.md §3.5 and §3.6.
const WHBAR_TOKEN = "0x0000000000000000000000000000000000003aD2"; // HTS, 8 dp
const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003aD1"; // wrapper, deposit()
const USDC = "0x0000000000000000000000000000000000001549"; // HTS, 6 dp
const DAI = "0x0000000000000000000000000000000000001599"; // HTS, 8 dp
const ROUTER = "0x0000000000000000000000000000000000159398"; // V2 SwapRouter (has deadline)

/** HTS precompile. Association is required before an account may hold a token. */
const HTS = "0x0000000000000000000000000000000000000167";

type Pair = {
  label: string;
  asset: string;
  assetDecimals: number;
  pool: string;
  fee: number;
  feed: string;
  /**
   * Longer than the feed's heartbeat, or the vault refuses "feed stale" for a
   * stretch of every cycle. DAI/USD updates every 24h and was measured landing
   * up to 36s late, so 24h exactly would not do.
   */
  maxFeedAge: bigint;
};

const PAIRS = {
  whbar: {
    label: "WHBAR",
    asset: WHBAR_TOKEN,
    assetDecimals: 8,
    pool: "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a", // USDC/WHBAR 0.30%
    fee: 3000,
    feed: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a", // Chainlink HBAR/USD
    maxFeedAge: 86_400n, // HBAR/USD also updates on deviation
  },
  dai: {
    label: "DAI",
    asset: DAI,
    assetDecimals: 8,
    pool: "0xb431866114b634f611774ec0d094bf11cb91c7e4", // USDC/DAI 0.05%
    fee: 500,
    feed: "0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389", // Chainlink DAI/USD
    maxFeedAge: 90_000n,
  },
} satisfies Record<string, Pair>;

const PRESETS = {
  refuse: { pair: PAIRS.whbar, floor: "0.10", position: "0.1", fuel: "7" },
  sell: { pair: PAIRS.dai, floor: "1.001", position: "1", fuel: "7" },
  guard: { pair: PAIRS.dai, floor: "0.85", position: "1", fuel: "40" },
} as const;

const PRESET = (process.env.PRESET ?? "refuse") as keyof typeof PRESETS;
if (!(PRESET in PRESETS)) throw new Error(`PRESET must be one of ${Object.keys(PRESETS).join(", ")}`);
const { pair } = PRESETS[PRESET];

const FLOOR = process.env.FLOOR ?? PRESETS[PRESET].floor;
const POSITION = process.env.POSITION ?? PRESETS[PRESET].position;
const FUEL_HBAR = process.env.FUEL_HBAR ?? PRESETS[PRESET].fuel;

/** The stock tolerance. Nothing here widens it. */
const MAX_DIVERGENCE_BPS = 200n;

/** Thirty minutes of pool history, so one trade cannot move the reading. */
const TWAP_WINDOW = 1800;

const USDC_DECIMALS = 6;

/** An existing vault to retune, instead of creating one. */
const EXISTING = process.env.VAULT;

/** HBAR to add to an existing vault's fuel before re-arming. */
const TOP_UP = process.env.TOP_UP;

const hbar = (tinybar: bigint) => (Number(tinybar) / 1e8).toFixed(4);

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`network  ${network.name}`);
  console.log(`owner    ${owner.address}`);
  console.log(`preset   ${PRESET}: ${pair.label}, floor $${FLOOR}, tolerance ${MAX_DIVERGENCE_BPS} bps`);

  const strategy = await ethers.getContractAt(
    "ProtectiveExitStrategy",
    (await deployments.get("ProtectiveExitStrategy")).address,
  );

  const vaultAddr = EXISTING ? await retune() : await build();
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);

  await configure(vault, vaultAddr, strategy);
  await arm(vault, vaultAddr);
}

/**
 * Everything a vault needs exactly once: tokens it may hold, a position, and
 * the calls its strategy is allowed to make.
 */
async function build(): Promise<string> {
  const [owner] = await ethers.getSigners();
  const factory = await ethers.getContractAt("NocturneFactory", (await deployments.get("NocturneFactory")).address);
  const strategyAddr = (await deployments.get("ProtectiveExitStrategy")).address;

  const position = ethers.parseUnits(POSITION, pair.assetDecimals);
  await acquire(pair, position);

  console.log(`\ncreating a vault with ${FUEL_HBAR} HBAR of fuel...`);
  await (await factory.createVault(strategyAddr, { value: ethers.parseEther(FUEL_HBAR), gasLimit: 4_000_000 })).wait();
  const vaultAddr = await factory.latestVaultOf(owner.address);
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);
  console.log(`vault    ${vaultAddr}`);

  // Both sides must be associated: the asset to hold the position, USDC to
  // receive the proceeds. A swap into an unassociated token fails at delivery,
  // after the approve has already landed.
  for (const [name, token] of [
    [pair.label, pair.asset],
    ["USDC", USDC],
  ] as const) {
    const rc = await vault.associate.staticCall(token);
    await (await vault.associate(token, { gasLimit: 800_000 })).wait();
    console.log(`associated ${name} with the vault — response code ${rc}`);
  }

  const asset = await ethers.getContractAt("IERC20", pair.asset);
  console.log(`\ndepositing ${POSITION} ${pair.label} into the vault...`);
  await (await asset.approve(vaultAddr, position, { gasLimit: 800_000 })).wait();
  await (await vault.depositToken(pair.asset, position, { gasLimit: 900_000 })).wait();

  // Exactly two calls, named by function rather than by address. Allowing the
  // token wholesale would also permit `transfer(attacker, balance)` — the same
  // grant the legitimate approve needs.
  const router = await ethers.getContractAt("ISwapRouter", ROUTER);
  for (const [name, target, selector] of [
    [`${pair.label}.approve`, pair.asset, asset.interface.getFunction("approve")!.selector],
    ["router.exactInputSingle", ROUTER, router.interface.getFunction("exactInputSingle")!.selector],
  ] as const) {
    console.log(`allowing ${name}...`);
    await (await vault.setAllowedCall(target, selector, true, { gasLimit: 500_000 })).wait();
  }

  return vaultAddr;
}

/**
 * Get the owner enough of the asset to hand the vault.
 *
 * WHBAR is wrapped from HBAR. DAI has no faucet, so it is bought: HBAR is
 * wrapped, sold for USDC on the WHBAR/USDC pool, and the USDC sold for DAI.
 * The first leg rides the testnet pool's inflated WHBAR price, which makes the
 * stablecoin cheap to come by — the same drift the refuse preset refuses.
 */
async function acquire(p: Pair, amount: bigint) {
  const [owner] = await ethers.getSigners();
  const hts = await ethers.getContractAt("IHederaTokenService", HTS);
  const wanted = p.asset === WHBAR_TOKEN ? [WHBAR_TOKEN] : [WHBAR_TOKEN, USDC, p.asset];

  // An account created from an EVM key has no automatic association slots.
  for (const token of wanted) {
    await tolerate(hts.associateToken(owner.address, token, { gasLimit: 800_000 }), "already associated");
  }

  const asset = await ethers.getContractAt("IERC20", p.asset);
  const held = await asset.balanceOf(owner.address);
  if (held >= amount) return console.log(`owner holds ${ethers.formatUnits(held, p.assetDecimals)} ${p.label}`);

  const whbar = await ethers.getContractAt("IERC20", WHBAR_TOKEN);
  const wrapper = new ethers.Contract(WHBAR_CONTRACT, ["function deposit() payable"], owner);
  const router = await ethers.getContractAt("ISwapRouter", ROUTER);
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 300);

  if (p.asset === WHBAR_TOKEN) {
    console.log(`wrapping ${POSITION} HBAR into WHBAR...`);
    // Weibar over JSON-RPC; the relay divides by 1e10 on the way in.
    await (await wrapper.deposit({ value: ethers.parseEther(POSITION), gasLimit: 800_000 })).wait();
    return;
  }

  // One WHBAR buys roughly two USDC on the drifted pool. Wrap enough for the
  // whole position at half that rate, and sell all of it.
  const whbarIn = ethers.parseUnits(POSITION, 8);
  console.log(`wrapping ${POSITION} HBAR and selling it for USDC...`);
  await (await wrapper.deposit({ value: ethers.parseEther(POSITION), gasLimit: 800_000 })).wait();
  await (await whbar.approve(ROUTER, whbarIn, { gasLimit: 800_000 })).wait();
  await (
    await router.exactInputSingle(
      {
        tokenIn: WHBAR_TOKEN,
        tokenOut: USDC,
        fee: 3000,
        recipient: owner.address,
        deadline: deadline(),
        amountIn: whbarIn,
        amountOutMinimum: 1n,
        sqrtPriceLimitX96: 0n,
      },
      { gasLimit: 2_000_000 },
    )
  ).wait();

  const usdc = await ethers.getContractAt("IERC20", USDC);
  const usdcIn = await usdc.balanceOf(owner.address);
  // DAI sits within a fraction of a percent of USDC; demand at least 98%.
  const minOut = (usdcIn * 98n * 10n ** BigInt(p.assetDecimals - USDC_DECIMALS)) / 100n;
  console.log(`selling ${ethers.formatUnits(usdcIn, USDC_DECIMALS)} USDC for ${p.label}...`);
  await (await usdc.approve(ROUTER, usdcIn, { gasLimit: 800_000 })).wait();
  await (
    await router.exactInputSingle(
      {
        tokenIn: USDC,
        tokenOut: p.asset,
        fee: p.fee,
        recipient: owner.address,
        deadline: deadline(),
        amountIn: usdcIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
      { gasLimit: 2_000_000 },
    )
  ).wait();

  const now = await asset.balanceOf(owner.address);
  console.log(`owner holds ${ethers.formatUnits(now, p.assetDecimals)} ${p.label}`);
  if (now < amount) throw new Error(`still short of ${POSITION} ${p.label}`);
}

/** Picks up a vault that already has its tokens, position and allow-list. */
async function retune(): Promise<string> {
  const vaultAddr = EXISTING as string;
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);
  console.log(`\nretuning existing vault ${vaultAddr}`);

  if (TOP_UP) {
    console.log(`topping up ${TOP_UP} HBAR of fuel...`);
    await (await vault.depositHbar({ value: ethers.parseEther(TOP_UP), gasLimit: 500_000 })).wait();
  }
  console.log(`balance  ${hbar(await vault.fuel())} HBAR`);
  return vaultAddr;
}

/** Store the configuration, which validates it. A bad one fails here, not at 3am. */
async function configure(vault: NocturneVault, vaultAddr: string, strategy: ProtectiveExitStrategy) {
  const config = await strategy.encodeConfig({
    vault: vaultAddr,
    asset: pair.asset,
    quote: USDC,
    router: ROUTER,
    fee: pair.fee,
    floorPrice1e18: ethers.parseEther(FLOOR),
    slippageBps: 100,
    assetDecimals: pair.assetDecimals,
    quoteDecimals: USDC_DECIMALS,
    sources: {
      pool: pair.pool,
      twapWindow: TWAP_WINDOW,
      feed: pair.feed,
      maxFeedAge: pair.maxFeedAge,
      maxDivergenceBps: MAX_DIVERGENCE_BPS,
      assetIsToken0: false, // USDC is token0 on both pools — verified on chain
      assetDecimals: pair.assetDecimals,
      quoteDecimals: USDC_DECIMALS,
    },
  });
  console.log(`\nconfiguring...`);
  // configure() disarms and releases any pending schedule, by design.
  await (await vault.configure(config, { gasLimit: 1_000_000 })).wait();

  const [state, a, b] = await vault.preview();
  console.log(`the strategy says: "${state}"  (${a}, ${b})`);
}

/**
 * Arm, and report what the vault now believes about itself.
 *
 * 2.5M gas rather than 4M: the sender has to hold the whole limit times the gas
 * price before the relay will submit, and arming only burns about 1.5M.
 */
async function arm(vault: NocturneVault, vaultAddr: string) {
  console.log(`arming...`);
  await (await vault.arm({ gasLimit: 2_500_000 })).wait();

  const [armed, runs, refusals, nextAt, runsLeft] = await vault.status();
  console.log(`\narmed    ${armed}`);
  console.log(`runs     ${runs}   refusals ${refusals}`);
  console.log(`next run ${new Date(Number(nextAt) * 1000).toISOString()}`);
  console.log(`balance  ${hbar(await vault.fuel())} HBAR`);
  console.log(`reserve  ${hbar(await vault.reservePerRun())} HBAR per run`);
  console.log(`runway   ${runsLeft} runs`);
  console.log(`schedule 0.0.${BigInt(await vault.nextSchedule())}`);

  console.log(`\n--- verify without trusting any of this ---`);
  console.log(`vault   https://hashscan.io/testnet/contract/${vaultAddr}`);
  console.log(`mirror  https://testnet.mirrornode.hedera.com/api/v1/contracts/${vaultAddr}/results/logs`);
  console.log(`\nSend nothing else. The next call comes from the network.`);
}

/** Runs a transaction, tolerating one specific already-done failure. */
async function tolerate(pending: Promise<{ wait: () => Promise<unknown> }>, benign: string) {
  try {
    await (await pending).wait();
  } catch (e) {
    console.log(`  (${benign}? continuing — ${((e as Error).message ?? "").slice(0, 80)})`);
  }
}

main().catch(e => {
  console.error(e.message ?? e);
  process.exit(1);
});
