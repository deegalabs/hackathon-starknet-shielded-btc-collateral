// Helper program: compute and return the BN254 Poseidon2 commitment.
// Exported for in-browser execution via noir_js.
// Same hash as used in range_proof/src/main.nr.
fn main(amount: u64, secret: Field) -> pub Field {
    let amount_field: Field = amount as Field;
    let state: [Field; 4] = std::hash::poseidon2_permutation([amount_field, secret, 0, 0], 4);
    state[0]
}
