// SPDX-License-Identifier: MIT
// Vendored from Hedera's Scaffold-HBAR `payments-scheduler` template, unmodified
// except for the pragma, so the comparison tests run it
// against the same mock Schedule Service as NocturneVault. Test fixture only:
// never deployed.
//
//   https://github.com/hedera-dev/scaffold-hbar/blob/5bda7868322a2c7aab8cb681df01c756840bb464/packages/foundry/contracts/interfaces/IExecutionStrategy.sol
//   MIT License, Copyright (c) 2023 BuidlGuidl
//

pragma solidity ^0.8.24;

/**
 * @title IExecutionStrategy
 * @notice Plugin interface for ScheduledVault execution strategies.
 *         Strategies are pure planners: they return a list of low-level calls
 *         that the vault executes as msg.sender, keeping full fund custody.
 */
interface IExecutionStrategy {
    struct Action {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice Compute the ordered list of calls the vault should execute.
    /// @param config ABI-encoded strategy-specific configuration
    /// @return actions Ordered array of calls for the vault to execute
    function plan(bytes calldata config) external view returns (Action[] memory actions);

    /// @notice Check whether `config` is well-formed for this strategy.
    /// @param config ABI-encoded strategy-specific configuration
    function validateConfig(bytes calldata config) external view returns (bool);
}
