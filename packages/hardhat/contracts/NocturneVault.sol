// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { INocturneStrategy } from "./interfaces/INocturneStrategy.sol";
import { IHederaScheduleService } from "./interfaces/IHederaScheduleService.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";

/**
 * @title NocturneVault
 * @notice Holds a position and keeps itself running. It books its own next
 *         execution with the Hedera Schedule Service, asks a strategy what to do
 *         and how long to wait, and does it — with nobody watching.
 *
 * @dev The vault holds funds and decides nothing. The strategy decides
 *      everything and holds nothing. `plan` is reached by `staticcall`, so a
 *      strategy that tries to write state is stopped by the EVM rather than by
 *      a code review.
 *
 *      **The ordering inside `executeScheduled` is the whole design.** The
 *      successor is booked *first*, before the strategy is consulted, because
 *      a scheduled execution is the only chance to book the next one. If
 *      planning reverted and took the booking with it, the chain would end
 *      there — silently, with a transaction that reported success.
 *
 *      Four network behaviours shape this contract, each measured rather than
 *      assumed (`docs/hedera-landmines.md`):
 *
 *      1. `scheduleCall` costs ~1.4M gas on its own. A self-rescheduling entry
 *         point given 1M runs its work, fails to book a successor, and reports
 *         SUCCESS. `MIN_SCHEDULE_GAS` is a constant for that reason.
 *      2. A scheduled call observes `block.timestamp` roughly two seconds
 *         *behind* the second it was booked for. Anything that compares against
 *         a boundary has to tolerate that or it rejects its own wake-up call.
 *      3. Exactly one schedule may be booked per transaction.
 *      4. Expiry is refused beyond 62 days.
 */
