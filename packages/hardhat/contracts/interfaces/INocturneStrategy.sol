// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title INocturneStrategy
 * @notice What a vault should do next, and when it should look again.
 *
 * @dev A strategy is a pure planner. It reads prices, returns an ordered list of
 *      calls for the vault to make, and says how long to wait before asking
 *      again. It never receives tokens, never holds an allowance, and cannot
 *      write state — `NocturneVault` reaches it through `staticcall`, so a
 *      strategy that tries is rejected by the EVM rather than by a code review.
 *
 *      **`nextInterval` is the whole point of this interface.**
 *
 *      Hedera's own `ScheduledVault` (in the built-in `payments-scheduler`
 *      template) has a fixed `intervalSeconds`, and its strategy interface
 *      returns actions and nothing else. That makes Hedera's own stated use
 *      case — "as positions approach liquidation thresholds, contracts schedule
 *      increasingly frequent monitoring" — impossible to express: the strategy
 *      is the only party that knows how close the position is, and it has no
 *      way to say so.
 *
 *      Moving the interval onto the strategy is the smallest change that fixes
 *      that. The vault keeps custody and clamps the answer to a sane range; the
 *      strategy keeps the judgement and holds nothing.
 *
 *      It is not decoration. At roughly 1.6 HBAR per scheduled execution
 *      (measured, see `docs/hedera-landmines.md`), a fixed hourly cadence costs
 *      about 38 HBAR a day whether or not anything is happening, and a fixed
 *      daily cadence can sleep through the event it exists to catch. Only the
 *      strategy can tell which of those is currently wrong.
 */
interface INocturneStrategy {
    /**
     * @notice One call for the vault to make, on its own behalf.
     * @param target Contract to call.
     * @param value HBAR to attach, in tinybar. Note tinybar, not wei: inside
     *        the Hedera EVM `address(this).balance` and `msg.value` are 8-decimal
     *        tinybar, while JSON-RPC reports 18-decimal weibar. They differ by
     *        exactly 1e10 and confusing them is a silent overspend.
     * @param data ABI-encoded calldata.
     */
    struct Action {
        address target;
        uint256 value;
        bytes data;
    }

    /**
     * @notice The calls the vault should make right now.
     * @dev MUST be `view`; the vault `staticcall`s it.
     *
     *      An empty array is a decision, not an error. It is how a strategy says
     *      "nothing to do" — the position is healthy, the trade is too small to
     *      be worth its cost, or the price sources disagree and acting would be
     *      dangerous. The vault records that as a refusal and asks again sooner.
     *
     *      A strategy SHOULD NOT revert merely because the market is
     *      unfavourable. Reverting is for malformed configuration and broken
     *      assumptions; declining is for everything else.
     * @param config ABI-encoded, strategy-specific configuration.
     */
    function plan(bytes calldata config) external view returns (Action[] memory actions);

    /**
     * @notice Seconds to wait before running again.
     * @dev Returned even when `plan` is empty — especially then, because a
     *      refusal usually means "look again sooner", not "give up".
     *
     *      The vault clamps this into [MIN_INTERVAL, MAX_INTERVAL]. A strategy
     *      does not need to know those bounds and should return what it actually
     *      wants; asking for one second or for a year is not an error, it is
     *      just an opinion the vault will moderate.
     */
    function nextInterval(bytes calldata config) external view returns (uint256 seconds_);

    /**
     * @notice Whether `config` is well-formed for this strategy.
     * @dev Called by the vault at configure time so a bad configuration fails
     *      in front of the person who wrote it, rather than at 3am inside a
     *      scheduled call nobody is watching.
     */
    function validateConfig(bytes calldata config) external view returns (bool);

    /**
     * @notice Why the strategy would decide what it is about to decide.
     * @dev Presentation only. Never consumed on-chain for control flow; the
     *      vault emits it so the UI and the event log can say "holding, 12.4%
     *      above floor" or "refused, sources 21.7x apart" instead of leaving a
     *      user to guess from an empty action list.
     * @return state Short machine-ish label, e.g. "holding", "refused", "exit".
     * @return a First supporting number, meaning depends on `state`.
     * @return b Second supporting number.
     */
    function explain(bytes calldata config) external view returns (string memory state, uint256 a, uint256 b);
}
