// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IHederaScheduleService
 * @notice The HIP-1215 surface of the Hedera Schedule Service, declared locally
 *         so this template does not pin a third-party system-contract package.
 *
 * @dev Three things about this interface are easy to get wrong, and each of them
 *      has cost somebody a production incident.
 *
 *      **1. `scheduleCall` never reverts.** On failure it returns a zero
 *      `scheduleAddress` and a non-22 response code. Code that ignores the
 *      return value believes it has scheduled something that does not exist,
 *      and the failure is invisible until the job silently never runs.
 *
 *      **2. The service has no EVM bytecode.** `eth_getCode(0x16b)` answers
 *      `0x`. Solidity emits an `extcodesize` check before a high-level call to
 *      any address, and skips it only when the call is expected to return data
 *      (>= 0.8.10). Every function here returns data, so a typed call happens to
 *      work — but `NocturneVault` reaches the service through raw `call` and
 *      `staticcall` anyway. That keeps the same bytecode deployable on a chain
 *      with nothing at `0x16b`, where it degrades to "scheduling unavailable"
 *      instead of reverting in a frame `try/catch` cannot see.
 *
 *      **3. Exactly one schedule may be booked per transaction.** A second
 *      booking in the same transaction is rejected with
 *      `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION`, and that rejection
 *      fails the whole transaction rather than just the booking. A scheduled
 *      execution may book one successor, which is what makes an unattended
 *      chain possible at all.
 *
 *      Measured limits on testnet and mainnet, current as of 2026-09-23:
 *
 *      - expiry may be at most **5,356,800 seconds (62 days)** ahead;
 *        `hasScheduleCapacity` answers true at 62 days and false at 63
 *      - a scheduled call observes a `block.timestamp` that runs roughly
 *        **two seconds behind** the second it was booked for, so any deadline
 *        comparison must be scheduled past the boundary rather than at it
 *      - `scheduleCall` costs roughly **1.4M gas on its own**
 *
 *      See `docs/hedera-landmines.md` for how each of those was measured and
 *      the commands to re-check them.
 */
interface IHederaScheduleService {
    /**
     * @notice Book a future call, paid for by the calling contract.
     * @param to The contract to call when the schedule fires.
     * @param expirySecond Unix second at which the network should execute.
     * @param gasLimit Gas made available to the scheduled call. Unused gas is
     *        refunded, so headroom is close to free; the only pressure against a
     *        larger reservation is that `hasScheduleCapacity` is likelier to
     *        refuse it.
     * @param value HBAR to send with the scheduled call, in tinybar.
     * @param callData ABI-encoded call.
     * @return responseCode 22 on success. Anything else means no schedule was
     *         created. This function does not revert.
     * @return scheduleAddress Address of the created schedule entity, or the
     *         zero address on failure.
     */
    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);

    /**
     * @notice Book a future call paid for by someone other than the caller.
     * @dev The schedule only executes once the payer's key has signed for it.
     *      Nocturne does not use this — a vault pays for its own future gas, so
     *      its liveness depends on nobody but itself — but it is part of the
     *      surface and a fork may want it.
     */
    function scheduleCallWithPayer(
        address to,
        address payer,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);

    /**
     * @notice Whether the network can accept a schedule of this size at this second.
     * @dev Cheap enough to call before every booking, and worth it: the
     *      guarantee is that when this returns true, a matching `scheduleCall`
     *      will also succeed. Also the cheapest way to discover the 62-day
     *      ceiling, since it answers false beyond it rather than failing later.
     */
    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool);

    /**
     * @notice Release a schedule that has not yet fired.
     * @dev Returns a response code rather than reverting. Releasing a slot is a
     *      courtesy to the network, so a caller should report a failure here
     *      rather than let it block anything a user asked for.
     */
    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode);
}
