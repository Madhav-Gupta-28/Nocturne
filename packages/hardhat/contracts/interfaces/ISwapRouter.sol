// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice SaucerSwap V2's swap router.
 *
 * @dev This is the **original** Uniswap V3 `SwapRouter`, not `SwapRouter02`, so
 *      `ExactInputSingleParams` carries a `deadline`. That was established from
 *      the deployed bytecode rather than from documentation, because the two
 *      routers differ only in that one field and picking the wrong struct
 *      produces a revert with nothing useful in it:
 *
 *        selector 0x414bf389  exactInputSingle(..., uint256 deadline, ...)  present
 *        selector 0x04e45aaf  exactInputSingle(... no deadline ...)         absent
 *
 *      Live on Hedera testnet at 0x0000000000000000000000000000000000159398
 *      (0.0.1414040).
 */
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swap `amountIn` of one token for as much as possible of another.
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
