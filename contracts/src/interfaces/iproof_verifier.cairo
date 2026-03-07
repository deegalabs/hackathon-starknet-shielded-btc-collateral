/// Interface for the proof verifier.
/// MVP: StubProofVerifier always returns true for non-zero commitments.
/// Production: RangeProofVerifier validates a STARK range proof on-chain.
#[starknet::interface]
pub trait IProofVerifier<TContractState> {
    /// Verify that a commitment hides a value exceeding the threshold.
    /// commitment: Poseidon(amount, secret)
    /// threshold:  minimum required value
    /// proof:      STARK proof bytes (empty in MVP stub)
    fn verify_range_proof(
        self: @TContractState,
        commitment: felt252,
        threshold: u256,
        proof: Span<felt252>,
    ) -> bool;
}
