// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { INocturneStrategy } from "../interfaces/INocturneStrategy.sol";
import { ISwapRouter } from "../interfaces/ISwapRouter.sol";
import { PriceGuard } from "../lib/PriceGuard.sol";

/**
 * @title DriftRebalanceStrategy
 * @notice Holds two tokens in a target ratio and puts them back when they drift.
 *
 * @dev The second strategy, and the reason there is a second one.
 *
 *      A single strategy and an engine are indistinguishable from an app. Two
 *      strategies of genuinely different *shape* on one engine is the evidence
 *      that the abstraction holds — and these two are about as different as the
 *      interface allows:
 *
 *        ProtectiveExit     a threshold. One-way, terminal, urgent.
 *                           Sells everything, once, and is then done.
 *        DriftRebalance     a target. Two-way, repeating, economic.
 *                           Trades in whichever direction restores the ratio,
 *                           forever, and only when the trade pays for itself.
 *
 *      If `plan` and `nextInterval` express both without either needing a
 *      special case in the vault, the interface is right and a third strategy
 *      is a file rather than a rewrite.
 *
 *      **Acting has to be worth it.** At roughly 1.6 HBAR per execution plus a
 *      pool fee and slippage, a rebalance that corrects less than it costs makes
 *      the holder poorer while looking busy. `minTradeValue1e18` is the floor
 *      under that, and a trade below it is declined — which the vault records as
 *      a refusal with a reason, not as a failure.
 */
