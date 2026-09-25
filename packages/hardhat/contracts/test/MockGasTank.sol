// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A tank whose balances a test sets directly, and which counts top-ups.
contract MockGasTank {
    mapping(address => uint256) public balanceOf;

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }

    function topUp(address who, uint256 amount) external {
        balanceOf[who] += amount;
    }
}
