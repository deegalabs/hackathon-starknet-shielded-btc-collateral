// Range Proof Circuit -- ShieldedBTC Collateral Protocol
//
// Proves that a BN254 Poseidon2 commitment hides a value exceeding a threshold,
// without revealing the amount or secret to the verifier.
//
// Public inputs  (visible on-chain): commitment, threshold
// Private inputs (witness -- never on-chain): amount (satoshis), secret (BN254 blinding)
//
// Constraints enforced:
//   1. poseidon2_permutation([amount_field, secret, 0, 0], 4)[0] == commitment
//   2. amount > threshold
//
// Hash uses Poseidon2 with t=4 state (standard in Barretenberg/BN254).
// Compatible with: Garaga 1.0.1 / UltraKeccakZKHonk / Noir 1.0.0-beta.16

// Compute a BN254 Poseidon2 commitment for (amount, secret).
// Uses t=4 permutation with zero-padding (standard Barretenberg config).
fn compute_commitment(amount: u64, secret: Field) -> Field {
    let amount_field: Field = amount as Field;
    let state: [Field; 4] = std::hash::poseidon2_permutation([amount_field, secret, 0, 0], 4);
    state[0]
}

fn main(
    // Private inputs (witness -- never revealed on-chain)
    amount: u64,
    secret: Field,

    // Public inputs (verified on-chain by the Cairo verifier)
    commitment: pub Field,
    threshold: pub u64,
) {
    // Constraint 1: verify the BN254 Poseidon2 commitment preimage
    let computed_commitment = compute_commitment(amount, secret);
    assert(computed_commitment == commitment, "Invalid commitment preimage");

    // Constraint 2: range check -- amount must strictly exceed threshold
    assert(amount > threshold, "Insufficient collateral: amount <= threshold");
}

// --- Tests -------------------------------------------------------------------

#[test]
fn test_valid_range_proof() {
    // 1 BTC = 100_000_000 satoshis; threshold = 50_000_000 (0.5 BTC)
    let amount: u64 = 100_000_000;
    let secret: Field = 0x1234567890abcdef1234567890abcdef;
    let threshold: u64 = 50_000_000;
    let commitment = compute_commitment(amount, secret);
    main(amount, secret, commitment, threshold);
}

#[test(should_fail)]
fn test_insufficient_collateral_fails() {
    // amount == threshold should fail (strict inequality required)
    let amount: u64 = 50_000_000;
    let secret: Field = 0xdeadbeef;
    let threshold: u64 = 50_000_000;
    let commitment = compute_commitment(amount, secret);
    main(amount, secret, commitment, threshold);
}

#[test(should_fail)]
fn test_wrong_secret_fails() {
    let amount: u64 = 200_000_000;
    let secret: Field = 0x1111;
    let wrong_secret: Field = 0x2222;
    let threshold: u64 = 100_000_000;
    let commitment = compute_commitment(amount, secret);
    // Wrong secret -- commitment preimage check should fail
    main(amount, wrong_secret, commitment, threshold);
}

#[test(should_fail)]
fn test_wrong_amount_fails() {
    let amount: u64 = 200_000_000;
    let wrong_amount: u64 = 150_000_000;
    let secret: Field = 0x5555;
    let threshold: u64 = 100_000_000;
    let commitment = compute_commitment(amount, secret);
    // Wrong amount -- commitment preimage check should fail
    main(wrong_amount, secret, commitment, threshold);
}
