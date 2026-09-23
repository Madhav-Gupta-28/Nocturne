import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getDeployGasPrice } from "../utils/getDeployGasPrice";

/**
 * Deploys the engine and the reference strategy.
 *
 * Three contracts, in dependency order:
 *
 *   Heartbeat          something for a vault to call, and the evidence that it did
 *   HeartbeatStrategy  the reference INocturneStrategy implementation
 *   NocturneFactory    makes a vault per owner
 *
 * A vault is deliberately not deployed here. Vaults belong to whoever created
 * them, so they come from the factory at the owner's request — see
 * `scripts/armVault.ts`.
 *
 * Gas is taken from the network rather than guessed. Hedera's relay under-reports
 * estimates badly enough that a default multiplier can run out mid-constructor,
 * so every deployment below passes an explicit gas limit with real headroom;
 * unused gas is refunded, which makes headroom close to free.
 */
const deployNocturne: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, log } = hre.deployments;

  const gasPrice = await getDeployGasPrice(hre);
  const common = { from: deployer, log: true, autoMine: true, gasPrice, gasLimit: 4_000_000 };

  const heartbeat = await deploy("Heartbeat", { ...common, args: [] });
  const strategy = await deploy("HeartbeatStrategy", { ...common, args: [] });
  const factory = await deploy("NocturneFactory", { ...common, args: [] });

  log("");
  log("  Heartbeat          %s", heartbeat.address);
  log("  HeartbeatStrategy  %s", strategy.address);
  log("  NocturneFactory    %s", factory.address);
  log("");
  log("  Next: npx hardhat run scripts/armVault.ts --network %s", hre.network.name);
  log("");
};

export default deployNocturne;

deployNocturne.tags = ["Nocturne"];
