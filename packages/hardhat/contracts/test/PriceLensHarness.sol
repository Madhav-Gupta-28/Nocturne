// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TwapLib } from "../lib/TwapLib.sol";
import { TickMath } from "../lib/TickMath.sol";
import { PriceGuard } from "../lib/PriceGuard.sol";

/**
 * @notice Exposes the pricing libraries so tests can call them.
 * @dev Libraries with internal functions have no external surface, so there is
 *      nothing to call from a test without a wrapper like this. It is a test
 *      fixture and is never deployed as part of the template.
 */
contract PriceLensHarness {
    function sqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function priceFromTick(
        int24 tick,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) external pure returns (uint256) {
        return TwapLib.priceFromTick(tick, assetIsToken0, assetDecimals, quoteDecimals);
    }

    function meanTick(address pool, uint32 window) external view returns (int24) {
        return TwapLib.meanTick(pool, window);
    }

    function tryTwapPrice(
        address pool,
        uint32 window,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) external view returns (bool, uint256) {
        return TwapLib.tryTwapPrice(pool, window, assetIsToken0, assetDecimals, quoteDecimals);
    }

    function twapPrice(
        address pool,
        uint32 window,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) external view returns (uint256) {
        return TwapLib.twapPrice(pool, window, assetIsToken0, assetDecimals, quoteDecimals);
    }

    function spotPrice(
        address pool,
        bool assetIsToken0,
        uint8 assetDecimals,
        uint8 quoteDecimals
    ) external view returns (uint256) {
        return TwapLib.spotPrice(pool, assetIsToken0, assetDecimals, quoteDecimals);
    }

    function read(PriceGuard.Sources calldata s) external view returns (PriceGuard.Reading memory) {
        return PriceGuard.read(s);
    }

    function divergenceBps(uint256 a, uint256 b) external pure returns (uint256) {
        return PriceGuard.divergenceBps(a, b);
    }

    function actionablePrice(PriceGuard.Reading calldata r, bool sellingAsset) external pure returns (uint256) {
        return PriceGuard.actionablePrice(r, sellingAsset);
    }
}
