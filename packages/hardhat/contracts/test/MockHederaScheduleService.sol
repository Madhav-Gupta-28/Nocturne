// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockHederaScheduleService
 * @notice A stand-in for the Hedera Schedule Service, for tests on a network
 *         that has no such service.
 *
 * @dev Deployed in tests and then written to address `0x16b` with
 *      `hardhat_setCode`, so the vault exercises exactly the code path it will
 *      run in production rather than a test-only branch.
 *
 *      The mock reproduces the behaviour that matters, including the parts that
 *      are easy to forget:
 *
 *      - **It never reverts.** Real `scheduleCall` signals failure through the
 *        response code, so a mock that reverts would let a vault pass tests it
 *        would fail on chain.
 *      - **It enforces the 62-day ceiling**, refusing capacity beyond
 *        `MAX_EXPIRY_AHEAD` the way the network does.
 *      - **It enforces one schedule per transaction.** The real network rejects
 *        a second booking outright; this returns `RECURSION_BLOCKED` so a test
 *        can assert the vault never tries.
 *      - **It can be told to fail**, so the vault's handling of a refusal is
 *        testable without contriving network conditions.
 *
 *      What it deliberately does *not* do is execute anything by itself. A test
 *      fires a schedule by calling `fire()`, which is the mock standing in for
 *      the consensus nodes. Time travel is the test's job, not the mock's.
 */
