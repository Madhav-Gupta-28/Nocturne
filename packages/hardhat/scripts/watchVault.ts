import { ethers, deployments, network } from "hardhat";

/**
 * Watch a vault run without you.
 *
 *   npx hardhat run scripts/watchVault.ts --network hederaTestnet
 *
 * Prints a line whenever the run counter moves. Nothing here sends a
 * transaction — it only reads — so the counter moving is the network executing
 * the vault, not this script poking it.
 *
 * The last section is the part worth checking: it lists the vault's recent
 * transactions from the mirror node. Every execution should be a CONTRACTCALL
 * paid for by the vault's own account, with no transaction from the owner
 * anywhere near it.
 */

const POLL_MS = 15_000;
const MIRROR = "https://testnet.mirrornode.hedera.com";

async function main() {
  const [signer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("NocturneFactory", (await deployments.get("NocturneFactory")).address);
  const heartbeat = await ethers.getContractAt("Heartbeat", (await deployments.get("Heartbeat")).address);

  const vaultAddr = await factory.latestVaultOf(signer.address);
  if (vaultAddr === ethers.ZeroAddress) throw new Error("No vault. Run scripts/armVault.ts first.");
  const vault = await ethers.getContractAt("NocturneVault", vaultAddr);

  console.log(`network ${network.name}`);
  console.log(`vault   ${vaultAddr}`);
  console.log(`watching — nothing below is sent by this script\n`);

  let lastRuns = -1n;
  for (;;) {
    const [armed, runs, refusals, nextAt, runsLeft] = await vault.status();
    if (runs !== lastRuns) {
      lastRuns = runs;
      const beats = await heartbeat.beats();
      const due = new Date(Number(nextAt) * 1000).toISOString().slice(11, 19);
      console.log(
        `${new Date().toISOString().slice(11, 19)}  runs=${runs} refusals=${refusals} beats=${beats} ` +
          `next=${due} runway=${runsLeft} armed=${armed}`,
      );
      if (runsLeft <= 2n) console.log(`  fuel is nearly out — top it up with depositHbar()`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

/** Who actually sent the vault's recent transactions, straight from the mirror node. */
export async function recentTransactions(vaultAddr: string): Promise<void> {
  const account = await fetch(`${MIRROR}/api/v1/accounts/${vaultAddr}`)
    .then(r => r.json())
    .then(j => j.account as string);

  const txs = await fetch(`${MIRROR}/api/v1/transactions?account.id=${account}&limit=10&order=desc`)
    .then(r => r.json())
    .then(j => j.transactions as Array<{ consensus_timestamp: string; name: string; result: string }>);

  console.log(`\nvault account ${account}`);
  for (const t of txs) {
    console.log(`  ${t.consensus_timestamp}  ${t.name}  ${t.result}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
