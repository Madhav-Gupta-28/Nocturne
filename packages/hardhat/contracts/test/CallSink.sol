// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A target that records being called, so a test can prove a scheduled
///         call actually reached something rather than merely being booked.
contract CallSink {
    uint256 public pings;
    bool public shouldRevert;

    error Rejected();

    function ping() external {
        if (shouldRevert) revert Rejected();
        pings += 1;
    }

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }
}