contract NocturneVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Hedera system contracts
    // ------------------------------------------------------------------

    /// @dev Reached by raw call, never a typed one — see IHederaScheduleService.
    address internal constant HSS = address(0x16b);
    address internal constant HTS = address(0x167);

    int64 internal constant HSS_SUCCESS = 22;
    /// @dev Returned by `associateToken` for an address that is not an HTS token.
    int64 internal constant HTS_INVALID_TOKEN_ID = 167;

    // ------------------------------------------------------------------
    // Constants that exist because of something measured
    // ------------------------------------------------------------------

    /**
     * @notice Gas reserved for each scheduled execution.
     * @dev Deliberately a constant with no setter. `scheduleCall` alone costs
     *      about 1.4M gas, and a full self-rescheduling entry point measured
     *      1,511,731. Two contracts were run on testnet differing only in this
     *      number: the one given 1,000,000 fired once, reported SUCCESS, and
     *      never ran again; the one given 3,000,000 is still running.
     *
     *      Unused gas is refunded on Hedera, so headroom is nearly free. The
     *      only pressure against a larger reservation is that
     *      `hasScheduleCapacity` is likelier to refuse it.
     */
    uint256 public constant MIN_SCHEDULE_GAS = 3_000_000;

    /// @notice Floor on how often the vault will run.
    uint256 public constant MIN_INTERVAL = 60;

    /**
     * @notice Ceiling on how far ahead the vault will book.
     * @dev The network refuses expiry more than 5,356,800 seconds (62 days)
     *      ahead. 60 days leaves two days of margin.
     */
    uint256 public constant MAX_INTERVAL = 60 days;

    /**
     * @notice How early a wake-up call is still accepted.
     * @dev A scheduled call sees a `block.timestamp` about two seconds behind
     *      the second it was booked for. Without this tolerance the vault would
     *      look at its own scheduled execution, decide it had arrived too early,
     *      and decline to run — permanently, since declining also means not
     *      booking a successor. Ten seconds is five times the observed drift.
     *
     *      It is also the only window in which the vault can be made to run
     *      early by an uninvited caller, which bounds that nuisance to ten
     *      seconds per cycle regardless of the cadence.
     */
    uint256 public constant CLOCK_SKEW = 10;

    /// @notice Tinybar one scheduled execution was observed to *cost*.
    /// @dev 40.00 HBAR fell to 35.21 across three unattended runs: ~1.6 HBAR
    ///      each. Reported for context only — see `reservePerRun` and
    ///      `chargePerRun` for the figures the runway is actually built from.
    uint256 public constant TINYBAR_PER_RUN = 160_000_000;

    /**
     * @notice Gas one execution actually burns.
     * @dev Measured at ~1.43M across thirteen unattended runs on testnet, from
     *      a charge of 162,987,482 tinybar at 109 tinybar per gas. Rounded up,
     *      because overstating what a run costs understates the runway, and of
     *      the two errors that is the one that does no harm.
     *
     *      Kept separate from `MIN_SCHEDULE_GAS` because they answer different
     *      questions: that one is what a run must *reserve* before the network
     *      will accept it, this is what it is then *charged*. They differ by
     *      more than a factor of two, and conflating them is landmine 5.
     */
    uint256 public constant GAS_PER_RUN = 1_500_000;

    /**
     * @notice Gas price to assume when the EVM reports none, in tinybar per gas.
     * @dev Only reached on chains that leave `tx.gasprice` at zero. Hedera's
     *      relay substitutes the network price even for `eth_call`, measured at
     *      109 tinybar per gas on testnet in September 2026.
     */
    uint256 public constant FALLBACK_GAS_PRICE = 109;

    /// @notice Warn when fewer than this many runs remain in the balance.
    uint256 public constant FUEL_WARN_RUNS = 5;

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    INocturneStrategy public strategy;
    bytes public config;

    /// @notice The schedule entity booked for the next run, if one exists.
    address public nextSchedule;
    /// @notice The second the next run is expected. Survives a booking failure.
    uint64 public nextRunAt;
    uint64 public lastRunAt;
    uint64 public runCount;
    uint64 public refusalCount;
    bool public armed;

    /**
     * @notice Contracts a strategy is allowed to propose calls to.
     * @dev The strategy decides *what* to do; this decides what it may reach —
     *      down to the function, not just the address.
     *
     *      Per-address consent is not enough. Permitting a token so the strategy
     *      can `approve(router, amount)` would, on its own, also permit
     *      `transfer(attacker, balance)`: the grant a legitimate swap needs and
     *      the one that empties the vault are the same grant. Keying on the
     *      selector as well separates them.
     *
     *      The owner sets this, and a plan proposing any call outside it is
     *      rejected whole rather than part-executed.
     */
    mapping(address target => mapping(bytes4 selector => bool)) public allowedCall;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event StrategySet(address indexed strategy);
    event Configured(bytes config);
    event CallAllowed(address indexed target, bytes4 indexed selector, bool allowed);
    event Armed(uint256 firstRunAt, address schedule);
    event Disarmed();

    event Executed(uint64 indexed run, uint256 actions, uint256 nextAt);
    event Refused(uint64 indexed run, string reason, uint256 a, uint256 b);
    event PlanRejected(uint64 indexed run, address target);
    event ActionFailed(uint64 indexed run, uint256 index, address target, bytes reason);
    event PlanReverted(uint64 indexed run, bytes reason);

    event ScheduleBooked(address indexed schedule, uint256 at);
    event ScheduleFailed(int64 responseCode, uint256 at);
    event ScheduleReleaseFailed(address indexed schedule);
    event FuelLow(uint256 tinybarBalance, uint256 runsRemaining);

    event Associated(address indexed token, int64 responseCode);
    event HbarDeposited(address indexed from, uint256 tinybar);
    event HbarWithdrawn(address indexed to, uint256 tinybar);
    event TokenDeposited(address indexed token, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error NotConfigured();
    error InvalidConfig();
    error AlreadyArmed();
    error NotArmed();
    error InsufficientBalance();

    constructor(address strategy_, address owner_) Ownable(owner_) {
        if (strategy_ == address(0)) revert ZeroAddress();
        strategy = INocturneStrategy(strategy_);
        emit StrategySet(strategy_);
    }

    /// @dev Lets anyone top up the fuel, including the factory at creation.
    receive() external payable {
        emit HbarDeposited(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    /**
     * @notice Point the vault at a different strategy.
     * @dev Cancels any pending schedule, because a booked run would otherwise
     *      execute a plan from the strategy the owner just replaced.
     */
    function setStrategy(address strategy_) external onlyOwner {
        if (strategy_ == address(0)) revert ZeroAddress();
        _releaseSchedule();
        armed = false;
        strategy = INocturneStrategy(strategy_);
        delete config;
        emit StrategySet(strategy_);
    }

    /**
     * @notice Store the strategy's configuration.
     * @dev Validated here so a bad configuration fails in front of the person
     *      who wrote it, rather than inside a scheduled call at 3am.
     */
    function configure(bytes calldata config_) external onlyOwner {
        if (!strategy.validateConfig(config_)) revert InvalidConfig();
        _releaseSchedule();
        armed = false;
        config = config_;
        emit Configured(config_);
    }

    /**
     * @notice Permit or forbid one function on one contract.
     * @param target The contract a plan may call.
     * @param selector The four-byte function selector on it, e.g.
     *        `IERC20.approve.selector`. Allowing a contract without naming a
     *        function is deliberately not possible.
     */
    function setAllowedCall(address target, bytes4 selector, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedCall[target][selector] = allowed;
        emit CallAllowed(target, selector, allowed);
    }

    /**
     * @notice Associate an HTS token so the vault can hold it.
     * @dev Must happen before the first transfer in, or that transfer reverts.
     *      A response of 167 means the address is not an HTS token — a plain
     *      ERC-20 needs no association — so it is reported rather than treated
     *      as a failure.
     */
    function associate(address token) external onlyOwner returns (int64 responseCode) {
        if (token == address(0)) revert ZeroAddress();
        responseCode = IHederaTokenService(HTS).associateToken(address(this), token);
        emit Associated(token, responseCode);
    }

    // ------------------------------------------------------------------
    // Funds
    // ------------------------------------------------------------------

    /// @notice Add HBAR for the vault to pay for its own future executions.
    function depositHbar() external payable {
        if (msg.value == 0) revert ZeroAmount();
        emit HbarDeposited(msg.sender, msg.value);
    }

    function depositToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit TokenDeposited(token, amount);
    }

    /**
     * @notice Take HBAR back out.
     * @dev Available whether or not the vault is armed. A vault the owner cannot
     *      leave is not non-custodial, so this is never gated on state.
     * @param tinybar Amount in tinybar — the unit `address(this).balance` reports
     *        inside the Hedera EVM. JSON-RPC quotes weibar, which is 1e10 larger.
     */
    function withdrawHbar(uint256 tinybar) external onlyOwner nonReentrant {
        if (tinybar == 0) revert ZeroAmount();
        if (tinybar > address(this).balance) revert InsufficientBalance();
        address to = owner();
        (bool ok, ) = to.call{ value: tinybar }("");
        if (!ok) revert InsufficientBalance();
        emit HbarWithdrawn(to, tinybar);
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        address to = owner();
        IERC20(token).safeTransfer(to, amount);
        emit TokenWithdrawn(token, to, amount);
    }

    // ------------------------------------------------------------------
    // Arming
    // ------------------------------------------------------------------

    /**
     * @notice Book the first run and start the chain.
     * @dev Every run after this one books its own successor, so this is the only
     *      transaction the owner has to send.
     */
    function arm() external onlyOwner {
        if (armed) revert AlreadyArmed();
        if (config.length == 0) revert NotConfigured();

        armed = true;
        uint256 gap = _clampInterval(_askInterval());
        _bookNext(gap);
        emit Armed(nextRunAt, nextSchedule);
    }

    /**
     * @notice Stop the chain and release the pending schedule.
     * @dev Releasing the slot is a courtesy to the network. It must never be
     *      able to fail this call, or a network hiccup would trap an owner in an
     *      armed vault.
     */
    function disarm() external onlyOwner {
        if (!armed) revert NotArmed();
        armed = false;
        nextRunAt = 0;
        _releaseSchedule();
        emit Disarmed();
    }

    // ------------------------------------------------------------------
    // The run
    // ------------------------------------------------------------------

    /**
     * @notice One cycle. Called by the network when the booked schedule fires.
     *
     * @dev Permissionless by necessity — the call arrives from the Schedule
     *      Service and there is no caller to authenticate. That is tolerable
     *      because the function moves funds only along the strategy's plan, only
     *      to allow-listed targets, and only once per cycle.
     *
     *      **This function must not revert.** A revert takes the successor
     *      booking with it and ends the chain permanently. Every failure inside
     *      is therefore caught and emitted: a reverting strategy, a reverting
     *      action, a refused booking. The only paths that return early are ones
     *      where running would be wrong, and they leave the pending schedule
     *      intact.
     */
    function executeScheduled() external nonReentrant {
        // Not armed: a schedule from a previous life may still fire. Do nothing
        // and book nothing.
        if (!armed) return;

        // Too early. Tolerates the ~2s clock lag on a scheduled call, so the
        // vault never rejects its own wake-up. Returns rather than reverts so a
        // stray call cannot end the chain.
        if (block.timestamp + CLOCK_SKEW < nextRunAt) return;

        // Somebody other than the network woke us up.
        //
        // That is allowed — it is how a stalled chain gets revived — but it
        // leaves the already-booked schedule behind. Left alone that orphan
        // fires at its original second, finds the vault no longer due, returns
        // without doing anything, and the vault is charged a full execution for
        // it. Repeated once per cycle it halves the vault's life, which makes it
        // worth the one comparison below.
        //
        // A scheduled call arrives with `msg.sender` set to this contract: the
        // network runs it as though the vault called itself. Measured, not
        // assumed — see `contracts/test/ScheduledSenderProbe.sol`, which the
        // network fired with sender and origin both equal to the probe.
        if (msg.sender != address(this)) _releaseSchedule();

        uint64 run = ++runCount;
        lastRunAt = uint64(block.timestamp);

        // Book the successor before anything that can fail. One schedule per
        // transaction, and this is the one.
        uint256 gap = _clampInterval(_askInterval());
        _bookNext(gap);

        // Ask what to do. A strategy that reverts is a bug in the strategy, not
        // a reason to stop running.
        try strategy.plan(config) returns (INocturneStrategy.Action[] memory actions) {
            if (actions.length == 0) {
                refusalCount++;
                (string memory why, uint256 a, uint256 b) = _explain();
                emit Refused(run, why, a, b);
            } else if (!_callsAllowed(actions, run)) {
                // Rejected whole. A partly executed plan is worse than none:
                // an approve that lands without its swap leaves an allowance
                // sitting open.
                refusalCount++;
            } else {
                _execute(actions, run, gap);
            }
        } catch (bytes memory reason) {
            emit PlanReverted(run, reason);
        }

        // Say something before the fuel runs out rather than after.
        //
        // The number reported here is deliberately pessimistic, and cannot be
        // made otherwise. Inside a scheduled call the balance has already had
        // the *whole* gas allowance debited; the unused part is refunded only
        // once this returns. A vault funded with exactly 4 HBAR read itself as
        // 0.73 at this line — 4.00 minus the 3.27 reserve, to the tinybar — and
        // settled at 2.2245 a moment later, having been charged 1.7755.
        //
        // So this warns about a run earlier than strictly necessary, which is
        // the right direction. What matters is that nothing in this contract
        // *acts* on it: `_bookNext` has already run, unconditionally, above.
        // A vault that looks broke here still books its successor and lets the
        // network decide whether it can pay.
        uint256 left = _runway();
        if (left <= FUEL_WARN_RUNS) emit FuelLow(address(this).balance, left);
    }

    function _execute(INocturneStrategy.Action[] memory actions, uint64 run, uint256 gap) private {
        for (uint256 i; i < actions.length; ++i) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok, bytes memory ret) = actions[i].target.call{ value: actions[i].value }(actions[i].data);
            if (!ok) {
                // Stop at the first failure. The rest of the plan assumed this
                // step landed.
                emit ActionFailed(run, i, actions[i].target, ret);
                return;
            }
        }
        emit Executed(run, actions.length, block.timestamp + gap);
    }

    /**
     * @dev Bounds a plan by what it calls, not only where.
     *
     *      Allowing an address alone is not enough, and the gap is not
     *      theoretical. A vault that wants its strategy to run
     *      `approve(router, amount)` must permit calls to the token. If that
     *      permission covers every function on the token, it equally covers
     *      `transfer(attacker, balance)` — the grant a legitimate swap needs is
     *      then indistinguishable from the one that empties the vault.
     *
     *      So consent is recorded per `(target, selector)`. The owner allows the
     *      exact functions a strategy is supposed to call, and a plan proposing
     *      anything else is rejected whole.
     *
     *      An action with fewer than four bytes of calldata is refused outright.
     *      There is no function for the owner to have consented to, and it is
     *      also the plainest way to move HBAR out of a vault.
     */
    function _callsAllowed(INocturneStrategy.Action[] memory actions, uint64 run) private returns (bool) {
        for (uint256 i; i < actions.length; ++i) {
            bytes memory data = actions[i].data;
            if (data.length < 4) {
                emit PlanRejected(run, actions[i].target);
                return false;
            }

            bytes4 selector = bytes4(data[0]) |
                (bytes4(data[1]) >> 8) |
                (bytes4(data[2]) >> 16) |
                (bytes4(data[3]) >> 24);

            if (!allowedCall[actions[i].target][selector]) {
                emit PlanRejected(run, actions[i].target);
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------------------
    // Scheduling
    // ------------------------------------------------------------------

    /**
     * @dev Ask the strategy how long to wait, tolerating a strategy that reverts.
     *      A strategy having a bad day should slow the vault down, not stop it.
     */
    function _askInterval() private view returns (uint256) {
        try strategy.nextInterval(config) returns (uint256 s) {
            return s;
        } catch {
            return MAX_INTERVAL;
        }
    }

    function _clampInterval(uint256 s) private pure returns (uint256) {
        if (s < MIN_INTERVAL) return MIN_INTERVAL;
        if (s > MAX_INTERVAL) return MAX_INTERVAL;
        return s;
    }

    /**
     * @dev Book the next run.
     *
     *      `nextRunAt` is set whether or not the booking succeeds. If the
     *      network refuses capacity, the vault still knows when it *should* run,
     *      so anybody may call `executeScheduled` at that time and the chain
     *      picks itself back up. One poke revives it, because that run books its
     *      own successor.
     *
     *      Raw calls throughout: the Schedule Service has no EVM bytecode, and
     *      `scheduleCall` signals failure with a response code rather than a
     *      revert, so both the call and its return value have to be checked by
     *      hand.
     */
    function _bookNext(uint256 gap) private {
        uint256 at = block.timestamp + gap;
        nextRunAt = uint64(at);
        nextSchedule = address(0);

        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, bytes memory data) = HSS.staticcall(
            abi.encodeWithSelector(IHederaScheduleService.hasScheduleCapacity.selector, at, MIN_SCHEDULE_GAS)
        );
        if (!ok || data.length < 32 || !abi.decode(data, (bool))) {
            emit ScheduleFailed(0, at);
            return;
        }

        // solhint-disable-next-line avoid-low-level-calls
        (ok, data) = HSS.call(
            abi.encodeWithSelector(
                IHederaScheduleService.scheduleCall.selector,
                address(this),
                at,
                MIN_SCHEDULE_GAS,
                uint64(0),
                abi.encodeCall(this.executeScheduled, ())
            )
        );
        if (!ok || data.length < 64) {
            emit ScheduleFailed(0, at);
            return;
        }

        (int64 rc, address schedule) = abi.decode(data, (int64, address));
        if (rc != HSS_SUCCESS || schedule == address(0)) {
            emit ScheduleFailed(rc, at);
            return;
        }

        nextSchedule = schedule;
        emit ScheduleBooked(schedule, at);
    }

    /// @dev Best effort. Reported when it fails, never enforced.
    function _releaseSchedule() private {
        address schedule = nextSchedule;
        if (schedule == address(0)) return;
        nextSchedule = address(0);

        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, bytes memory data) = HSS.call(
            abi.encodeWithSelector(IHederaScheduleService.deleteSchedule.selector, schedule)
        );
        if (!ok || data.length < 32 || abi.decode(data, (int64)) != HSS_SUCCESS) {
            emit ScheduleReleaseFailed(schedule);
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Executions the current balance can still pay for.
    function runway() external view returns (uint256) {
        return _runway();
    }

    /**
     * @notice Balance a vault must hold for its next execution to be accepted.
     *
     * @dev Not what a run costs. What it reserves.
     *
     *      The network takes the payer's ability to cover the *whole* gas
     *      allowance as a precondition, then charges only for the gas actually
     *      burned. Those two numbers are far apart here: a run burns about 1.43M
     *      gas and reserves `MIN_SCHEDULE_GAS`, which is 3M. Funding a vault
     *      against the cost rather than the reserve is how it dies with money
     *      still in it.
     *
     *      That is not a hypothetical. The first long-running demo vault stopped
     *      holding 2.7628 HBAR, having been charged 1.6299 HBAR for each of its
     *      thirteen runs. It had over one run's worth of cost left, and the
     *      fourteenth failed anyway — `INSUFFICIENT_PAYER_BALANCE`, because the
     *      reserve at the time was 3M x 109 = 3.27 HBAR.
     *
     *      `tx.gasprice` is the right source for the price and needs no
     *      conversion: inside the EVM it is quoted in tinybar per gas, the same
     *      unit as `address(this).balance`. The relay substitutes the network's
     *      price even during `eth_call`, so a UI reading this gets a live figure
     *      rather than a stale constant. On chains that leave it at zero, the
     *      fallback keeps the division safe.
     */
    function reservePerRun() public view returns (uint256) {
        return MIN_SCHEDULE_GAS * _gasPrice();
    }

    /// @notice Tinybar a run is actually charged, at the current gas price.
    /// @dev The companion to `reservePerRun`. A run has to hold the reserve to
    ///      be accepted and is then charged this, which is less than half of it.
    function chargePerRun() public view returns (uint256) {
        return GAS_PER_RUN * _gasPrice();
    }

    /// @dev Tinybar per gas. Hedera's relay reports the network price even for
    ///      `eth_call`; the fallback is for chains that leave it at zero.
    function _gasPrice() private view returns (uint256) {
        return tx.gasprice == 0 ? FALLBACK_GAS_PRICE : tx.gasprice;
    }

    /// @notice HBAR held, in tinybar. Compare against `reservePerRun`.
    function fuel() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Everything the UI needs in one call.
    function status()
        external
        view
        returns (bool armed_, uint64 runs, uint64 refusals, uint64 nextAt, uint256 runsRemaining)
    {
        return (armed, runCount, refusalCount, nextRunAt, _runway());
    }

    /// @notice What the strategy would say right now, without running anything.
    function preview() external view returns (string memory state, uint256 a, uint256 b) {
        return strategy.explain(config);
    }

    /**
     * @dev Executions this balance will actually see.
     *
     *      Two different numbers govern it, which is why this is not a single
     *      division. A run only happens if the balance covers the whole gas
     *      allowance — `reservePerRun` — but what it then takes out of the
     *      balance is only `chargePerRun`, under half as much. So the reserve is
     *      a threshold crossed once and the charge is what erodes the balance
     *      toward it:
     *
     *          runs = 0                                  if balance < reserve
     *          runs = (balance - reserve) / charge + 1    otherwise
     *
     *      Dividing by the reserve alone would be safe but pessimistic, and
     *      dividing by the charge alone is the mistake that let a vault holding
     *      2.76 HBAR believe it had a run left when the network had already
     *      stopped accepting it.
     */
    function _runway() private view returns (uint256) {
        uint256 balance = address(this).balance;
        uint256 reserve = reservePerRun();
        if (balance < reserve) return 0;
        return (balance - reserve) / chargePerRun() + 1;
    }

    function _explain() private view returns (string memory, uint256, uint256) {
        try strategy.explain(config) returns (string memory s, uint256 a, uint256 b) {
            return (s, a, b);
        } catch {
            return ("unknown", 0, 0);
        }
    }
}
