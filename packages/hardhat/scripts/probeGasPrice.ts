/**
 * Measures what one scheduled execution actually requires a vault to hold.
 *
 * Run: npx hardhat run scripts/probeGasPrice.ts --network hederaTestnet
 */
import { ethers, network } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer", await signer.getAddress(), "on", network.name);

  const probe = await (await ethers.getContractFactory("GasPriceProbe")).deploy({ gasLimit: 1_000_000 });
  await probe.waitForDeployment();
  const addr = await probe.getAddress();
  console.log("probe ", addr);

  // Send 1 HBAR so the balance read has something in it, then record.
  const tx = await probe.record({ value: ethers.parseEther("1"), gasLimit: 200_000 });
  await tx.wait();

  const [gasPrice, baseFee, balance, gasLeft] = await Promise.all([
    probe.lastGasPrice(),
    probe.lastBaseFee(),
    probe.lastBalance(),
    probe.lastGasLeft(),
  ]);

  const rpcPrice = await ethers.provider.send("eth_gasPrice", []);

  console.log("");
  console.log("  tx.gasprice (in EVM) ", gasPrice.toString());
  console.log("  block.basefee        ", baseFee.toString());
  console.log("  eth_gasPrice (RPC)   ", BigInt(rpcPrice).toString());
  console.log("  balance after 1 HBAR ", balance.toString(), "<- 1e8 means tinybar");
  console.log("  gasleft at entry     ", gasLeft.toString());
  console.log("");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
