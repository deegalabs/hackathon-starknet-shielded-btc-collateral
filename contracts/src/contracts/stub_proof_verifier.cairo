/// StubProofVerifier — MVP placeholder for the STARK range proof verifier.
///
/// In the MVP, this contract simply returns `true` for any non-zero commitment.
/// It exists to document the production interface and make the architecture
/// upgrade-ready without changing the vault contract.
///
/// Production upgrade path (Phase 2):
///   - Replace this contract with RangeProofVerifier.cairo
///   - RangeProofVerifier will call Cairo's native STARK verifier
///   - The vault constructor will accept a verifier address
///   - No changes to CollateralVault interface required
///
/// Circuit that the production verifier will check:
///   Public inputs:  commitment, threshold
///   Private inputs: amount, secret
///   Constraints:
///     poseidon_hash(amount.low, amount.high, secret) == commitment
///     amount > threshold
#[starknet::contract]
pub mod StubProofVerifier {
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl StubProofVerifierImpl of shielded_btc_collateral::interfaces::iproof_verifier::IProofVerifier<ContractState> {
        /// MVP: Returns true for any non-zero commitment.
        ///
        /// Production: Deserializes and verifies a STARK proof that
        ///   commitment hides a value strictly greater than threshold.
        fn verify_range_proof(
            self: @ContractState,
            commitment: felt252,
            threshold: u256,
            proof: Span<felt252>,
        ) -> bool {
            // MVP stub: commitment existence implies sufficient collateral.
            // This does NOT check the threshold in the MVP.
            commitment != 0
        }
    }
}
