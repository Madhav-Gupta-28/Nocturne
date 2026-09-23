// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title GasPriceProbe
 * @notice Records what the gas price looks like from inside the EVM on Hedera.
 *
 * @dev Written to answer one question with a measurement instead of a guess.
 *
 *      A vault has to know how much HBAR one scheduled execution requires it to
 *      hold. That figure is not what a run *costs* — it is the reserve the
 *      network demands up front, which is the full gas allowance times the gas
 *      price. Computing it on chain means reading the price on chain, and on
 *      Hedera the unit of any HBAR figure is the thing most likely to be wrong:
 *      balances are tinybar (8 decimals) inside the EVM and weibar (18) over
 *      JSON-RPC, exactly 1e10 apart.
 *
 *      So `record` stores all three together, in one transaction, and the units
 *      fall out of comparing them. It must be a transaction rather than a view
 *      call: `tx.gasprice` in an `eth_call` is whatever the caller nominated,
 *      which is usually zero.
 *
 *      Not part of the system. Kept because the number it produced is load
 *      bearing, and anyone doubting it should be able to run it again.
 */
contract GasPriceProbe {
    /// @notice `tx.gasprice` as the EVM reported it.
    uint256 public lastGasPrice;

    /// @notice `block.basefee` as the EVM reported it.
    uint256 public lastBaseFee;

    /// @notice This contract's own balance, which is known to be tinybar.
    uint256 public lastBalance;

    /// @notice Gas left at entry, for sanity against the limit that was sent.
    uint256 public lastGasLeft;

    event Probed(uint256 gasPrice, uint256 baseFee, uint256 balance, uint256 gasLeft);

    /**
     * @notice `tx.gasprice` as seen during an `eth_call`.
     * @dev The other half of the question. A UI reads the vault's runway with
     *      `eth_call`, which nominates no gas price of its own, so whether the
     *      relay substitutes the network's price or leaves it at zero decides
     *      whether an on-chain estimate can be trusted in a view function.
     */
    function gasPriceNow() external view returns (uint256) {
        return tx.gasprice;
    }

    function record() external payable {
        lastGasPrice = tx.gasprice;
        lastBaseFee = block.basefee;
        lastBalance = address(this).balance;
        lastGasLeft = gasleft();
        emit Probed(lastGasPrice, lastBaseFee, lastBalance, lastGasLeft);
    }

    receive() external payable {}
}
