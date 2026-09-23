// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TickMath
 * @notice Converts a Uniswap V3 tick into a sqrt price, Q64.96.
 *
 * @dev An independent implementation, not a copy. Uniswap's v3-core is GPL-2.0
 *      and this repository is MIT, so lifting their TickMath would be a licence
 *      violation however convenient it looks.
 *
 *      The algorithm is the standard one and is not anybody's property: a tick
 *      is an exponent, `sqrt(1.0001^tick)` is computed by binary decomposition,
 *      and each bit of `|tick|` contributes one precomputed factor
 *      `2^128 / sqrt(1.0001)^(2^i)`. The constants below were derived to 100
 *      significant figures rather than transcribed; they agree with Uniswap's
 *      published values to within 5.5e-13 relative, which is about 5e-9 basis
 *      points and far below anything this library is used to decide.
 *
 *      Checked against live state: the SaucerSwap WHBAR/USDC pool on Hedera
 *      testnet reports tick 38874 and sqrtPriceX96
 *      553322340177179676681786292758. This function returns a value 0.061 bps
 *      below it, which is correct rather than an error — `slot0.tick` is the
 *      floor of the true tick, so the exact price sits between tick and
 *      tick + 1. The test asserts that relationship rather than equality.
 */
library TickMath {
    /// @notice Bounds beyond which a sqrt price no longer fits Q64.96.
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    error TickOutOfBounds(int24 tick);

    /**
     * @notice sqrt(1.0001^tick) * 2^96.
     * @dev Works in Q128.128 and shifts down at the end, so the truncation of
     *      each intermediate product costs a fraction of a bit rather than
     *      compounding into anything visible.
     */
    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
            if (tick < MIN_TICK || tick > MAX_TICK) revert TickOutOfBounds(tick);

            uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));

            // Start at 1.0 in Q128.128, or at the first factor if bit 0 is set.
            uint256 ratio = 0x100000000000000000000000000000000;

            if (absTick & 0x1 != 0) ratio = (ratio * 0xfffcb933bd6fad9d3af5f0b9f25db4d6) >> 128;
            if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d41fd789c8cb37ffcaa1c) >> 128;
            if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656ac9229c67059486f389) >> 128;
            if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e81259b3cddc7a064941) >> 128;
            if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f67b19e8887e0bd251eb7) >> 128;
            if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98cd2e57b660be99eb2c4a) >> 128;
            if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c9838804e327cb417cafcb) >> 128;
            if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99d51e2cc356c2f617dbe0) >> 128;
            if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900aecf64236ab31f1f9dcb5) >> 128;
            if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac4d9194200696907cf2e37) >> 128;
            if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b88206f8abe8a3b44dd9be) >> 128;
            if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c578ef4f1d17b2b235d480) >> 128;
            if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd254ee83bdd3f248e7e785e) >> 128;
            if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d8f7dd10e744d913d033333) >> 128;
            if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156ddd32a39e257bc3f50aa9b) >> 128;
            if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97da6e09a19dc367e3b6da40) >> 128;
            if (absTick & 0x10000 != 0) ratio = (ratio * 0x09aa508b5b7e5a9780b0cc4e25d61a56) >> 128;
            if (absTick & 0x20000 != 0) ratio = (ratio * 0x005d6af8dedbcb3a6ccb7ce618d14225) >> 128;
            if (absTick & 0x40000 != 0) ratio = (ratio * 0x00002216e584f630389b2052b8db590e) >> 128;
            if (absTick & 0x80000 != 0) ratio = (ratio * 0x00000000048a1703920644d4030024fe) >> 128;

            // Everything above computed 1 / sqrt(1.0001)^absTick. A positive
            // tick wants the reciprocal of that.
            if (tick > 0) ratio = type(uint256).max / ratio;

            // Q128.128 -> Q64.96, rounding up so the result never understates
            // the price it represents.
            sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
        }
    }
}
