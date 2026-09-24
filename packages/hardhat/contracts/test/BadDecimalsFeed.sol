// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice A Chainlink-shaped feed that answers rounds but reverts on decimals().
 * @dev Exists to test one claim in PriceGuard: that every way a source can fail
 *      produces `agreed == false` with a reason, rather than a revert.
 */
contract BadDecimalsFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 1e8, block.timestamp, block.timestamp, 1);
    }

    function decimals() external pure returns (uint8) {
        revert("no decimals here");
    }
}
