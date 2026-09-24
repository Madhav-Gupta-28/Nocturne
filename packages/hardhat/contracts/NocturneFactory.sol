// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { NocturneVault } from "./NocturneVault.sol";

/**
 * @title NocturneFactory
 * @notice Deploys a vault per owner, per strategy.
 *
 * @dev **Every vault is a real deployment. None of them is a proxy, and that is
 *      not a stylistic preference.**
 *
 *      The obvious way to hand every user their own vault is EIP-1167: deploy
 *      the logic once and give everyone a 45-byte clone. Clones work by
 *      `DELEGATECALL`, and on Hedera a schedule booked from inside a delegatecall
 *      frame is created with a `delegatable_contract_id` admin key rather than a
 *      plain `contractID` key. The key is accepted at creation and then not
 *      handled by the payer-signature check at execution, so the schedule fires
 *      on time and immediately fails `INVALID_PAYER_SIGNATURE`, producing no
 *      contract result at all.
 *
 *      A vault behind a clone would therefore look perfectly healthy — armed,
 *      funded, schedule booked, fires on the second — and never once execute.
 *      Reported against hiero-consensus-node on 2026-09-13 (issue #27263) and
 *      open at the time of writing.
 *
 *      So: `new NocturneVault(...)`, at roughly 30x the deployment gas of a
 *      clone, because the cheap version does not work. Hedera's own
 *      `ScheduledVaultFactory` deploys real contracts too.
 *
 *      **Do not "optimise" this into a proxy pattern.** If a future reader is
 *      tempted, the test in `NocturneFactory.test.ts` that asserts the deployed
 *      bytecode is not a minimal proxy exists to make that a deliberate choice
 *      rather than an accident.
 */
contract NocturneFactory {
    /// @notice Vaults created for each owner, oldest first.
    mapping(address owner => address[] vaults) internal _vaultsOf;

    /// @notice Every vault this factory has made, for indexers and the UI.
    address[] internal _allVaults;

    event VaultCreated(address indexed owner, address indexed vault, address indexed strategy, uint256 funded);

    error ZeroAddress();

    /**
     * @notice Deploy a vault owned by the caller.
     *
     * @dev Payable, and the value is forwarded. A new vault has to associate
     *      itself with every HTS token it will custody before anything can be
     *      transferred in, and association costs HBAR the vault must already
     *      hold. Sending it here saves the owner a second transaction and one
     *      more chance to arm a vault that cannot pay for its own first run.
     *
     * @param strategy The planner this vault will ask. Can be changed later by
     *        the owner; it is a constructor argument only so a vault is never
     *        briefly alive without one.
     * @return vault The address of the new vault.
     */
    function createVault(address strategy) external payable returns (address vault) {
        if (strategy == address(0)) revert ZeroAddress();

        NocturneVault created = new NocturneVault(strategy, msg.sender);
        vault = address(created);

        if (msg.value > 0) {
            // Forwarded rather than passed to the constructor, so the vault's
            // `receive` records it and the deposit shows up in its event log
            // like any other.
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok, ) = vault.call{ value: msg.value }("");
            require(ok, "funding failed");
        }

        _vaultsOf[msg.sender].push(vault);
        _allVaults.push(vault);

        emit VaultCreated(msg.sender, vault, strategy, msg.value);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function vaultCount(address owner) external view returns (uint256) {
        return _vaultsOf[owner].length;
    }

    function vaultOf(address owner, uint256 index) external view returns (address) {
        return _vaultsOf[owner][index];
    }

    /// @notice Every vault belonging to `owner`.
    /// @dev Unbounded, and deliberately only a view: an owner controls how many
    ///      vaults they create, so the list cannot be grown against them.
    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }

    /**
     * @notice One page of an owner's vaults.
     * @dev The unpaginated `vaultsOf` above returns the whole array, which grows
     *      without bound — one entry per vault that owner has ever created. It
     *      stays because it is the convenient call for the normal case of a
     *      handful of vaults, and because `eth_call` has no gas limit worth
     *      worrying about. But a contract reading it on chain, or an owner with
     *      thousands, wants a bound, and only the caller knows which case it is
     *      in.
     */
    function vaultsOf(address owner, uint256 offset, uint256 limit) external view returns (address[] memory page) {
        address[] storage all = _vaultsOf[owner];
        uint256 total = all.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = all[i];
        }
    }

    /// @notice The owner's most recent vault, or the zero address if they have none.
    function latestVaultOf(address owner) external view returns (address) {
        uint256 n = _vaultsOf[owner].length;
        if (n == 0) return address(0);
        return _vaultsOf[owner][n - 1];
    }

    function totalVaults() external view returns (uint256) {
        return _allVaults.length;
    }

    /**
     * @notice A window onto every vault ever created here.
     * @dev Paged, because this list is grown by everyone and a single-shot read
     *      of it eventually stops fitting in a response.
     */
    function allVaults(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = _allVaults.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _allVaults[i];
        }
    }
}
