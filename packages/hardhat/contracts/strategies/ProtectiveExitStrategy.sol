// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { INocturneStrategy } from "../interfaces/INocturneStrategy.sol";
import { ISwapRouter } from "../interfaces/ISwapRouter.sol";
import { PriceGuard } from "../lib/PriceGuard.sol";

/**
 * @title ProtectiveExitStrategy
 * @notice Watches a price and leaves before it gets worse — while you are asleep.
 *
 * @dev You set a floor. The vault asks this strategy what to do and how long to
 *      wait. It answers "nothing, ask me again in six hours" while the price is
 *      comfortably above the floor, tightens to minutes as the price approaches,
 *      and sells the position when the floor breaks.
 *
 *      **Two things make it different from a stop-loss script.**
 *
 *      The first is that nobody runs it. There is no bot, no cron, no keeper
 *      network with a funded relayer and an uptime problem. The vault books its
 *      own next check with the Hedera Schedule Service, so the thing that fires
 *      at 4am is the network itself.
 *
 *      The second is that it can refuse. A stop-loss that trusts one price is a
 *      stop-loss that can be triggered by whoever last moved that price — and on
 *      this chain that is not hypothetical. This one requires a pool TWAP and a
 *      Chainlink feed to agree before it will sell anything; when they do not,
 *      it sells nothing, says why, and looks again sooner.
 *
 *      **Cadence is the point.** Hedera's own ScheduledVault takes a fixed
 *      interval and its strategy interface returns actions only, which makes
 *      their own documented use case — "as positions approach liquidation
 *      thresholds, contracts schedule increasingly frequent monitoring" —
 *      impossible to express. `nextInterval` below is that sentence, in code.
 *
 *      At roughly 1.6 HBAR per execution, the difference is not academic:
 *      checking hourly costs about 38 HBAR a day whether or not anything is
 *      happening, and checking daily can sleep through the move it exists to
 *      catch. Only the strategy knows which of those is currently wrong.
 */
