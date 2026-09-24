// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHederaScheduleService } from "../interfaces/IHederaScheduleService.sol";

/**
 * @title ScheduledSenderProbe
 * @notice Records who `msg.sender` is when the network fires a scheduled call.
 *
 * @dev Written to settle one question that decides a real design choice.
 *
 *      `NocturneVault.executeScheduled` is permissionless, because the call
 *      arrives from the Schedule Service and there is nobody to authenticate.
 *      That leaves a griefing window: an uninvited caller can trigger a run up
 *      to `CLOCK_SKEW` seconds early, which advances `nextRunAt` and orphans the
 *      schedule already booked. The orphan still fires, finds the vault not due,
 *      does nothing — and the vault pays the execution fee anyway.
 *
 *      The fix is to release the pending schedule when the call did not come
 *      from it. Doing that needs a way to tell the two apart, and the obvious
 *      candidate is `msg.sender`. Guessing would be worse than not fixing it: if
 *      a scheduled call arrives with some sender the contract does not expect,
 *      the vault would delete the schedule that is currently running on every
 *      legitimate cycle.
 *
 *      So this measures it. `book` schedules a call to `record`, and `record`
 *      stores the sender the network used.
 *
 *      Not part of the system. Kept because the answer is load bearing.
 */
contract ScheduledSenderProbe {
    IHederaScheduleService internal constant HSS = IHederaScheduleService(address(0x16b));

    /// @dev `scheduleCall` reports success with 22, and never reverts.
    int64 internal constant HSS_SUCCESS = 22;

    uint256 internal constant SCHEDULE_GAS = 3_000_000;

    /// @notice `msg.sender` as the network delivered it. Zero until it fires.
    address public lastSender;

    /// @notice This contract's own address, for comparison without an ABI call.
    address public immutable self;

    /// @notice `block.timestamp` inside the scheduled call.
    uint256 public firedAt;

    /// @notice The second the call was booked for, to measure the clock lag.
    uint256 public bookedFor;

    /// @notice `tx.origin` as delivered, which may differ from the sender.
    address public lastOrigin;

    address public schedule;
    int64 public lastResponseCode;

    event Booked(address indexed schedule, int64 responseCode, uint256 at);
    event Fired(address sender, address origin, uint256 firedAt, uint256 bookedFor);

    constructor() {
        self = address(this);
    }

    /// @notice Book a call to `record` `delay` seconds from now.
    function book(uint256 delay) external {
        uint256 at = block.timestamp + delay;
        bookedFor = at;

        (bool ok, bytes memory data) = address(HSS).call(
            abi.encodeWithSelector(
                IHederaScheduleService.scheduleCall.selector,
                address(this),
                at,
                SCHEDULE_GAS,
                uint64(0),
                abi.encodeCall(this.record, ())
            )
        );
        require(ok && data.length >= 64, "schedule call failed");

        (int64 rc, address created) = abi.decode(data, (int64, address));
        lastResponseCode = rc;
        schedule = created;
        require(rc == HSS_SUCCESS, "schedule refused");
        emit Booked(created, rc, at);
    }

    /// @notice The scheduled entry point. Records, nothing else.
    function record() external {
        lastSender = msg.sender;
        lastOrigin = tx.origin;
        firedAt = block.timestamp;
        emit Fired(msg.sender, tx.origin, block.timestamp, bookedFor);
    }

    receive() external payable {}
}
