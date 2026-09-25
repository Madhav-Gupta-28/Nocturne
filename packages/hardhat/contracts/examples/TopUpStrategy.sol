// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { INocturneStrategy } from "../interfaces/INocturneStrategy.sol";

/// The tank a TopUpStrategy watches. Anything with these two functions works.
interface IGasTank {
    function balanceOf(address who) external view returns (uint256);
    function topUp(address who, uint256 amount) external;
}

/**
 * @title TopUpStrategy
 * @notice The worked example from docs/writing-a-strategy.md, compiled and
 *         tested so the docs cannot drift from code that works.
 *
 * @dev Keeps a beneficiary's balance in a tank above a floor, and checks more
 *      often as the balance falls. Not deployed by the deploy script.
 */
contract TopUpStrategy is INocturneStrategy {
    struct Config {
        address tank;
        address beneficiary;
        uint256 floor; // top up below this
        uint256 target; // top up to this
    }

    function plan(bytes calldata config) external view override returns (Action[] memory actions) {
        Config memory c = abi.decode(config, (Config));
        uint256 balance = IGasTank(c.tank).balanceOf(c.beneficiary);

        // Healthy. Say so with an empty plan rather than reverting.
        if (balance >= c.floor) return new Action[](0);

        actions = new Action[](1);
        actions[0] = Action({
            target: c.tank,
            value: 0,
            data: abi.encodeCall(IGasTank.topUp, (c.beneficiary, c.target - balance))
        });
    }

    function nextInterval(bytes calldata config) external view override returns (uint256) {
        Config memory c = abi.decode(config, (Config));
        uint256 balance = IGasTank(c.tank).balanceOf(c.beneficiary);

        // The whole point of the interface: look more often as it gets close.
        if (balance >= c.floor * 2) return 6 hours;
        if (balance >= c.floor) return 1 hours;
        return 5 minutes;
    }

    function validateConfig(bytes calldata config) external pure override returns (bool) {
        Config memory c = abi.decode(config, (Config));
        if (c.tank == address(0) || c.beneficiary == address(0)) return false;
        if (c.floor == 0 || c.target <= c.floor) return false;
        return true;
    }

    function explain(bytes calldata config) external view override returns (string memory, uint256, uint256) {
        Config memory c = abi.decode(config, (Config));
        uint256 balance = IGasTank(c.tank).balanceOf(c.beneficiary);
        return (balance >= c.floor ? "healthy" : "topping up", balance, c.floor);
    }

    function encodeConfig(
        address tank,
        address beneficiary,
        uint256 floor,
        uint256 target
    ) external pure returns (bytes memory) {
        return abi.encode(Config({ tank: tank, beneficiary: beneficiary, floor: floor, target: target }));
    }
}
