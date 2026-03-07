use starknet::ContractAddress;

/// External interface of the CollateralVault.
/// Other DeFi protocols integrate by calling prove_collateral.
///
/// [H-07 Fix — March 7, 2026]
///   - `committed_amounts` plaintext storage REMOVED
///   - `prove_collateral` now accepts a ZK `proof` parameter
///   - `withdraw` now requires the deposit `secret` for preimage verification
///   - `get_committed_amount` REMOVED (privacy-preserving: amounts not stored)
#[starknet::interface]
pub trait ICollateralVault<TContractState> {
    /// Deposit WBTC privately.
    /// The actual amount is hidden behind a Poseidon commitment.
    /// commitment = Poseidon(amount_low, amount_high, secret)
    /// Reverts if the caller already has an active commitment (H-01 fix).
    fn deposit(ref self: TContractState, amount: u256, commitment: felt252);

    /// Prove that a user's committed collateral meets or exceeds a threshold.
    ///
    /// [H-07 Fix] Delegates to the on-chain verifier. Never reads a plaintext amount.
    ///
    /// `proof`: Empty span for stub verifier (MVP). STARK proof bytes for production.
    ///
    /// MVP (StubProofVerifier): returns `commitment != 0` — confirms deposit exists.
    /// NOTE: Stub does NOT enforce the threshold. Production ZK verifier required.
    ///
    /// Production (RangeProofVerifier): cryptographically proves amount >= threshold
    /// without revealing the exact amount.
    fn prove_collateral(
        self: @TContractState, user: ContractAddress, threshold: u256, proof: Span<felt252>,
    ) -> bool;

    /// Withdraw WBTC using a cryptographic preimage proof.
    ///
    /// [H-07 Fix] Amount integrity is now verified on-chain via Poseidon preimage,
    /// NOT via plaintext storage. The caller must supply the original deposit `secret`.
    ///
    /// On-chain verification:
    ///   Poseidon(amount_low, amount_high, secret) == stored_commitment
    ///   Poseidon(commitment, secret) == nullifier
    ///
    /// Reverts if: nullifier used, no active commitment, invalid preimage, or invalid nullifier.
    fn withdraw(ref self: TContractState, amount: u256, secret: felt252, nullifier: felt252);

    /// Returns the stored commitment for a user (0 if none).
    fn get_commitment(self: @TContractState, user: ContractAddress) -> felt252;

    /// Returns the total WBTC locked in the vault.
    fn get_total_locked(self: @TContractState) -> u256;

    /// Returns the WBTC token contract address.
    fn get_wbtc_token(self: @TContractState) -> ContractAddress;

    /// Returns true if a nullifier has already been used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;

    /// Returns true if the vault is currently paused (no deposits/withdrawals).
    fn is_paused(self: @TContractState) -> bool;
}
