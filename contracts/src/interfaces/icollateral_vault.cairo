use starknet::ContractAddress;

/// External interface of the CollateralVault.
/// Other DeFi protocols integrate by calling prove_collateral.
///
/// [H-07 Fix — March 7, 2026]
///   - `committed_amounts` plaintext storage REMOVED
///   - `prove_collateral` now accepts a ZK `proof` parameter
///   - `withdraw` now requires the deposit `secret` for preimage verification
///   - `get_committed_amount` REMOVED (privacy-preserving: amounts not stored)
///
/// [On-chain Poseidon validation — March 8, 2026]
///   - `deposit` now accepts `secret` and validates commitment on-chain:
///     compute_commitment(amount, secret) == commitment
///   - Removes trust assumption on frontend computation
///   - MVP note: `secret` is in calldata (visible on-chain); production would
///     use a ZK proof to avoid this. Acknowledged trade-off for MVP scope.
///
/// [ZK Range Proof upgrade — Phase 2]
///   - `deposit` now also accepts `bn254_commitment` for ZK proof path
///   - `prove_collateral` uses bn254_commitment + Garaga HonkVerifier
///   - `get_bn254_commitment` added for frontend to read stored BN254 commitment
#[starknet::interface]
pub trait ICollateralVault<TContractState> {
    /// Deposit WBTC privately with dual-field Poseidon commitment.
    ///
    /// On-chain validates Stark commitment: Poseidon_Stark(amount_low, amount_high, secret) == commitment
    /// BN254 commitment is stored for ZK range proof path (prove_collateral).
    ///
    /// `commitment`: Stark-field Poseidon hash (for withdrawals)
    /// `bn254_commitment`: BN254-field Poseidon2 hash (for ZK proofs via Garaga)
    ///   Computed as: poseidon2([amount_field, secret, 0, 0], t=4)[0]
    ///
    /// Reverts if: amount == 0, commitment == 0, bn254_commitment == 0,
    ///             invalid preimage, or active commitment exists.
    fn deposit(
        ref self: TContractState,
        amount: u256,
        secret: felt252,
        commitment: felt252,
        bn254_commitment: felt252,
    );

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

    /// Returns the stored Stark-field commitment for a user (0 if none).
    fn get_commitment(self: @TContractState, user: ContractAddress) -> felt252;

    /// Returns the stored BN254-field commitment for a user (0 if none).
    /// This commitment is used by prove_collateral() for ZK range proof verification.
    fn get_bn254_commitment(self: @TContractState, user: ContractAddress) -> felt252;

    /// Returns the total WBTC locked in the vault.
    fn get_total_locked(self: @TContractState) -> u256;

    /// Returns the WBTC token contract address.
    fn get_wbtc_token(self: @TContractState) -> ContractAddress;

    /// Returns true if a nullifier has already been used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;

    /// Returns true if the vault is currently paused (no deposits/withdrawals).
    fn is_paused(self: @TContractState) -> bool;
}
