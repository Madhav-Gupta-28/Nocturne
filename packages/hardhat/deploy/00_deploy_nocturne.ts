import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getDeployGasPrice } from "../utils/getDeployGasPrice";

/**
 * Deploys the engine and the reference strategy.
 *
 * Five contracts:
 *
 *   Heartbeat               something for a vault to call, and the evidence it did
 *   HeartbeatStrategy       the reference INocturneStrategy implementation
 *   ProtectiveExitStrategy  sells a position when a floor breaks
 *   DriftRebalanceStrategy  restores a target ratio when it drifts
 *   NocturneFactory         makes a vault per owner
 *   PriceLens               read-only view of what the price guard sees
 *
 * Strategies hold nothing and keep no per-user state, so one deployment of each
 * serves every vault. Only vaults are per-owner.
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
  const heartbeatStrategy = await deploy("HeartbeatStrategy", { ...common, args: [] });
  const exitStrategy = await deploy("ProtectiveExitStrategy", { ...common, args: [] });
  const rebalanceStrategy = await deploy("DriftRebalanceStrategy", { ...common, args: [] });
  const factory = await deploy("NocturneFactory", { ...common, args: [] });

  // Read-only, stateless, and shared by every vault: it gives the frontend an
  // address at which to ask what the price guard currently sees.
  const lens = await deploy("PriceLens", { ...common, args: [] });

  log("");
  log("  Heartbeat               %s", heartbeat.address);
  log("  HeartbeatStrategy       %s", heartbeatStrategy.address);
  log("  ProtectiveExitStrategy  %s", exitStrategy.address);
  log("  DriftRebalanceStrategy  %s", rebalanceStrategy.address);
  log("  NocturneFactory         %s", factory.address);
  log("  PriceLens               %s", lens.address);
  log("");
  log("  Next: npx hardhat run scripts/armVault.ts --network %s", hre.network.name);
  log("");
};

export default deployNocturne;

deployNocturne.tags = ["Nocturne"];
