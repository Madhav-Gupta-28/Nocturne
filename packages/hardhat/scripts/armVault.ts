import { ethers, deployments, network } from "hardhat";

/**
 * Create a vault, fund it, point it at the Heartbeat, and arm it.
 *
 * After this finishes you should send nothing else. The vault books its own
 * next run, and every beat from here on is the network calling it.
 *
 *   npx hardhat run scripts/armVault.ts --network hederaTestnet
 *
 * Then watch it with:
 *
 *   npx hardhat run scripts/watchVault.ts --network hederaTestnet
 */

/**
 * Seconds between beats. The vault's floor is 60.
 *
 * Override with `INTERVAL=300 npx hardhat run ...`.
 */
const INTERVAL = Number(process.env.INTERVAL ?? 120);

/**
 * HBAR to leave in the vault, overridable with `FUEL_HBAR=5`.
 *
 * Budget it against what a run *reserves*, not what it costs. The network only
 * accepts an execution whose payer covers the whole gas allowance — about 3.27
 * HBAR — and then charges roughly 1.63 of it. So the first run needs twice what
 * the later ones consume, and the script prints the vault's own arithmetic below
 * rather than asking you to do it here.
 */
const FUEL_HBAR = process.env.FUEL_HBAR ?? "24";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`network  ${network.name}`);
  console.log(`owner    ${signer.address}`);

  const heartbeatAddr = (await deployments.get("Heartbeat")).address;
  const strategyAddr = (await deployments.get("HeartbeatStrategy")).address;
  const factoryAddr = (await deployments.get("NocturneFactory")).address;

  const factory = await ethers.getContractAt("NocturneFactory", factoryAddr);
  const strategy = await ethers.getContractAt("HeartbeatStrategy", strategyAddr);
  const heartbeat = await ethers.getContractAt("Heartbeat", heartbeatAddr);

  // 1. Create the vault, funding it in the same transaction.
  //
  // `value` here is weibar: the JSON-RPC relay quotes HBAR with 18 decimals and
  // divides by 1e10 on the way in. Inside the EVM the same balance reads as
  // 8-decimal tinybar. parseEther does the right thing; a hand-written tinybar
  // figure passed here would underfund the vault by a factor of ten billion.
  const fuel = ethers.parseEther(FUEL_HBAR);
  console.log(`\ncreating a vault, funded with ${FUEL_HBAR} HBAR...`);
  const createTx = await factory.createVault(strategyAddr, { value: fuel, gasLimit: 4_000_000 });
  await createTx.wait();

  const vaultAddr = await factory.latestVaultOf(signer.address);
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);
  console.log(`vault    ${vaultAddr}`);
  console.log(`tx       ${createTx.hash}`);

  // 2. Say exactly what the strategy is allowed to call. Naming the function
  //    matters as much as naming the contract: permitting an address wholesale
  //    would let a swapped-in strategy call anything on it.
  const beat = heartbeat.interface.getFunction("beat")!.selector;
  console.log(`\nallowing Heartbeat.beat()...`);
  await (await vault.setAllowedCall(heartbeatAddr, beat, true, { gasLimit: 1_000_000 })).wait();

  // 3. Configure, which also validates. A bad config fails here rather than at
  //    3am inside a scheduled call nobody is watching.
  const config = await strategy.encodeConfig(heartbeatAddr, INTERVAL);
  console.log(`configuring: beat ${heartbeatAddr} every ${INTERVAL}s...`);
  await (await vault.configure(config, { gasLimit: 1_000_000 })).wait();

  // 4. Arm. This books the first schedule; every run after it books the next.
  //
  // 2.5M rather than 4M, and the difference is the owner's problem rather than
  // the vault's. Arming measured 1,501,968 gas, but the *owner* has to hold the
  // whole limit times the gas price before the relay will submit it at all — 4M
  // reserves about 4.6 HBAR for a call that burns under 1.7. Fund a vault
  // generously and the owner can be left unable to arm it, which is how this
  // number got measured in the first place.
  console.log(`arming...`);
  const armTx = await vault.arm({ gasLimit: 2_500_000 });
  await armTx.wait();

  const [armed, runs, refusals, nextAt, runsLeft] = await vault.status();
  const schedule = await vault.nextSchedule();

  console.log(`\narmed    ${armed}`);
  console.log(`runs     ${runs}  refusals ${refusals}`);
  console.log(`next run ${new Date(Number(nextAt) * 1000).toISOString()}`);

  // Print the two figures the runway is built from, because they are far apart
  // and the gap is the thing most likely to be misjudged.
  const [reserve, charge, balance] = [await vault.reservePerRun(), await vault.chargePerRun(), await vault.fuel()];
  const hbar = (t: bigint) => (Number(t) / 1e8).toFixed(4);
  console.log(`balance  ${hbar(balance)} HBAR`);
  console.log(`reserve  ${hbar(reserve)} HBAR per run  (accepted only above this)`);
  console.log(`charge   ${hbar(charge)} HBAR per run  (what it actually costs)`);
  console.log(`runway   ${runsLeft} runs`);
  console.log(`schedule ${schedule}   (0.0.${BigInt(schedule)})`);
  console.log(`beats    ${await heartbeat.beats()}`);

  console.log(`\n--- verify without trusting any of this ---`);
  console.log(`vault      https://hashscan.io/testnet/contract/${vaultAddr}`);
  console.log(`heartbeat  https://hashscan.io/testnet/contract/${heartbeatAddr}`);
  console.log(`schedule   https://hashscan.io/testnet/schedule/0.0.${BigInt(schedule)}`);
  console.log(`\nSend nothing else. Come back and the beats will have moved.`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