contract MockHederaScheduleService {
    int64 internal constant SUCCESS = 22;
    int64 internal constant CAPACITY_REFUSED = -1;
    int64 internal constant RECURSION_BLOCKED = -2;

    /// @notice Matches the network: 5,356,800 seconds. Measured, not assumed.
    uint256 public constant MAX_EXPIRY_AHEAD = 62 days;

    struct Schedule {
        address to;
        uint256 expirySecond;
        uint256 gasLimit;
        uint64 value;
        bytes callData;
        bool executed;
        bool deleted;
    }

    Schedule[] internal _schedules;

    /// @notice Set by a test to make the next booking fail.
    bool public refuseNextBooking;
    /// @notice Set by a test to make `hasScheduleCapacity` answer false.
    bool public refuseCapacity;
    /// @notice Set by a test to make `deleteSchedule` fail, so a schedule can
    ///         outlive the disarm that tried to release it.
    bool public refuseDelete;

    /// @dev Bookings made in the current transaction, so the one-per-transaction
    ///      rule can be enforced the way the network enforces it.
    uint256 internal _bookedInTx;
    uint256 internal _lastTxMarker;

    event Scheduled(address indexed schedule, address to, uint256 expirySecond, uint256 gasLimit);
    event Fired(address indexed schedule, bool success, bytes returnData);

    // ------------------------------------------------------------------
    // The interface under test
    // ------------------------------------------------------------------

    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress) {
        if (refuseNextBooking) {
            refuseNextBooking = false;
            return (CAPACITY_REFUSED, address(0));
        }
        if (_bookingsThisTx() >= 1) {
            // NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION, in spirit.
            return (RECURSION_BLOCKED, address(0));
        }
        if (expirySecond > block.timestamp + MAX_EXPIRY_AHEAD) {
            return (CAPACITY_REFUSED, address(0));
        }

        _schedules.push(
            Schedule({
                to: to,
                expirySecond: expirySecond,
                gasLimit: gasLimit,
                value: value,
                callData: callData,
                executed: false,
                deleted: false
            })
        );
        _bookedInTx += 1;

        scheduleAddress = _addressOf(_schedules.length - 1);
        emit Scheduled(scheduleAddress, to, expirySecond, gasLimit);
        return (SUCCESS, scheduleAddress);
    }

    function scheduleCallWithPayer(
        address to,
        address,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64, address) {
        return this.scheduleCall(to, expirySecond, gasLimit, value, callData);
    }

    function hasScheduleCapacity(uint256 expirySecond, uint256) external view returns (bool) {
        if (refuseCapacity) return false;
        return expirySecond <= block.timestamp + MAX_EXPIRY_AHEAD;
    }

    function deleteSchedule(address scheduleAddress) external returns (int64) {
        if (refuseDelete) return CAPACITY_REFUSED;
        uint256 i = _indexOf(scheduleAddress);
        if (i == type(uint256).max) return CAPACITY_REFUSED;
        if (_schedules[i].executed) return CAPACITY_REFUSED;
        _schedules[i].deleted = true;
        return SUCCESS;
    }

    // ------------------------------------------------------------------
    // Test controls — the consensus nodes, played by the test
    // ------------------------------------------------------------------

    /// @notice Execute a booked schedule, as the network would.
    /// @dev Deliberately does not check `block.timestamp` against the expiry:
    ///      a test that wants to assert timing does its own warping, and one
    ///      that does not should not have to.
    function fire(address scheduleAddress) external returns (bool success, bytes memory ret) {
        uint256 i = _indexOf(scheduleAddress);
        require(i != type(uint256).max, "mock: unknown schedule");
        Schedule storage s = _schedules[i];
        require(!s.executed, "mock: already executed");
        require(!s.deleted, "mock: deleted");
        s.executed = true;

        _newTransaction();
        (success, ret) = s.to.call{ gas: s.gasLimit, value: s.value }(s.callData);
        emit Fired(scheduleAddress, success, ret);
    }

    /// @notice Fire the most recently booked schedule that is still pending.
    function fireLatest() external returns (bool success, bytes memory ret) {
        for (uint256 i = _schedules.length; i > 0; --i) {
            Schedule storage s = _schedules[i - 1];
            if (!s.executed && !s.deleted) {
                return this.fire(_addressOf(i - 1));
            }
        }
        revert("mock: nothing pending");
    }

    function setRefuseNextBooking(bool v) external {
        refuseNextBooking = v;
    }

    function setRefuseCapacity(bool v) external {
        refuseCapacity = v;
    }

    function setRefuseDelete(bool v) external {
        refuseDelete = v;
    }

    /// @notice Wipe every schedule and flag.
    /// @dev Needed because `hardhat_setCode` installs bytecode without touching
    ///      storage, so a mock written to a fixed address inherits whatever the
    ///      previous suite left at that address. Every test file installs this
    ///      mock at 0x16b, so without an explicit reset the fourth suite starts
    ///      out holding the third suite's pending schedules.
    function reset() external {
        delete _schedules;
        refuseNextBooking = false;
        refuseCapacity = false;
        refuseDelete = false;
        _bookedInTx = 0;
        _lastTxMarker = 0;
    }

    /// @notice Start a fresh transaction window for the one-per-transaction rule.
    /// @dev Tests that book twice on purpose call this between bookings.
    function newTransaction() external {
        _newTransaction();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function scheduleCount() external view returns (uint256) {
        return _schedules.length;
    }

    function pendingCount() external view returns (uint256 n) {
        for (uint256 i; i < _schedules.length; ++i) {
            if (!_schedules[i].executed && !_schedules[i].deleted) n++;
        }
    }

    function scheduleAt(uint256 i) external view returns (Schedule memory) {
        return _schedules[i];
    }

    function addressOf(uint256 i) external pure returns (address) {
        return _addressOf(i);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Schedules on Hedera are entities with low-numbered addresses. Anything
    ///      deterministic and non-zero works here; this keeps them recognisable
    ///      in a trace.
    function _addressOf(uint256 i) internal pure returns (address) {
        return address(uint160(0xA20000 + i));
    }

    function _indexOf(address scheduleAddress) internal view returns (uint256) {
        for (uint256 i; i < _schedules.length; ++i) {
            if (_addressOf(i) == scheduleAddress) return i;
        }
        return type(uint256).max;
    }

    /// @dev `block.number` is the closest thing to a transaction boundary the EVM
    ///      exposes to a contract. Hardhat mines a block per transaction by
    ///      default, so this tracks "one booking per transaction" accurately for
    ///      tests, and `newTransaction()` exists for the cases where it does not.
    function _bookingsThisTx() internal returns (uint256) {
        if (_lastTxMarker != block.number) {
            _lastTxMarker = block.number;
            _bookedInTx = 0;
        }
        return _bookedInTx;
    }

    function _newTransaction() internal {
        _lastTxMarker = block.number;
        _bookedInTx = 0;
    }
}
