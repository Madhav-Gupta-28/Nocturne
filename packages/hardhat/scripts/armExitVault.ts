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
 *
 * Pass `VAULT=0x...` to retune a vault that already exists instead of building
 * another one. Everything a vault only needs once — HTS association, the
 * position, the allow-list — is then skipped, and the script just reconfigures,
 * tops the fuel up and re-arms. Note that `configure` disarms by design and
 * releases the pending schedule, so re-arming is not optional.
 *
 *   VAULT=0x... TOLERATE_DIVERGENCE=1 TOP_UP=4 npx hardhat run ...
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

/** An existing vault to retune, instead of creating one. */
const EXISTING = process.env.VAULT;

/** HBAR to add to an existing vault's fuel before re-arming. */
const TOP_UP = process.env.TOP_UP;

const hbar = (tinybar: bigint) => (Number(tinybar) / 1e8).toFixed(4);

type Vault = Awaited<ReturnType<typeof ethers.getContractAt>>;

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`network  ${network.name}`);
  console.log(`owner    ${owner.address}`);
  if (TOLERATE) {
    console.log(`\n!! TOLERATE_DIVERGENCE=1 — divergence tolerance is absurd on purpose.`);
    console.log(`!! This proves the swap path executes. It is not a sane configuration.\n`);
  }

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
 * the addresses its strategy is allowed to reach.
 */
async function build(): Promise<string> {
  const [owner] = await ethers.getSigners();
  const factory = await ethers.getContractAt("NocturneFactory", (await deployments.get("NocturneFactory")).address);
  const strategyAddr = (await deployments.get("ProtectiveExitStrategy")).address;

  // The owner must be able to hold WHBAR before handing any to a vault. An
  // account created from an EVM key has no automatic association slots.
  const hts = await ethers.getContractAt("IHederaTokenService", HTS);
  console.log(`associating WHBAR with the owner...`);
  await tolerate(hts.associateToken(owner.address, WHBAR_TOKEN, { gasLimit: 800_000 }), "already associated");

  // Wrap HBAR into WHBAR. `deposit()` credits msg.sender.
  const position = ethers.parseUnits(POSITION_WHBAR, WHBAR_DECIMALS);
  const whbar = await ethers.getContractAt("IERC20", WHBAR_TOKEN);
  if ((await whbar.balanceOf(owner.address)) < position) {
    console.log(`wrapping ${POSITION_WHBAR} HBAR into WHBAR...`);
    const wrapper = new ethers.Contract(WHBAR_CONTRACT, ["function deposit() payable"], owner);
    // Weibar over JSON-RPC; the relay divides by 1e10 on the way in.
    await (await wrapper.deposit({ value: ethers.parseEther(POSITION_WHBAR), gasLimit: 800_000 })).wait();
  }
  console.log(`owner holds ${ethers.formatUnits(await whbar.balanceOf(owner.address), WHBAR_DECIMALS)} WHBAR`);

  console.log(`\ncreating a vault with ${FUEL_HBAR} HBAR of fuel...`);
  await (await factory.createVault(strategyAddr, { value: ethers.parseEther(FUEL_HBAR), gasLimit: 4_000_000 })).wait();
  const vaultAddr = await factory.latestVaultOf(owner.address);
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);
  console.log(`vault    ${vaultAddr}`);

  // Both sides must be associated: WHBAR to hold the position, USDC to receive
  // the proceeds. A swap into an unassociated token fails at delivery, after
  // the approve has already landed.
  for (const [name, token] of [
    ["WHBAR", WHBAR_TOKEN],
    ["USDC", USDC],
  ] as const) {
    const rc = await vault.associate.staticCall(token);
    await (await vault.associate(token, { gasLimit: 800_000 })).wait();
    console.log(`associated ${name} with the vault — response code ${rc}`);
  }

  console.log(`\ndepositing ${POSITION_WHBAR} WHBAR into the vault...`);
  await (await whbar.approve(vaultAddr, position, { gasLimit: 800_000 })).wait();
  await (await vault.depositToken(WHBAR_TOKEN, position, { gasLimit: 900_000 })).wait();

  // Exactly two calls, named by function rather than by address. Allowing the
  // token wholesale would also permit `transfer(attacker, balance)` — the same
  // grant the legitimate approve needs.
  const router = await ethers.getContractAt("ISwapRouter", ROUTER);
  for (const [name, target, selector] of [
    ["WHBAR.approve", WHBAR_TOKEN, whbar.interface.getFunction("approve")!.selector],
    ["router.exactInputSingle", ROUTER, router.interface.getFunction("exactInputSingle")!.selector],
  ] as const) {
    console.log(`allowing ${name}...`);
    await (await vault.setAllowedCall(target, selector, true, { gasLimit: 500_000 })).wait();
  }

  return vaultAddr;
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
async function configure(vault: Vault, vaultAddr: string, strategy: Vault) {
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
  console.log(`\nconfiguring (floor ${ethers.formatEther(FLOOR_1E18)} USDC, tolerance ${MAX_DIVERGENCE_BPS} bps)...`);
  // Note: configure() disarms and releases any pending schedule, by design.
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
async function arm(vault: Vault, vaultAddr: string) {
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
