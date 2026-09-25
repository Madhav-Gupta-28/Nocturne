import { ethers, deployments, network } from "hardhat";
import { PAIRS, ROUTER, USDC, USDC_DECIMALS, acquire, networkGasPrice } from "./lib/testnetTokens";

/**
 * Puts a real drift rebalance on testnet.
 *
 * The exit strategy is one-way and terminal. This one trades in whichever
 * direction restores a target ratio, and keeps doing it: the same engine, the
 * same four interface functions, a different shape of decision. Running it on
 * chain is what turns "the interface generalises" from a claim into a receipt.
 *
 *   npx hardhat run scripts/armRebalanceVault.ts --network hederaTestnet
 *
 * It uses the USDC/DAI pool, because that pool and Chainlink's DAI/USD agree to
 * a fraction of a percent, so the guard passes at the stock 2% tolerance. The
 * vault starts holding only DAI against a 50% target, which is 50 points of
 * drift: the first run sells about half of it for USDC. After that it sits
 * inside the band and checks every twelve hours.
 */

const FUEL_HBAR = process.env.FUEL_HBAR ?? "7";

/** DAI to start with. One HBAR buys about two, so this also sets the HBAR spent. */
const POSITION = process.env.POSITION ?? "1";

/** Hold half the value in DAI, and act once drift passes 1%. */
const TARGET_BPS_A = 5000;
const BAND_BPS = Number(process.env.BAND_BPS ?? 100);

/** The stock tolerance. Nothing here widens it. */
const MAX_DIVERGENCE_BPS = 200n;

const hbar = (t: bigint) => (Number(t) / 1e8).toFixed(4);

async function main() {
  const [owner] = await ethers.getSigners();
  const pair = PAIRS.dai;
  console.log(`network  ${network.name}`);
  console.log(`owner    ${owner.address}`);

  const strategyAddr = (await deployments.get("DriftRebalanceStrategy")).address;
  const factory = await ethers.getContractAt("NocturneFactory", (await deployments.get("NocturneFactory")).address);
  const strategy = await ethers.getContractAt("DriftRebalanceStrategy", strategyAddr);

  const position = ethers.parseUnits(POSITION, pair.assetDecimals);
  await acquire(pair, position, POSITION);

  console.log(`\ncreating a vault with ${FUEL_HBAR} HBAR of fuel...`);
  const gasPrice = await networkGasPrice();
  await (
    await factory.createVault(strategyAddr, { value: ethers.parseEther(FUEL_HBAR), gasLimit: 4_000_000, gasPrice })
  ).wait();
  const vaultAddr = await factory.latestVaultOf(owner.address);
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);
  console.log(`vault    ${vaultAddr}`);

  // Both sides, because this strategy trades in either direction and so may end
  // up holding either token.
  for (const [name, token] of [
    [pair.label, pair.asset],
    ["USDC", USDC],
  ] as const) {
    const rc = await vault.associate.staticCall(token);
    await (await vault.associate(token, { gasLimit: 800_000 })).wait();
    console.log(`associated ${name} — response code ${rc}`);
  }

  console.log(`\ndepositing ${POSITION} ${pair.label}...`);
  const dai = await ethers.getContractAt("IERC20", pair.asset);
  await (await dai.approve(vaultAddr, position, { gasLimit: 800_000 })).wait();
  await (await vault.depositToken(pair.asset, position, { gasLimit: 900_000 })).wait();

  // Three grants, not two: a two-way strategy may need to approve either token.
  const router = await ethers.getContractAt("ISwapRouter", ROUTER);
  const approve = dai.interface.getFunction("approve")!.selector;
  const swap = router.interface.getFunction("exactInputSingle")!.selector;
  for (const [name, target, selector] of [
    [`${pair.label}.approve`, pair.asset, approve],
    ["USDC.approve", USDC, approve],
    ["router.exactInputSingle", ROUTER, swap],
  ] as const) {
    console.log(`allowing ${name}...`);
    await (await vault.setAllowedCall(target, selector, true, { gasLimit: 500_000 })).wait();
  }

  const config = await strategy.encodeConfig({
    vault: vaultAddr,
    assetA: pair.asset,
    assetB: USDC,
    router: ROUTER,
    fee: pair.fee,
    targetBpsA: TARGET_BPS_A,
    bandBps: BAND_BPS,
    // A correction smaller than this costs more than it fixes.
    minTradeValue1e18: ethers.parseEther("0.01"),
    slippageBps: 100,
    decimalsA: pair.assetDecimals,
    decimalsB: USDC_DECIMALS,
    sources: {
      pool: pair.pool,
      twapWindow: 1800,
      feed: pair.feed,
      maxFeedAge: pair.maxFeedAge,
      maxDivergenceBps: MAX_DIVERGENCE_BPS,
      assetIsToken0: false,
      assetDecimals: pair.assetDecimals,
      quoteDecimals: USDC_DECIMALS,
    },
  });
  console.log(`\nconfiguring (target ${TARGET_BPS_A / 100}% in ${pair.label}, band ${BAND_BPS / 100}%)...`);
  await (await vault.configure(config, { gasLimit: 1_000_000 })).wait();

  const [state, a, b] = await vault.preview();
  console.log(`the strategy says: "${state}"  (${a}, ${b})`);

  console.log(`arming...`);
  await (await vault.arm({ gasLimit: 2_500_000, gasPrice: await networkGasPrice() })).wait();

  const [armed, runs, refusals, nextAt, runsLeft] = await vault.status();
  console.log(`\narmed    ${armed}`);
  console.log(`runs     ${runs}   refusals ${refusals}`);
  console.log(`next run ${new Date(Number(nextAt) * 1000).toISOString()}`);
  console.log(`balance  ${hbar(await vault.fuel())} HBAR`);
  console.log(`runway   ${runsLeft} runs`);
  console.log(`schedule 0.0.${BigInt(await vault.nextSchedule())}`);
  console.log(`\nvault   https://hashscan.io/testnet/contract/${vaultAddr}`);
  console.log(`\nSend nothing else. The next call comes from the network.`);
}

main().catch(e => {
  console.error(e.message ?? e);
  process.exit(1);
});
