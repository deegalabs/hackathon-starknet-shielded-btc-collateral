use starknet::ContractAddress;

/// Interface for DeFi lending protocols that integrate with CollateralVault.
///
/// Demonstrates the composability primitive: any lending protocol verifies
/// private BTC collateral without learning the exact deposited amount.
///
/// Integration pattern:
///   1. User calls vault.deposit(amount, commitment)
///   2. User calls lending.borrow(loan_amount)
///   3. Lending contract calls vault.prove_collateral(user, required_collateral)
///   4. If proof passes → loan is issued; collateral amount stays private
///
/// LTV (Loan-to-Value) example at 70% LTV:
///   deposit 10 BTC → can borrow up to 7 BTC equivalent
///   prove_collateral(user, 7 BTC) → true
///   borrow(7 BTC) → succeeds
#[starknet::interface]
pub trait ILendingProtocol<TContractState> {
    /// Borrow against private BTC collateral.
    ///
    /// Internally calls vault.prove_collateral(caller, borrow_amount * 100 / ltv_ratio).
    /// Reverts if collateral proof fails.
    fn borrow(ref self: TContractState, borrow_amount: u256);

    /// Repay borrowed amount (partial or full).
    fn repay(ref self: TContractState, repay_amount: u256);

    /// Returns the current debt for a borrower.
    fn get_debt(self: @TContractState, borrower: ContractAddress) -> u256;

    /// Returns the maximum borrowable amount given the user's current collateral.
    /// Returns 0 if collateral is below the minimum threshold.
    fn get_borrow_limit(self: @TContractState, borrower: ContractAddress) -> u256;

    /// Returns the LTV ratio as a percentage (e.g., 70 means 70% LTV).
    fn get_ltv_ratio(self: @TContractState) -> u64;

    /// Returns the vault address used for proof verification.
    fn get_vault_address(self: @TContractState) -> ContractAddress;

    /// Returns the total amount currently borrowed from this protocol.
    fn get_total_borrowed(self: @TContractState) -> u256;
}
