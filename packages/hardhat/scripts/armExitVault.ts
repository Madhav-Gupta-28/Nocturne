import { ethers, deployments, network } from "hardhat";

/**
 * Puts a real protective exit on testnet, end to end.
 *
 * This is the run that a mock cannot stand in for. It creates a vault, gives it
 * HTS tokens to hold, points it at the live SaucerSwap pool and the live
 * Chainlink feed, and arms it — after which the network, not this script, is
 * what calls it.
 *
 *   npx hardhat run scripts/armExitVault.ts --network hederaTestnet
 *
 * **Expect it to refuse.** The testnet pool prices WHBAR around $2.04 while
 * Chainlink reports roughly $0.094, because nothing arbitrages a testnet. That
 * is a ~21.7x divergence, so `PriceGuard` declines to act and the vault records
 * `Refused` with a reason rather than selling into a price it cannot
 * corroborate. Refusing is the feature; watching it refuse against real
 * contracts is the point of this script.
 *
 * To then prove the action path, re-run with `TOLERATE_DIVERGENCE=1`. That sets
 * a deliberately absurd `maxDivergenceBps`, which lets the same code plan and
 * execute an actual swap. It is not a realistic configuration and the script
 * says so on the way past; it exists so the approve-and-swap path is proven on
 * chain rather than only against mocks.
 */

// Verified on testnet — see ARCHITECTURE.md §3.5.
const WHBAR_TOKEN = "0x0000000000000000000000000000000000003aD2"; // HTS token, 8 dp
const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003aD1"; // wrapper, deposit()
const USDC = "0x0000000000000000000000000000000000001549"; // HTS token, 6 dp
const ROUTER = "0x0000000000000000000000000000000000159398"; // V2 SwapRouter (has deadline)
const POOL = "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a"; // WHBAR/USDC 0.3%
const HBAR_USD = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a"; // Chainlink HBAR/USD

/** HTS precompile. Association is required before an account may hold a token. */
const HTS = "0x0000000000000000000000000000000000000167";

const WHBAR_DECIMALS = 8;
const USDC_DECIMALS = 6;

/** HBAR to leave in the vault. Each run reserves ~3.27, so this is two runs. */
const FUEL_HBAR = process.env.FUEL_HBAR ?? "7";

/** WHBAR for the vault to protect. Small on purpose — the pool is thin. */
const POSITION_WHBAR = process.env.POSITION_WHBAR ?? "0.1";

/**
 * Floor, in USDC per WHBAR, 1e18.
 *
 * Set above the pool price so the floor is already broken and the strategy wants
 * to exit. Whether it *may* exit is then entirely down to the price guard, which
 * is the thing being tested.
 */
const FLOOR_1E18 = ethers.parseEther(process.env.FLOOR ?? "5");

/** Realistic tolerance, unless asked to ignore the testnet's broken pricing. */
const TOLERATE = process.env.TOLERATE_DIVERGENCE === "1";
const MAX_DIVERGENCE_BPS = TOLERATE ? 10_000_000n : 200n;

