// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice A pool that reports whatever mean tick a test asks for.
 * @dev `observe` returns cumulatives chosen so the arithmetic mean over the
 *      window is exactly `tick`: zero at the older point, `tick * window` at the
 *      newer one. That keeps the test's intent visible instead of hiding it in
 *      hand-computed cumulative values.
 */
contract MockV3Pool {
    int24 public tickValue;
    bool public observeReverts;
    address public token0;
    address public token1;

    constructor(address t0, address t1) {
        token0 = t0;
        token1 = t1;
    }

    function setTick(int24 t) external {
        tickValue = t;
    }

    /// @notice Make `observe` revert, as a real pool does when the window
    ///         reaches further back than it has observations for.
    function setObserveReverts(bool v) external {
        observeReverts = v;
    }

    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidity) {
        require(!observeReverts, "OLD");

        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidity = new uint160[](secondsAgos.length);

        uint32 window = secondsAgos[0];
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(tickValue) * int56(uint56(window));
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (0, tickValue, 0, 1, 1, 0, true);
    }
}

/// @notice A Chainlink aggregator a test can age, silence or corrupt.
contract MockAggregator {
    int256 public answer;
    uint8 public feedDecimals = 8;
    uint256 public updatedAt;
    bool public reverts;

    constructor(int256 answer_, uint256 updatedAt_) {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setAnswer(int256 v) external {
        answer = v;
    }

    function setUpdatedAt(uint256 v) external {
        updatedAt = v;
    }

    function setDecimals(uint8 v) external {
        feedDecimals = v;
    }

    function setReverts(bool v) external {
        reverts = v;
    }

    function decimals() external view returns (uint8) {
        return feedDecimals;
    }

    function description() external pure returns (string memory) {
        return "MOCK / USD";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!reverts, "feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
