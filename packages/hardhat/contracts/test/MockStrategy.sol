// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { INocturneStrategy } from "../interfaces/INocturneStrategy.sol";

/**
 * @title MockStrategy
 * @notice A strategy a test can point in any direction, including directly at
 *         the vault's throat.
 *
 * @dev Real strategies decide things. This one is told what to decide, so the
 *      vault can be tested against every shape of strategy behaviour that
 *      matters: a normal plan, an empty plan, a plan aimed somewhere it should
 *      not be allowed to aim, a reverting `plan`, a reverting `nextInterval`,
 *      and an interval outside the vault's bounds.
 */
contract MockStrategy is INocturneStrategy {
    INocturneStrategy.Action[] internal _actions;

    uint256 public interval = 3600;
    bool public planReverts;
    bool public intervalReverts;
    bool public configValid = true;
    bool public explainReverts;

    string public state = "holding";
    uint256 public a = 1;
    uint256 public b = 2;

    error PlanFailed();
    error IntervalFailed();
    error ExplainFailed();

    // ---- what the vault reads ----

    function plan(bytes calldata) external view override returns (INocturneStrategy.Action[] memory) {
        if (planReverts) revert PlanFailed();
        return _actions;
    }

    function nextInterval(bytes calldata) external view override returns (uint256) {
        if (intervalReverts) revert IntervalFailed();
        return interval;
    }

    function validateConfig(bytes calldata) external view override returns (bool) {
        return configValid;
    }

    function explain(bytes calldata) external view override returns (string memory, uint256, uint256) {
        if (explainReverts) revert ExplainFailed();
        return (state, a, b);
    }

    // ---- what a test sets ----

    function setActions(INocturneStrategy.Action[] calldata actions) external {
        delete _actions;
        for (uint256 i; i < actions.length; ++i) {
            _actions.push(actions[i]);
        }
    }

    function clearActions() external {
        delete _actions;
    }

    function setInterval(uint256 v) external {
        interval = v;
    }

    function setPlanReverts(bool v) external {
        planReverts = v;
    }

    function setIntervalReverts(bool v) external {
        intervalReverts = v;
    }

    function setConfigValid(bool v) external {
        configValid = v;
    }

    function setExplainReverts(bool v) external {
        explainReverts = v;
    }

    function setExplanation(string calldata s, uint256 a_, uint256 b_) external {
        state = s;
        a = a_;
        b = b_;
    }

    function actionCount() external view returns (uint256) {
        return _actions.length;
    }
}

/**
 * @notice A strategy whose `plan` tries to write storage.
 * @dev The interface says `plan` is `view`, and `NocturneVault` reaches it with
 *      `staticcall`. This contract declares `plan` as non-view and mutates, so
 *      the vault's call must fail at the EVM level rather than on trust. If this
 *      ever succeeds, the separation the whole design rests on is gone.
 *
 *      It cannot inherit INocturneStrategy, because Solidity will not let a
 *      non-view function override a view one — which is the point.
 */
contract StateWritingStrategy {
    uint256 public writes;

    function plan(bytes calldata) external returns (INocturneStrategy.Action[] memory actions) {
        writes += 1;
        actions = new INocturneStrategy.Action[](0);
    }

    function nextInterval(bytes calldata) external pure returns (uint256) {
        return 3600;
    }

    function validateConfig(bytes calldata) external pure returns (bool) {
        return true;
    }

    function explain(bytes calldata) external pure returns (string memory, uint256, uint256) {
        return ("writing", 0, 0);
    }
}
