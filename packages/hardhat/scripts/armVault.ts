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

/** Seconds between beats. The vault's floor is 60. */
const INTERVAL = 120;

/** HBAR to leave in the vault. It pays for its own gas at roughly 1.6 per run. */
const FUEL_HBAR = "24";

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

  // 2. Say where the strategy is allowed to reach.
  console.log(`\nallowing the heartbeat as a target...`);
  await (await vault.setAllowedTarget(heartbeatAddr, true, { gasLimit: 1_000_000 })).wait();

  // 3. Configure, which also validates. A bad config fails here rather than at
  //    3am inside a scheduled call nobody is watching.
  const config = await strategy.encodeConfig(heartbeatAddr, INTERVAL);
  console.log(`configuring: beat ${heartbeatAddr} every ${INTERVAL}s...`);
  await (await vault.configure(config, { gasLimit: 1_000_000 })).wait();

  // 4. Arm. This books the first schedule; every run after it books the next.
  console.log(`arming...`);
  const armTx = await vault.arm({ gasLimit: 4_000_000 });
  await armTx.wait();

  const [armed, runs, refusals, nextAt, runsLeft] = await vault.status();
  const schedule = await vault.nextSchedule();

  console.log(`\narmed    ${armed}`);
  console.log(`runs     ${runs}  refusals ${refusals}`);
  console.log(`next run ${new Date(Number(nextAt) * 1000).toISOString()}`);
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
