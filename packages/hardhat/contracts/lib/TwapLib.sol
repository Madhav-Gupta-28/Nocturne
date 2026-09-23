// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IUniswapV3PoolOracle } from "../interfaces/IUniswapV3PoolOracle.sol";
import { TickMath } from "./TickMath.sol";

/**
 * @title TwapLib
 * @notice A time-weighted price from a Uniswap V3 style pool, as whole quote
 *         tokens per whole asset token, scaled to 1e18.
 *
 * @dev **Why not `slot0`.** The spot price is whatever the last trade left
 *      behind, and anyone can put it wherever they like inside a single
 *      transaction with borrowed money. A contract that acts on a spot price is
 *      a contract that can be told what to do by whoever moved it last.
 *
 *      A time-weighted average costs an attacker the price impact *sustained
 *      across the whole window*, which is a different order of expense. Hedera
 *      has a nine-million-dollar demonstration of why this matters: on 11 July
 *      2026 a manipulated price took $9.05M out of Bonzo Lend and roughly 40% of
 *      the chain's total value locked with it.
 */
library TwapLib {
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant ONE = 1e18;

    error WindowTooShort();

    /**
     * @notice The arithmetic mean tick over the last `window` seconds.
     *
     * @dev Reverts (as `OLD`, from the pool) when the pool has not observed far
     *      enough back. That is a real condition on a young pool, and the caller
     *      should treat it as "no opinion" rather than as a price of zero —
     *      which is why strategies wrap this and decline rather than guessing.
     */
    function meanTick(address pool, uint32 window) internal view returns (int24) {
        if (window == 0) revert WindowTooShort();

        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        ago[1] = 0;

        (int56[] memory cumulatives, ) = IUniswapV3PoolOracle(pool).observe(ago);
        int56 delta = cumulatives[1] - cumulatives[0];

        int24 mean = int24(delta / int56(uint56(window)));

        // Solidity truncates toward zero; the mean tick must floor toward
        // negative infinity or a negative average reads one tick too high.
        if (delta < 0 && (delta % int56(uint56(window)) != 0)) mean--;

        return mean;
    }

    /**
     * @notice Convert a tick into whole quote tokens per whole asset token, 1e18.
     *
     * @param assetIsToken0 Whether the asset being priced is the pool's token0.
     * @param assetDecimals Decimals of the asset. On Hedera these are rarely 18
     *        — WHBAR is 8 and USDC is 6 — so this conversion is not optional
     *        decoration, it is the difference between $2.05 and $205,000,000.
     */
    function priceFromTick(
        int24 tick,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) internal pure returns (uint256 price1e18) {
        uint256 sqrtPriceX96 = uint256(TickMath.getSqrtRatioAtTick(tick));

        // sqrtPrice^2 would overflow uint256 at the top of the range, so square
        // it in two steps and keep the result in Q96: this is token1 per token0
        // in raw units.
        uint256 priceX96 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);

        if (assetIsToken0) {
            // quote is token1: raw price already points the right way.
            uint256 scaled = Math.mulDiv(priceX96, ONE, Q96);
            price1e18 = Math.mulDiv(scaled, 10 ** assetDecimals, 10 ** quoteDecimals);
        } else {
            // quote is token0: invert before scaling.
            uint256 inverted = Math.mulDiv(Q96, ONE, priceX96);
            price1e18 = Math.mulDiv(inverted, 10 ** assetDecimals, 10 ** quoteDecimals);
        }
    }

    /**
     * @notice The mean tick, reporting failure rather than reverting.
     *
     * @dev A raw staticcall, for the same reason the vault uses one on the
     *      Schedule Service: the caller needs to survive a pool that cannot
     *      answer. `observe` reverts with `OLD` whenever the requested window
     *      reaches further back than the pool has observations for, which is an
     *      ordinary condition on a young pool or a long window, not a fault.
     *
     *      A library cannot try/catch its own internal call and cannot use
     *      `this`, so the alternative would be deploying PriceGuard as a
     *      contract purely to get an external frame. This is cheaper and keeps
     *      the failure handling in one place.
     */
    function tryMeanTick(address pool, uint32 window) internal view returns (bool ok, int24 tick) {
        if (window == 0) return (false, 0);

        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        ago[1] = 0;

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory data) = pool.staticcall(
            abi.encodeWithSelector(IUniswapV3PoolOracle.observe.selector, ago)
        );
        if (!success || data.length == 0) return (false, 0);

        (int56[] memory cumulatives, ) = abi.decode(data, (int56[], uint160[]));
        if (cumulatives.length < 2) return (false, 0);

        int56 delta = cumulatives[1] - cumulatives[0];
        tick = int24(delta / int56(uint56(window)));
        if (delta < 0 && (delta % int56(uint56(window)) != 0)) tick--;
        return (true, tick);
    }

    /// @notice The time-weighted price, reporting failure rather than reverting.
    function tryTwapPrice(
        address pool,
        uint32 window,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) internal view returns (bool ok, uint256 price1e18) {
        (bool got, int24 tick) = tryMeanTick(pool, window);
        if (!got) return (false, 0);
        return (true, priceFromTick(tick, assetIsToken0, assetDecimals, quoteDecimals));
    }

    /// @notice The time-weighted price, in one call.
    function twapPrice(
        address pool,
        uint32 window,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) internal view returns (uint256 price1e18) {
        return priceFromTick(meanTick(pool, window), assetIsToken0, assetDecimals, quoteDecimals);
    }

    /// @notice The spot price, for display only.
    /// @dev Never use this to decide anything. It exists so a UI can show the
    ///      gap between spot and TWAP, which is the clearest way to explain to
    ///      somebody why the guard is refusing.
    function spotPrice(
        address pool,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) internal view returns (uint256 price1e18) {
        (, int24 tick, , , , , ) = IUniswapV3PoolOracle(pool).slot0();
        return priceFromTick(tick, assetIsToken0, assetDecimals, quoteDecimals);
    }
}
