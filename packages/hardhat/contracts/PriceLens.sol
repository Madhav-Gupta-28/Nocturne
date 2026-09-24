// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PriceGuard } from "./lib/PriceGuard.sol";

/**
 * @title PriceLens
 * @notice Shows what the price guard sees, without a vault and without acting.
 *
 * @dev `PriceGuard` is a library, so it has no address a frontend can call. This
 *      gives it one.
 *
 *      It exists because the most important thing this system does is the thing
 *      that leaves no trace: refusing. A vault that declines to sell emits a
 *      `Refused` event and nothing else happens — no swap, no balance change,
 *      nothing an explorer highlights. Anyone deciding whether to trust that
 *      behaviour needs to see the two prices *before* a vault is armed, and see
 *      that they disagree, and see by how much.
 *
 *      Holds nothing, owns nothing, changes nothing. Every function is `view`,
 *      so this is safe to point any UI at and safe to leave deployed forever.
 *      One deployment serves every vault and every pair, because the sources are
 *      an argument rather than state.
 */
contract PriceLens {
    /**
     * @notice Read both sources and say whether they corroborate each other.
     * @param sources Pool, feed, window, tolerance — the same struct a strategy
     *        is configured with, so what this returns is what that strategy
     *        would act on.
     * @return reading Both prices, the divergence between them in bps, the age
     *         of the feed, whether they agreed, and if not, why not in words.
     */
    function read(PriceGuard.Sources calldata sources) external view returns (PriceGuard.Reading memory reading) {
        return PriceGuard.read(sources);
    }

    /**
     * @notice The price a strategy would act on, given a reading.
     * @param sellingAsset True when the asset is being sold, which takes the
     *        lower of the two prices; false takes the higher. Either way it is
     *        the side that makes acting less attractive.
     */
    function actionablePrice(PriceGuard.Reading calldata reading, bool sellingAsset) external pure returns (uint256) {
        return PriceGuard.actionablePrice(reading, sellingAsset);
    }
}
