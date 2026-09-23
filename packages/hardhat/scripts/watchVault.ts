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

/**
 * Who actually paid for the vault's executions, straight from the mirror node.
 *
 * Read the transfer list, not the transaction id. A scheduled transaction's id
 * carries the id of the account that created the schedule, which makes it look
 * as though someone sent the call — they did not. The transfer list is what
 * settles it: for a genuine unattended run the vault's own account is debited
 * the fee and the owner's account does not appear at all.
 */
export async function proveNobodySentIt(vaultAddr: string, ownerAddr: string): Promise<void> {
  const vaultAccount: string = await fetch(`${MIRROR}/api/v1/accounts/${vaultAddr}`)
    .then(r => r.json())
    .then(j => j.account);
  const ownerAccount: string = await fetch(`${MIRROR}/api/v1/accounts/${ownerAddr}`)
    .then(r => r.json())
    .then(j => j.account);

  type Tx = {
    consensus_timestamp: string;
    name: string;
    result: string;
    scheduled: boolean;
    transfers?: Array<{ account: string; amount: number }>;
  };

  const txs: Tx[] = await fetch(`${MIRROR}/api/v1/transactions?account.id=${vaultAccount}&limit=15&order=desc`)
    .then(r => r.json())
    .then(j => j.transactions);

  console.log(`\nvault ${vaultAccount}   owner ${ownerAccount}`);
  for (const t of txs.filter(t => t.scheduled)) {
    const paid = (t.transfers ?? []).find(x => x.account === vaultAccount && x.amount < 0);
    const ownerPaid = (t.transfers ?? []).some(x => x.account === ownerAccount && x.amount < 0);
    const hbar = paid ? (-paid.amount / 1e8).toFixed(4) : "?";
    console.log(
      `  ${t.consensus_timestamp}  ${t.name}  ${t.result}  ` +
        `vault paid ${hbar} HBAR  owner paid ${ownerPaid ? "SOMETHING — investigate" : "nothing"}`,
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
