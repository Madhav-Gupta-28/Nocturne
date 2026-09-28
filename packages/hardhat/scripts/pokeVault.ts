import { ethers, network } from "hardhat";
import { networkGasPrice } from "./lib/testnetTokens";

/**
 * Try to force a vault to run early, and show that nothing happens.
 *
 *   VAULT=0x... npx hardhat run scripts/pokeVault.ts --network hederaTestnet
 *
 * `executeScheduled` has no access control, because the network has to be able
 * to call it and there is no caller to authenticate. What stops anyone else from
 * using it is the vault's own check: a call more than `CLOCK_SKEW` seconds
 * before the booked time returns without doing anything. This sends exactly
 * that call and reads the vault before and after.
 *
 * Defaults to the DAI guard left on duty. The call costs the sender a little
 * gas and changes nothing in the vault. Point it at a vault whose run is
 * overdue and it will run instead: that is the revive path, open to anyone.
 */

const VAULT = process.env.VAULT ?? "0xaFa895f727Fb0287fCB3E08DD9dA13287356837f";

const since = (seconds: number) => {
  const s = Math.abs(seconds);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

async function main() {
  const [caller] = await ethers.getSigners();
  const vault = await ethers.getContractAt("NocturneVault", VAULT);

  const read = async () => {
    const [armed, runs, , nextAt] = await vault.status();
    return { armed, runs, nextAt: Number(nextAt), schedule: await vault.nextSchedule() };
  };

  const before = await read();
  const now = Math.floor(Date.now() / 1000);
  console.log(`network   ${network.name}`);
  console.log(`vault     ${VAULT}`);
  console.log(`caller    ${caller.address}`);
  console.log(
    `before    runs ${before.runs} · next run in ${since(before.nextAt - now)} · schedule 0.0.${BigInt(before.schedule)}`,
  );

  if (!before.armed) throw new Error("that vault is not armed, so there is nothing to force");
  if (before.nextAt <= now) {
    throw new Error("that vault is overdue; calling it now would revive it, which is a different demonstration");
  }

  console.log(`\ncalling executeScheduled(), ${since(before.nextAt - now)} early...`);
  const tx = await vault.executeScheduled({ gasLimit: 300_000, gasPrice: await networkGasPrice() });
  const receipt = await tx.wait();
  console.log(`tx        ${tx.hash} · status ${receipt?.status} · ${receipt?.gasUsed} gas`);

  const after = await read();
  console.log(
    `after     runs ${after.runs} · next run in ${since(after.nextAt - now)} · schedule 0.0.${BigInt(after.schedule)}`,
  );

  const unchanged = after.runs === before.runs && after.nextAt === before.nextAt && after.schedule === before.schedule;
  console.log(
    unchanged
      ? "\nNothing ran, and the booked run is untouched. Only the network, at the booked second, runs this vault."
      : "\nThe vault changed. That should not happen for an early call — check the output above.",
  );
}

main().catch(e => {
  console.error(e.message ?? e);
  process.exit(1);
});