const hbar = (tinybar: bigint) => (Number(tinybar) / 1e8).toFixed(4);

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`network  ${network.name}`);
  console.log(`owner    ${owner.address}`);
  if (TOLERATE) {
    console.log(`\n!! TOLERATE_DIVERGENCE=1 — divergence tolerance is absurd on purpose.`);
    console.log(`!! This proves the swap path executes. It is not a sane configuration.\n`);
  }

  const strategyAddr = (await deployments.get("ProtectiveExitStrategy")).address;
  const factoryAddr = (await deployments.get("NocturneFactory")).address;
  const factory = await ethers.getContractAt("NocturneFactory", factoryAddr);
  const strategy = await ethers.getContractAt("ProtectiveExitStrategy", strategyAddr);

  // 1. The owner must be able to hold WHBAR before it can hand any to a vault.
  //    An account created from an EVM key has no automatic association slots.
  const hts = await ethers.getContractAt("IHederaTokenService", HTS);
  console.log(`associating WHBAR with the owner...`);
  await send(hts.associateToken(owner.address, WHBAR_TOKEN, { gasLimit: 800_000 }), "already associated");

  // 2. Wrap HBAR into WHBAR. `deposit()` credits msg.sender.
  const position = ethers.parseUnits(POSITION_WHBAR, WHBAR_DECIMALS);
  const whbar = await ethers.getContractAt("IERC20", WHBAR_TOKEN);
  if ((await whbar.balanceOf(owner.address)) < position) {
    console.log(`wrapping ${POSITION_WHBAR} HBAR into WHBAR...`);
    const wrapper = new ethers.Contract(WHBAR_CONTRACT, ["function deposit() payable"], owner);
    // Weibar over JSON-RPC; the relay divides by 1e10 on the way in.
    await (await wrapper.deposit({ value: ethers.parseEther(POSITION_WHBAR), gasLimit: 800_000 })).wait();
  }
  console.log(`owner holds ${ethers.formatUnits(await whbar.balanceOf(owner.address), WHBAR_DECIMALS)} WHBAR`);

  // 3. Create the vault, funded in the same transaction.
  console.log(`\ncreating a vault with ${FUEL_HBAR} HBAR of fuel...`);
  const createTx = await factory.createVault(strategyAddr, {
    value: ethers.parseEther(FUEL_HBAR),
    gasLimit: 4_000_000,
  });
  await createTx.wait();
  const vaultAddr = await factory.latestVaultOf(owner.address);
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);
  console.log(`vault    ${vaultAddr}`);

  // 4. The vault must associate both sides: WHBAR to hold the position, USDC to
  //    receive the proceeds. A swap into an unassociated token fails at
  //    delivery, after the approve has already landed.
  for (const [name, token] of [
    ["WHBAR", WHBAR_TOKEN],
    ["USDC", USDC],
  ] as const) {
    console.log(`associating ${name} with the vault...`);
    const rc = await vault.associate.staticCall(token);
    await (await vault.associate(token, { gasLimit: 800_000 })).wait();
    console.log(`  response code ${rc}`);
  }

  // 5. Move the position in.
  console.log(`\ndepositing ${POSITION_WHBAR} WHBAR into the vault...`);
  await (await whbar.approve(vaultAddr, position, { gasLimit: 800_000 })).wait();
  await (await vault.depositToken(WHBAR_TOKEN, position, { gasLimit: 900_000 })).wait();

  // 6. Say where the strategy may reach. Both are needed: the token for the
  //    approve, the router for the swap. A plan touching anything else is
  //    rejected whole.
  for (const [name, target] of [
    ["WHBAR token", WHBAR_TOKEN],
    ["router", ROUTER],
  ] as const) {
    console.log(`allowing ${name} as a target...`);
    await (await vault.setAllowedTarget(target, true, { gasLimit: 500_000 })).wait();
  }

  // 7. Configure, which validates. A bad config fails here rather than at 3am.
  const config = await strategy.encodeConfig({
    vault: vaultAddr,
    asset: WHBAR_TOKEN,
    quote: USDC,
    router: ROUTER,
    fee: 3000,
    floorPrice1e18: FLOOR_1E18,
    slippageBps: 500,
    assetDecimals: WHBAR_DECIMALS,
    quoteDecimals: USDC_DECIMALS,
    sources: {
      pool: POOL,
      twapWindow: 60,
      feed: HBAR_USD,
      maxFeedAge: 86_400n,
      maxDivergenceBps: MAX_DIVERGENCE_BPS,
      assetIsToken0: false, // WHBAR is token1 on this pool — verified on chain
      assetDecimals: WHBAR_DECIMALS,
      quoteDecimals: USDC_DECIMALS,
    },
  });
  console.log(`configuring (floor ${ethers.formatEther(FLOOR_1E18)} USDC, tolerance ${MAX_DIVERGENCE_BPS} bps)...`);
  await (await vault.configure(config, { gasLimit: 1_000_000 })).wait();

  // What it would do right now, before anything is scheduled.
  const [state, a, b] = await vault.preview();
  console.log(`\nthe strategy says: "${state}"  (${a}, ${b})`);

  // 8. Arm. 2.5M rather than 4M: the owner has to hold the whole limit times
  //    the gas price, and arming only burns about 1.5M.
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
async function send(pending: Promise<{ wait: () => Promise<unknown> }>, benign: string) {
  try {
    await (await pending).wait();
  } catch (e) {
    const message = (e as Error).message ?? "";
    console.log(`  (${benign}? continuing — ${message.slice(0, 80)})`);
  }
}

main().catch(e => {
  console.error(e.message ?? e);
  process.exit(1);
});