contract ProtectiveExitStrategy is INocturneStrategy {
    using PriceGuard for PriceGuard.Reading;

    uint256 internal constant ONE = 1e18;
    uint256 internal constant BPS = 10_000;

    /// @dev Swap deadline, measured from the moment the plan is executed. Also
    ///      absorbs the ~2s a scheduled call's clock runs behind.
    uint256 internal constant DEADLINE_MARGIN = 60;

    // Cadence bands, in seconds. Chosen so a position far from its floor costs
    // almost nothing to watch and one near its floor is watched closely.
    uint256 internal constant CHECK_CALM = 6 hours;
    uint256 internal constant CHECK_WATCHFUL = 1 hours;
    uint256 internal constant CHECK_CLOSE = 5 minutes;
    uint256 internal constant CHECK_IMMINENT = 60;

    /// @dev How far above the floor each band starts, as a fraction of the floor.
    uint256 internal constant BAND_WATCHFUL = 0.15e18;
    uint256 internal constant BAND_CLOSE = 0.05e18;
    uint256 internal constant BAND_IMMINENT = 0.01e18;

    /// @dev When the sources disagree, look again sooner than the distance to
    ///      the floor would suggest. A divergence is information: something is
    ///      moving, or something is broken, and either way the answer is not
    ///      "sleep for six hours".
    uint256 internal constant CHECK_DIVERGED = 5 minutes;

    struct Config {
        /// @dev The vault holding the position. Passed explicitly rather than
        ///      taken from msg.sender so a UI can call `explain` directly.
        address vault;
        /// @dev The token being protected.
        address asset;
        /// @dev What to sell it for.
        address quote;
        /// @dev SaucerSwap router.
        address router;
        /// @dev Pool fee tier. 3000 on the reference WHBAR/USDC pool.
        uint24 fee;
        /// @dev Sell when the price falls below this, quote per asset, 1e18.
        uint256 floorPrice1e18;
        /// @dev Tolerance on the swap's minimum output.
        uint256 slippageBps;
        uint8 assetDecimals;
        uint8 quoteDecimals;
        PriceGuard.Sources sources;
    }

    // ------------------------------------------------------------------
    // INocturneStrategy
    // ------------------------------------------------------------------

    /// @inheritdoc INocturneStrategy
    function plan(bytes calldata config) external view override returns (Action[] memory actions) {
        Config memory c = abi.decode(config, (Config));

        uint256 balance = IERC20(c.asset).balanceOf(c.vault);
        if (balance == 0) return new Action[](0);

        PriceGuard.Reading memory r = PriceGuard.read(c.sources);

        // Refuse. Not an error — the vault records it, says why, and asks again
        // sooner. Selling into a price two sources cannot agree on is how the
        // holder ends up worse off than doing nothing.
        if (!r.agreed) return new Action[](0);

        // Still above the floor: nothing to do.
        if (r.twap >= c.floorPrice1e18 && r.feed >= c.floorPrice1e18) return new Action[](0);

        // The floor has broken on the cautious reading. Leave.
        uint256 price = PriceGuard.actionablePrice(r, true);
        uint256 minOut = _minimumOut(balance, price, c);

        actions = new Action[](2);
        actions[0] = Action({ target: c.asset, value: 0, data: abi.encodeCall(IERC20.approve, (c.router, balance)) });
        actions[1] = Action({
            target: c.router,
            value: 0,
            data: abi.encodeCall(
                ISwapRouter.exactInputSingle,
                (
                    ISwapRouter.ExactInputSingleParams({
                        tokenIn: c.asset,
                        tokenOut: c.quote,
                        fee: c.fee,
                        recipient: c.vault,
                        deadline: block.timestamp + DEADLINE_MARGIN,
                        amountIn: balance,
                        amountOutMinimum: minOut,
                        sqrtPriceLimitX96: 0
                    })
                )
            )
        });
    }

    /**
     * @inheritdoc INocturneStrategy
     * @dev The sentence Hedera's own vault cannot say.
     */
    function nextInterval(bytes calldata config) external view override returns (uint256) {
        Config memory c = abi.decode(config, (Config));

        PriceGuard.Reading memory r = PriceGuard.read(c.sources);
        if (!r.agreed) return CHECK_DIVERGED;

        uint256 price = PriceGuard.actionablePrice(r, true);
        if (price <= c.floorPrice1e18) return CHECK_IMMINENT;

        // How far above the floor, as a fraction of it.
        uint256 distance = Math.mulDiv(price - c.floorPrice1e18, ONE, c.floorPrice1e18);

        if (distance < BAND_IMMINENT) return CHECK_IMMINENT;
        if (distance < BAND_CLOSE) return CHECK_CLOSE;
        if (distance < BAND_WATCHFUL) return CHECK_WATCHFUL;
        return CHECK_CALM;
    }

    /// @inheritdoc INocturneStrategy
    function validateConfig(bytes calldata config) external pure override returns (bool) {
        Config memory c = abi.decode(config, (Config));

        if (c.vault == address(0)) return false;
        if (c.asset == address(0) || c.quote == address(0)) return false;
        if (c.asset == c.quote) return false;
        if (c.router == address(0)) return false;
        if (c.floorPrice1e18 == 0) return false;
        // A swap with no minimum output is a free option for anyone watching.
        if (c.slippageBps == 0 || c.slippageBps >= BPS) return false;
        if (c.sources.pool == address(0) || c.sources.feed == address(0)) return false;
        if (c.sources.twapWindow == 0) return false;
        if (c.sources.maxFeedAge == 0) return false;
        return true;
    }

    /// @inheritdoc INocturneStrategy
    function explain(bytes calldata config) external view override returns (string memory, uint256, uint256) {
        Config memory c = abi.decode(config, (Config));

        if (IERC20(c.asset).balanceOf(c.vault) == 0) return ("nothing held", 0, 0);

        PriceGuard.Reading memory r = PriceGuard.read(c.sources);
        if (!r.agreed) return (r.reason, r.twap, r.feed);

        uint256 price = PriceGuard.actionablePrice(r, true);
        if (price < c.floorPrice1e18) return ("exiting", price, c.floorPrice1e18);
        return ("holding", price, c.floorPrice1e18);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * @notice The least the swap may return before it should revert.
     * @dev Never zero. A scheduled swap with no floor under its output is a
     *      standing invitation to whoever is watching the pool, and on a thin
     *      one it is a guaranteed loss rather than a risk.
     */
    function _minimumOut(uint256 amountIn, uint256 price1e18, Config memory c) private pure returns (uint256) {
        // asset units -> quote units, via a whole-token price.
        uint256 expected = Math.mulDiv(
            Math.mulDiv(amountIn, price1e18, ONE),
            10 ** c.quoteDecimals,
            10 ** c.assetDecimals
        );
        return Math.mulDiv(expected, BPS - c.slippageBps, BPS);
    }

    /// @notice Build a config without hand-encoding it.
    function encodeConfig(Config calldata c) external pure returns (bytes memory) {
        return abi.encode(c);
    }

    /// @notice The distance above the floor and the interval it implies.
    /// @dev For a UI that wants to show why the next check is when it is.
    function cadence(bytes calldata config) external view returns (uint256 distance1e18, uint256 intervalSeconds) {
        Config memory c = abi.decode(config, (Config));
        PriceGuard.Reading memory r = PriceGuard.read(c.sources);

        if (!r.agreed) return (0, CHECK_DIVERGED);

        uint256 price = PriceGuard.actionablePrice(r, true);
        if (price <= c.floorPrice1e18) return (0, CHECK_IMMINENT);

        distance1e18 = Math.mulDiv(price - c.floorPrice1e18, ONE, c.floorPrice1e18);
        if (distance1e18 < BAND_IMMINENT) return (distance1e18, CHECK_IMMINENT);
        if (distance1e18 < BAND_CLOSE) return (distance1e18, CHECK_CLOSE);
        if (distance1e18 < BAND_WATCHFUL) return (distance1e18, CHECK_WATCHFUL);
        return (distance1e18, CHECK_CALM);
    }
}
