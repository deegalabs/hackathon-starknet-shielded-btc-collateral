use starknet::ContractAddress;

/// Interface for DeFi lending protocols that integrate with CollateralVault.
///
/// Demonstrates the composability primitive: any lending protocol verifies
/// private BTC collateral without learning the exact deposited amount.
///
/// Integration pattern (MVP — stub verifier):
///   1. User calls vault.deposit(amount, secret, commitment, bn254_commitment)
///   2. User calls lending.borrow(loan_amount, [])   -- empty proof span
///   3. Lending contract calls vault.prove_collateral(user, required_collateral, [])
///   4. Stub verifier: true if commitment != 0 (deposit existence only)
///
/// Integration pattern (Production — ZK range proof):
///   1. User calls vault.deposit(amount, secret, commitment, bn254_commitment)
///   2. Frontend generates Noir UltraKeccakZKHonk proof off-chain (bb.js WASM)
///   3. Garaga SDK converts proof to Starknet calldata (Span<felt252>)
///   4. User calls lending.borrow(loan_amount, proof_calldata)
///   5. Lending contract calls vault.prove_collateral(user, required_collateral, proof)
///   6. ZKRangeProofVerifier verifies the Noir proof on-chain via Garaga HonkVerifier
///
/// LTV (Loan-to-Value) example at 70% LTV:
///   deposit 10 BTC → can borrow up to 7 BTC equivalent
///   prove_collateral(user, ~10 BTC threshold) → true
///   borrow(7 BTC, proof) → succeeds
#[starknet::interface]
pub trait ILendingProtocol<TContractState> {
    /// Borrow against private BTC collateral.
    ///
    /// `proof`: Garaga ZK calldata (Span<felt252>) for production ZK verification.
    ///          Pass an empty span `array![].span()` for MVP stub behavior.
    ///
    /// Internally calls vault.prove_collateral(caller, required_collateral, proof).
    /// Reverts if collateral proof fails.
    fn borrow(ref self: TContractState, borrow_amount: u256, proof: Span<felt252>);

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
