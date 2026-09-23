// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Heartbeat
 * @notice Counts how many times something has called it, and when.
 *
 * @dev The smallest thing a vault can usefully do, and the clearest possible
 *      evidence that it did it by itself.
 *
 *      Read `beats` on a deployed Heartbeat, then look at the vault's account on
 *      a mirror node. The counter has moved and there is no transaction from the
 *      owner behind any of the increments — the network sent them. That is the
 *      claim this whole project makes, in a form anyone can check in one request
 *      without trusting a word of the README.
 *
 *      Deliberately permissionless. A heartbeat that only its own vault could
 *      call would need access control, and access control is exactly the sort of
 *      thing that makes a demo fail for a stranger.
 */
contract Heartbeat {
    /// @notice Total calls received.
    uint256 public beats;
    /// @notice Timestamp of the most recent one.
    uint256 public lastBeatAt;
    /// @notice Who sent the most recent one. A vault, if all is well.
    address public lastBeatBy;

    event Beat(uint256 indexed beat, address indexed by, uint256 at);

    function beat() external {
        beats += 1;
        lastBeatAt = block.timestamp;
        lastBeatBy = msg.sender;
        emit Beat(beats, msg.sender, block.timestamp);
    }

    /// @notice Seconds since the last beat, or zero if there has never been one.
    /// @dev Useful for spotting a chain that has quietly stopped: a silence
    ///      much longer than the configured interval means something broke.
    function silenceFor() external view returns (uint256) {
        if (lastBeatAt == 0) return 0;
        return block.timestamp - lastBeatAt;
    }
}
