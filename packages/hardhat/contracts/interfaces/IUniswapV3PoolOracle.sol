// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice The parts of a Uniswap V3 style pool Nocturne reads.
 * @dev SaucerSwap V2 is a V3 fork, so its pools answer all of this. Verified on
 *      Hedera testnet against WHBAR/USDC at
 *      0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a.
 */
interface IUniswapV3PoolOracle {
    /**
     * @notice Cumulative ticks at each of `secondsAgos`, newest last.
     * @dev The basis of every TWAP. Works at `observationCardinality == 1` for
     *      windows short enough to sit inside the current observation, which is
     *      why a freshly deployed pool can still be consulted; longer windows
     *      need `increaseObservationCardinalityNext` first, and revert with
     *      `OLD` until enough observations exist.
     */
    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function token0() external view returns (address);

    function token1() external view returns (address);

    /// @notice Permissionless. Grow this before relying on a long TWAP window.
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}
