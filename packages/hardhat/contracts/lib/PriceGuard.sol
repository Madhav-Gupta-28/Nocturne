// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { AggregatorV3Interface } from "../interfaces/AggregatorV3Interface.sol";
import { TwapLib } from "./TwapLib.sol";

/**
 * @title PriceGuard
 * @notice Two independent prices, and permission to act only when they agree.
 *
 * @dev This is the part of Nocturne that exists because of a specific event.
 *
 *      On 11 July 2026 an attacker deposited 250 SAUCE into Bonzo Lend, pushed
 *      one oracle's price up by about twelve orders of magnitude, and borrowed
 *      roughly 6.6M USDC and 34.5M WHBAR against it. **$9.05M.** Bonzo's TVL
 *      fell 77%, Hedera's fell about 40% in a day, and the lending pool is
 *      still paused.
 *
 *      Nothing in Bonzo's own contracts was wrong. A single price source was
 *      believed, and it lied.
 *
 *      Nocturne automates actions that are driven by a price, which is the same
 *      machinery pointed at the same hazard. So it reads two sources that fail
 *      independently — a pool TWAP and a Chainlink feed — and does nothing at
 *      all unless they agree. Manipulating the pool does not move Chainlink;
 *      corrupting Chainlink does not move the pool.
 *
 *      **Staleness is disagreement.** A feed older than `maxFeedAge` is not a
 *      second opinion, it is an old one, and falling back to a single live
 *      source is exactly the posture that got Bonzo drained. Chainlink pairs
 *      update on deviation as well as heartbeat, so an hours-old stablecoin
 *      reading is normal and still not usable as corroboration.
 *
 *      **ASSUMPTION.** The feed must quote the asset in the same unit as the
 *      pool's quote token. Pricing WHBAR against USDC in the pool and reading
 *      HBAR/USD from Chainlink works because USDC tracks USD; pairing a pool
 *      quoted in SAUCE with a USD feed would compare two different things and
 *      diverge permanently. The caller chooses both, so the caller owns this.
 */
library PriceGuard {
    uint256 internal constant ONE = 1e18;
    uint256 internal constant BPS = 10_000;

    struct Sources {
        /// @dev Uniswap V3 style pool holding asset and quote.
        address pool;
        /// @dev TWAP window in seconds. Longer is harder to manipulate and
        ///      slower to react; it is the main dial on this guard.
        uint32 twapWindow;
        /// @dev Chainlink aggregator quoting the asset.
        address feed;
        /// @dev Older than this and the feed stops counting as corroboration.
        uint256 maxFeedAge;
        /// @dev How far apart the two may be before acting is refused.
        uint256 maxDivergenceBps;
        bool assetIsToken0;
        uint8 assetDecimals;
        uint8 quoteDecimals;
    }

    struct Reading {
        /// @dev True only when both sources answered, the feed is fresh, and
        ///      they are within tolerance. The only value a caller should act on.
        bool agreed;
        /// @dev Pool TWAP, quote per asset, 1e18. Zero if the pool could not answer.
        uint256 twap;
        /// @dev Chainlink, normalised to 1e18. Zero if the feed could not answer.
        uint256 feed;
        /// @dev How far apart, relative to the smaller. Conservative on purpose.
        uint256 divergenceBps;
        /// @dev Seconds since the feed last updated.
        uint256 feedAge;
        /// @dev Why not, when `agreed` is false. Empty when it is true.
        string reason;
    }

    /**
     * @notice Read both sources and decide whether acting is allowed.
     * @dev Never reverts. A pool too young to answer, a feed reporting a
     *      non-positive price, a feed that has gone quiet — all of them produce
     *      `agreed == false` with a reason attached, because a strategy that
     *      reverts here would take the vault's whole run with it.
     */
    function read(Sources memory s) internal view returns (Reading memory r) {
        // The pool. `observe` reverts on a window the pool has not lived
        // through yet, which is a normal condition rather than an error, so
        // this reports failure instead of propagating it.
        (bool poolOk, uint256 twap) = TwapLib.tryTwapPrice(
            s.pool,
            s.twapWindow,
            s.assetIsToken0,
            s.assetDecimals,
            s.quoteDecimals
        );
        if (!poolOk) {
            r.reason = "pool has no window yet";
            return r;
        }
        r.twap = twap;

        (bool feedOk, uint256 feedPrice, uint256 age) = _feed(s.feed);
        r.feed = feedPrice;
        r.feedAge = age;

        if (!feedOk) {
            r.reason = "feed unavailable";
            return r;
        }
        if (age > s.maxFeedAge) {
            // An old price is not a second opinion. Refusing here is the whole
            // point: the alternative is trusting one live source.
            r.reason = "feed stale";
            return r;
        }
        if (r.twap == 0) {
            r.reason = "pool price is zero";
            return r;
        }

        r.divergenceBps = divergenceBps(r.twap, r.feed);
        if (r.divergenceBps > s.maxDivergenceBps) {
            r.reason = "sources disagree";
            return r;
        }

        r.agreed = true;
    }

    /**
     * @notice Relative distance between two prices, in basis points.
     * @dev Measured against the **smaller** of the two, which overstates the gap
     *      compared with using the mean or the larger. That is deliberate: every
     *      rounding decision in this library should make refusing more likely,
     *      not less.
     */
    function divergenceBps(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return type(uint256).max;
        uint256 lo = a < b ? a : b;
        uint256 hi = a < b ? b : a;
        return Math.mulDiv(hi - lo, BPS, lo);
    }

    /**
     * @notice The price to act on when the sources agree.
     * @dev Takes the one less favourable to the action being contemplated. A
     *      guard should never be made more eager by a disagreement it happened
     *      to tolerate.
     * @param sellingAsset True when the action sells the asset, in which case a
     *        lower price is the cautious assumption for the proceeds.
     */
    function actionablePrice(Reading memory r, bool sellingAsset) internal pure returns (uint256) {
        if (sellingAsset) return r.twap < r.feed ? r.twap : r.feed;
        return r.twap > r.feed ? r.twap : r.feed;
    }

    function _feed(address feed) private view returns (bool ok, uint256 price1e18, uint256 age) {
        if (feed == address(0)) return (false, 0, 0);

        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            if (answer <= 0 || updatedAt == 0) return (false, 0, 0);

            uint8 decimals = AggregatorV3Interface(feed).decimals();
            price1e18 = decimals <= 18
                ? uint256(answer) * (10 ** (18 - decimals))
                : uint256(answer) / (10 ** (decimals - 18));

            age = block.timestamp > updatedAt ? block.timestamp - updatedAt : 0;
            return (true, price1e18, age);
        } catch {
            return (false, 0, 0);
        }
    }
}
