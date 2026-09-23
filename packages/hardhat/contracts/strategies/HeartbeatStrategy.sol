// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { INocturneStrategy } from "../interfaces/INocturneStrategy.sol";
import { Heartbeat } from "../Heartbeat.sol";

/**
 * @title HeartbeatStrategy
 * @notice Calls a Heartbeat on a fixed interval, forever.
 *
 * @dev Two jobs.
 *
 *      **It is the reference implementation of INocturneStrategy.** Four
 *      functions, no arithmetic worth arguing about, and nothing to distract
 *      from the shape of the interface. Anyone writing their own strategy should
 *      read this one first and the price-driven ones second.
 *
 *      **It is the liveness proof.** A vault running this leaves a counter that
 *      anybody can read and a transaction history with nothing from the owner in
 *      it. That is the evidence behind every claim in the README, and it costs
 *      about 1.6 HBAR per beat to keep producing.
 *
 *      This strategy has a fixed interval on purpose. It is the one case where a
 *      fixed interval is right, because nothing it observes could change its
 *      mind — which is the contrast the price strategies are drawn against.
 */
contract HeartbeatStrategy is INocturneStrategy {
    struct Config {
        /// @dev The Heartbeat to call.
        address heartbeat;
        /// @dev Seconds between beats. The vault clamps this to its own bounds.
        uint256 intervalSeconds;
    }

    /// @inheritdoc INocturneStrategy
    function plan(bytes calldata config) external pure override returns (Action[] memory actions) {
        Config memory c = abi.decode(config, (Config));

        actions = new Action[](1);
        actions[0] = Action({
            target: c.heartbeat,
            value: 0,
            data: abi.encodeCall(Heartbeat.beat, ())
        });
    }

    /// @inheritdoc INocturneStrategy
    function nextInterval(bytes calldata config) external pure override returns (uint256) {
        return abi.decode(config, (Config)).intervalSeconds;
    }

    /// @inheritdoc INocturneStrategy
    function validateConfig(bytes calldata config) external pure override returns (bool) {
        // A malformed blob makes abi.decode revert rather than return nonsense,
        // so the vault's configure() rejects it either way. The explicit checks
        // are for the two decodable-but-useless cases.
        Config memory c = abi.decode(config, (Config));
        if (c.heartbeat == address(0)) return false;
        if (c.intervalSeconds == 0) return false;
        return true;
    }

    /// @inheritdoc INocturneStrategy
    function explain(bytes calldata config) external view override returns (string memory, uint256, uint256) {
        Config memory c = abi.decode(config, (Config));
        return ("beating", Heartbeat(c.heartbeat).beats(), c.intervalSeconds);
    }

    /// @notice Helper so a UI or a script does not have to hand-encode the config.
    function encodeConfig(address heartbeat, uint256 intervalSeconds) external pure returns (bytes memory) {
        return abi.encode(Config({ heartbeat: heartbeat, intervalSeconds: intervalSeconds }));
    }
}
