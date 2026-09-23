// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ISwapRouter } from "../interfaces/ISwapRouter.sol";

/// @notice A token a test can mint freely, with a configurable number of decimals.
contract MockToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @notice A router that really moves tokens, at a price the test sets.
 *
 * @dev Enough of SaucerSwap's behaviour to prove a plan executes: it pulls
 *      `amountIn` with `transferFrom` — so a missing approval fails the way it
 *      would on chain — pays out at `priceX`, and honours `amountOutMinimum` and
 *      `deadline`. Those last two matter: a mock that ignored them would let a
 *      strategy pass tests while shipping swaps with no slippage floor.
 */
contract MockSwapRouter is ISwapRouter {
    uint256 internal constant ONE = 1e18;

    /// @notice Quote tokens per whole asset token, 1e18.
    uint256 public price1e18;
    /// @notice Shaved off the output, to simulate slippage and fees.
    uint256 public slippageBps;

    uint256 public swaps;
    ExactInputSingleParams public lastParams;

    error DeadlinePassed();
    error TooLittleReceived(uint256 got, uint256 wanted);

    constructor(uint256 price_) {
        price1e18 = price_;
    }

    function setPrice(uint256 v) external {
        price1e18 = v;
    }

    function setSlippageBps(uint256 v) external {
        slippageBps = v;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        if (block.timestamp > p.deadline) revert DeadlinePassed();

        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);

        uint8 inDecimals = MockToken(p.tokenIn).decimals();
        uint8 outDecimals = MockToken(p.tokenOut).decimals();

        amountOut = Math.mulDiv(Math.mulDiv(p.amountIn, price1e18, ONE), 10 ** outDecimals, 10 ** inDecimals);
        amountOut = Math.mulDiv(amountOut, 10_000 - slippageBps, 10_000);

        if (amountOut < p.amountOutMinimum) revert TooLittleReceived(amountOut, p.amountOutMinimum);

        MockToken(p.tokenOut).mint(p.recipient, amountOut);

        swaps += 1;
        lastParams = p;
    }
}
