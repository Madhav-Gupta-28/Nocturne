// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Stands in for the HTS precompile at 0x167, for `associate` only.
 * @dev Installed with `hardhat_setCode`, which copies code but not storage, so
 *      the default answer cannot live in a variable initialised at deploy. An
 *      unset override means SUCCESS (22).
 */
contract MockTokenService {
    int64 private constant SUCCESS = 22;

    int64 private _override;
    address public lastAccount;
    address public lastToken;

    /// @notice Answer every association with `rc` from now on. Zero restores 22.
    function setResponse(int64 rc) external {
        _override = rc;
    }

    function associateToken(address account, address token) external returns (int64) {
        lastAccount = account;
        lastToken = token;
        return _override == 0 ? SUCCESS : _override;
    }
}
