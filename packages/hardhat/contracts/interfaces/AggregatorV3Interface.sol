// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Chainlink's price feed interface.
 * @dev Live on Hedera testnet with seven pairs. HBAR/USD sits at
 *      0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a and answered 105 seconds old
 *      when this was written, so it is a real feed rather than a placeholder.
 *
 *      `updatedAt` matters as much as `answer`. Feeds update on a deviation
 *      threshold as well as a heartbeat, so a stablecoin pair can legitimately
 *      be many hours old. Nocturne treats an old feed as a disagreement rather
 *      than as confirmation — see PriceGuard.
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