contract DriftRebalanceStrategy is INocturneStrategy {
    uint256 internal constant ONE = 1e18;
    uint256 internal constant BPS = 10_000;

    uint256 internal constant DEADLINE_MARGIN = 60;

    // Cadence, mirroring the exit strategy's shape but two-sided: the closer
    // the drift is to the edge of the band, the sooner we look again.
    uint256 internal constant CHECK_CALM = 12 hours;
    uint256 internal constant CHECK_WATCHFUL = 2 hours;
    uint256 internal constant CHECK_CLOSE = 15 minutes;
    uint256 internal constant CHECK_DIVERGED = 5 minutes;

    struct Config {
        address vault;
        /// @dev The asset whose share of the portfolio is being targeted.
        address assetA;
        /// @dev The other side. Prices are quoted in this.
        address assetB;
        address router;
        uint24 fee;
        /// @dev Target share of total value held in assetA, in bps. 5000 = half.
        uint16 targetBpsA;
        /// @dev Leave it alone while drift stays inside target +/- this.
        uint16 bandBps;
        /// @dev Smallest corrective trade worth making, valued in assetB, 1e18.
        uint256 minTradeValue1e18;
        uint256 slippageBps;
        uint8 decimalsA;
        uint8 decimalsB;
        PriceGuard.Sources sources;
    }

    /// @dev What a read of the position amounts to, so plan/explain/cadence all
    ///      see the same numbers instead of each recomputing them slightly
    ///      differently.
    struct Position {
        bool priced;
        string reason;
        uint256 price;
        uint256 balanceA;
        uint256 balanceB;
        /// @dev Total portfolio value, in whole assetB, 1e18.
        uint256 totalValue;
        /// @dev Current share held in assetA, bps.
        uint256 currentBpsA;
        /// @dev How far from target, bps. Unsigned; `overweightA` gives the sign.
        uint256 driftBps;
        bool overweightA;
        /// @dev Value of the trade that would restore the target, in assetB, 1e18.
        uint256 tradeValue;
    }

    // ------------------------------------------------------------------
    // INocturneStrategy
    // ------------------------------------------------------------------

    /// @inheritdoc INocturneStrategy
    function plan(bytes calldata config) external view override returns (Action[] memory actions) {
        Config memory c = abi.decode(config, (Config));
        Position memory p = _read(c);

        if (!p.priced) return new Action[](0);
        if (p.totalValue == 0) return new Action[](0);
        if (p.driftBps <= c.bandBps) return new Action[](0);

        // A correction that costs more than it corrects is not a correction.
        if (p.tradeValue < c.minTradeValue1e18) return new Action[](0);

        // Sell whichever side is heavy.
        (address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) = p.overweightA
            ? (c.assetA, c.assetB, _assetAFor(p.tradeValue, p.price, c), _minOut(p.tradeValue, c.decimalsB, c))
            : (c.assetB, c.assetA, _assetBFor(p.tradeValue, c), _minOutA(p.tradeValue, p.price, c));

        if (amountIn == 0) return new Action[](0);

        actions = new Action[](2);
        actions[0] = Action({ target: tokenIn, value: 0, data: abi.encodeCall(IERC20.approve, (c.router, amountIn)) });
        actions[1] = Action({
            target: c.router,
            value: 0,
            data: abi.encodeCall(
                ISwapRouter.exactInputSingle,
                (
                    ISwapRouter.ExactInputSingleParams({
                        tokenIn: tokenIn,
                        tokenOut: tokenOut,
                        fee: c.fee,
                        recipient: c.vault,
                        deadline: block.timestamp + DEADLINE_MARGIN,
                        amountIn: amountIn,
                        amountOutMinimum: minOut,
                        sqrtPriceLimitX96: 0
                    })
                )
            )
        });
    }

    /// @inheritdoc INocturneStrategy
    function nextInterval(bytes calldata config) external view override returns (uint256) {
        Config memory c = abi.decode(config, (Config));
        Position memory p = _read(c);

        if (!p.priced) return CHECK_DIVERGED;
        if (c.bandBps == 0) return CHECK_CLOSE;

        // How close the drift is to the edge of the band, as a fraction of it.
        uint256 nearness = Math.mulDiv(p.driftBps, ONE, c.bandBps);

        if (nearness >= ONE) return CHECK_CLOSE; // already outside
        if (nearness >= 0.6e18) return CHECK_CLOSE;
        if (nearness >= 0.3e18) return CHECK_WATCHFUL;
        return CHECK_CALM;
    }

    /// @inheritdoc INocturneStrategy
    function validateConfig(bytes calldata config) external pure override returns (bool) {
        Config memory c = abi.decode(config, (Config));

        if (c.vault == address(0)) return false;
        if (c.assetA == address(0) || c.assetB == address(0)) return false;
        if (c.assetA == c.assetB) return false;
        if (c.router == address(0)) return false;
        // A target of 0 or 10000 is a single-asset portfolio, which needs no
        // rebalancing and would trade to nothing.
        if (c.targetBpsA == 0 || c.targetBpsA >= BPS) return false;
        if (c.bandBps == 0 || c.bandBps >= BPS) return false;
        if (c.slippageBps == 0 || c.slippageBps >= BPS) return false;
        if (c.minTradeValue1e18 == 0) return false;
        if (c.sources.pool == address(0) || c.sources.feed == address(0)) return false;
        if (c.sources.twapWindow == 0 || c.sources.maxFeedAge == 0) return false;
        return true;
    }

    /// @inheritdoc INocturneStrategy
    function explain(bytes calldata config) external view override returns (string memory, uint256, uint256) {
        Config memory c = abi.decode(config, (Config));
        Position memory p = _read(c);

        if (!p.priced) return (p.reason, p.price, 0);
        if (p.totalValue == 0) return ("nothing held", 0, 0);
        if (p.driftBps <= c.bandBps) return ("balanced", p.currentBpsA, c.targetBpsA);
        if (p.tradeValue < c.minTradeValue1e18) return ("drift too small to pay for itself", p.driftBps, p.tradeValue);
        return (p.overweightA ? "selling A" : "buying A", p.currentBpsA, c.targetBpsA);
    }

    /// @notice The full position read, for a UI.
    function inspect(bytes calldata config) external view returns (Position memory) {
        return _read(abi.decode(config, (Config)));
    }

    function encodeConfig(Config calldata c) external pure returns (bytes memory) {
        return abi.encode(c);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _read(Config memory c) private view returns (Position memory p) {
        PriceGuard.Reading memory r = PriceGuard.read(c.sources);
        if (!r.agreed) {
            p.reason = r.reason;
            p.price = r.twap;
            return p;
        }

        p.priced = true;
        // Neither direction is "selling the asset" in the exit strategy's
        // sense, so take the reading that makes the trade smaller: the
        // conservative choice here is the one that acts less.
        p.price = r.twap < r.feed ? r.twap : r.feed;

        p.balanceA = IERC20(c.assetA).balanceOf(c.vault);
        p.balanceB = IERC20(c.assetB).balanceOf(c.vault);

        uint256 valueA = _valueOfA(p.balanceA, p.price, c);
        uint256 valueB = Math.mulDiv(p.balanceB, ONE, 10 ** c.decimalsB);
        p.totalValue = valueA + valueB;
        if (p.totalValue == 0) return p;

        p.currentBpsA = Math.mulDiv(valueA, BPS, p.totalValue);
        p.overweightA = p.currentBpsA > c.targetBpsA;
        p.driftBps = p.overweightA ? p.currentBpsA - c.targetBpsA : c.targetBpsA - p.currentBpsA;

        // Value that must move to land exactly on target.
        uint256 targetValueA = Math.mulDiv(p.totalValue, c.targetBpsA, BPS);
        p.tradeValue = p.overweightA ? valueA - targetValueA : targetValueA - valueA;
    }

    /// @dev Whole-B value of a raw A balance.
    function _valueOfA(uint256 balanceA, uint256 price, Config memory c) private pure returns (uint256) {
        return Math.mulDiv(Math.mulDiv(balanceA, price, ONE), ONE, 10 ** c.decimalsA);
    }

    /// @dev Raw A units worth `value` whole B.
    function _assetAFor(uint256 value, uint256 price, Config memory c) private pure returns (uint256) {
        if (price == 0) return 0;
        return Math.mulDiv(Math.mulDiv(value, ONE, price), 10 ** c.decimalsA, ONE);
    }

    /// @dev Raw B units worth `value` whole B.
    function _assetBFor(uint256 value, Config memory c) private pure returns (uint256) {
        return Math.mulDiv(value, 10 ** c.decimalsB, ONE);
    }

    /// @dev Minimum B out when selling A worth `value`.
    function _minOut(uint256 value, uint8 decimalsOut, Config memory c) private pure returns (uint256) {
        uint256 expected = Math.mulDiv(value, 10 ** decimalsOut, ONE);
        return Math.mulDiv(expected, BPS - c.slippageBps, BPS);
    }

    /// @dev Minimum A out when spending B worth `value`.
    function _minOutA(uint256 value, uint256 price, Config memory c) private pure returns (uint256) {
        if (price == 0) return 0;
        uint256 expected = Math.mulDiv(Math.mulDiv(value, ONE, price), 10 ** c.decimalsA, ONE);
        return Math.mulDiv(expected, BPS - c.slippageBps, BPS);
    }
}
