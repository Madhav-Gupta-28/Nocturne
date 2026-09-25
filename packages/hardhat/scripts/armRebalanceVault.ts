import { ethers, deployments, network } from "hardhat";

/**
 * Puts a real drift rebalance on testnet.
 *
 * The exit strategy has on-chain evidence; this one did not, and "two strategies
 * of different shape on one engine" is the claim that the interface generalises.
 * A claim with no transaction behind it is an assertion.
 *
 *   npx hardhat run scripts/armRebalanceVault.ts --network hederaTestnet
 *
 * It holds WHBAR and USDC and tries to keep a target share of its value in
 * WHBAR. Where the exit strategy is one-way and terminal, this one trades in
 * whichever direction restores the ratio and keeps doing it — the same engine,
 * the same four interface functions, a completely different shape of decision.
 *
 * **Expect it to refuse**, for the same reason the exit strategy's `refuse`
 * preset does: the pool prices WHBAR near $2.04 and Chainlink says $0.09, so
 * `PriceGuard` declines at the stock 2% tolerance. The trading path is proven
 * against a healthy pool by `armExitVault.ts` with `PRESET=sell`.
 */

// Verified on testnet — see ARCHITECTURE.md §3.5.
const WHBAR_TOKEN = "0x0000000000000000000000000000000000003aD2";
const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003aD1";
const USDC = "0x0000000000000000000000000000000000001549";
const ROUTER = "0x0000000000000000000000000000000000159398";
const POOL = "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a";
const HBAR_USD = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";
const HTS = "0x0000000000000000000000000000000000000167";

const WHBAR_DECIMALS = 8;
const USDC_DECIMALS = 6;

const FUEL_HBAR = process.env.FUEL_HBAR ?? "8";
const POSITION_WHBAR = process.env.POSITION_WHBAR ?? "0.1";

/** Hold half the value in WHBAR, and act once drift passes 1%. */
const TARGET_BPS_A = 5000;
const BAND_BPS = Number(process.env.BAND_BPS ?? 100);

/** The stock tolerance. Nothing here widens it. */
const MAX_DIVERGENCE_BPS = 200n;

const hbar = (t: bigint) => (Number(t) / 1e8).toFixed(4);

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`network  ${network.name}`);
  console.log(`owner    ${owner.address}`);

  const strategyAddr = (await deployments.get("DriftRebalanceStrategy")).address;
  const factory = await ethers.getContractAt("NocturneFactory", (await deployments.get("NocturneFactory")).address);
  const strategy = await ethers.getContractAt("DriftRebalanceStrategy", strategyAddr);

  // The owner needs to hold WHBAR before it can hand any to a vault.
  const hts = await ethers.getContractAt("IHederaTokenService", HTS);
  console.log(`associating WHBAR with the owner...`);
  try {
    await (await hts.associateToken(owner.address, WHBAR_TOKEN, { gasLimit: 800_000 })).wait();
  } catch {
    console.log(`  (already associated, continuing)`);
  }

  const position = ethers.parseUnits(POSITION_WHBAR, WHBAR_DECIMALS);
  const whbar = await ethers.getContractAt("IERC20", WHBAR_TOKEN);
  if ((await whbar.balanceOf(owner.address)) < position) {
    console.log(`wrapping ${POSITION_WHBAR} HBAR into WHBAR...`);
    const wrapper = new ethers.Contract(WHBAR_CONTRACT, ["function deposit() payable"], owner);
    await (await wrapper.deposit({ value: ethers.parseEther(POSITION_WHBAR), gasLimit: 800_000 })).wait();
  }

  console.log(`\ncreating a vault with ${FUEL_HBAR} HBAR of fuel...`);
  await (await factory.createVault(strategyAddr, { value: ethers.parseEther(FUEL_HBAR), gasLimit: 4_000_000 })).wait();
  const vaultAddr = await factory.latestVaultOf(owner.address);
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);
  console.log(`vault    ${vaultAddr}`);

  // Both sides, because this strategy trades in either direction and so may end
  // up holding either token.
  for (const [name, token] of [
    ["WHBAR", WHBAR_TOKEN],
    ["USDC", USDC],
  ] as const) {
    const rc = await vault.associate.staticCall(token);
    await (await vault.associate(token, { gasLimit: 800_000 })).wait();
    console.log(`associated ${name} — response code ${rc}`);
  }

  console.log(`\ndepositing ${POSITION_WHBAR} WHBAR...`);
  await (await whbar.approve(vaultAddr, position, { gasLimit: 800_000 })).wait();
  await (await vault.depositToken(WHBAR_TOKEN, position, { gasLimit: 900_000 })).wait();

  // Three grants, not two: a two-way strategy may need to approve either token.
  const router = await ethers.getContractAt("ISwapRouter", ROUTER);
  const approve = whbar.interface.getFunction("approve")!.selector;
  const swap = router.interface.getFunction("exactInputSingle")!.selector;
  for (const [name, target, selector] of [
    ["WHBAR.approve", WHBAR_TOKEN, approve],
    ["USDC.approve", USDC, approve],
    ["router.exactInputSingle", ROUTER, swap],
  ] as const) {
    console.log(`allowing ${name}...`);
    await (await vault.setAllowedCall(target, selector, true, { gasLimit: 500_000 })).wait();
  }

  const config = await strategy.encodeConfig({
    vault: vaultAddr,
    assetA: WHBAR_TOKEN,
    assetB: USDC,
    router: ROUTER,
    fee: 3000,
    targetBpsA: TARGET_BPS_A,
    bandBps: BAND_BPS,
    // A correction smaller than this costs more than it fixes.
    minTradeValue1e18: ethers.parseEther("0.01"),
    slippageBps: 500,
    decimalsA: WHBAR_DECIMALS,
    decimalsB: USDC_DECIMALS,
    sources: {
      pool: POOL,
      twapWindow: 60,
      feed: HBAR_USD,
      maxFeedAge: 86_400n,
      maxDivergenceBps: MAX_DIVERGENCE_BPS,
      assetIsToken0: false,
      assetDecimals: WHBAR_DECIMALS,
      quoteDecimals: USDC_DECIMALS,
    },
  });
  console.log(`\nconfiguring (target ${TARGET_BPS_A / 100}% in WHBAR, band ${BAND_BPS / 100}%)...`);
  await (await vault.configure(config, { gasLimit: 1_000_000 })).wait();

  const [state, a, b] = await vault.preview();
  console.log(`the strategy says: "${state}"  (${a}, ${b})`);

  console.log(`arming...`);
  await (await vault.arm({ gasLimit: 2_500_000 })).wait();

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
