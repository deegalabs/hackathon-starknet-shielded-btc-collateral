# 🔐 Zero-Knowledge Proofs — Technical Deep Dive

This document explains the cryptographic primitives used in the Shielded BTC Collateral Protocol, written for a technical audience familiar with blockchain development.

---

## Why ZK Proofs?

The fundamental problem: DeFi protocols need to **verify** that a user has sufficient collateral, but the user doesn't want to **reveal** their exact holdings.

This is exactly the type of problem ZK proofs solve:

> Prove that a statement is true, without revealing the witness (the private data that makes it true).

In our case:
- **Statement:** "My commitment hides a value greater than the threshold"
- **Witness:** The actual amount and the secret used to create the commitment
- **Proof:** A cryptographic artifact that proves the statement without revealing the witness

---

## STARK vs SNARK — Why We Use STARKs

| Property | SNARK (e.g., Groth16) | STARK |
|----------|-----------------------|-------|
| Trusted setup | Required (ceremony) | None (transparent) |
| Proof size | ~200 bytes (small) | ~100KB (larger) |
| Verification time | Very fast | Moderate |
| Quantum resistance | ❌ | ✅ |
| Range proof efficiency | Expensive | **Optimized** |
| Starknet integration | External | **Native** |
| Poseidon hash cost | Expensive | **~15k gas** |

**For range proofs specifically, STARKs win:**
- Range proofs require heavy arithmetic operations (bit decomposition, range checks)
- STARKs are algebraically optimized for exactly this type of computation
- Cairo VM has Poseidon hash as a native builtin — 10x cheaper than other hash functions
- No trusted setup means no multi-party ceremony required — transparent by design

---

## Poseidon Hash

Poseidon is a ZK-friendly hash function designed specifically for use in arithmetic circuits. Cairo 2.x includes it as a native builtin.

### Properties

- **Collision resistant:** Cannot find two inputs that hash to the same output
- **Preimage resistant:** Cannot recover inputs from the hash output
- **One-way:** `Poseidon(a, b) → c` but `c → (a, b)` is infeasible
- **Deterministic:** Same inputs always produce the same output
- **STARK-native:** ~15k gas on Starknet vs ~150k for Keccak256

### Usage in Protocol

```cairo
use core::poseidon::poseidon_hash_span;

fn compute_commitment(amount_low: felt252, amount_high: felt252, secret: felt252) -> felt252 {
    poseidon_hash_span(array![amount_low, amount_high, secret].span())
}

fn compute_nullifier(commitment: felt252, withdraw_secret: felt252) -> felt252 {
    poseidon_hash_span(array![commitment, withdraw_secret].span())
}
```

---

## Commitment Scheme

A **commitment scheme** allows a party to commit to a value without revealing it, and later reveal it with proof.

### Setup

```
Alice has: amount = 10_00000000 (10 BTC in satoshis)
Alice generates: secret = 0x7a3f9c... (random 256-bit number)

commitment = Poseidon(amount_low, amount_high, secret)
           = 0x7f3a8b2c4d1e9f3a...
```

### Properties

- **Hiding:** The commitment reveals nothing about `amount`. It looks like a random field element.
- **Binding:** Alice cannot change `amount` after committing. `Poseidon(amount, secret)` is deterministic.

### On-Chain State

```
commitments[alice] = 0x7f3a8b2c...   ← public
amount             = 10_00000000     ← PRIVATE (only Alice knows)
secret             = 0x7a3f9c...     ← PRIVATE (only Alice knows)
```

---

## Range Proof Circuit (Production)

The range proof proves that the committed value exceeds a threshold.

### Circuit Design

```
Public inputs:
  commitment  = 0x7f3a8b2c...   (stored on-chain)
  threshold   = 1_50000000      (1.5 BTC, set by lending protocol)

Private inputs (witness):
  amount      = 10_00000000     (Alice's actual deposit)
  secret      = 0x7a3f9c...     (random secret)

Constraints (must all be satisfied):
  1. poseidon_hash(amount_low, amount_high, secret) == commitment
  2. amount - threshold > 0   (amount strictly exceeds threshold)
  3. amount fits in 128 bits  (prevents overflow attacks)

Output:
  proof = <STARK proof bytes>   (~100KB)
```

If all constraints are satisfied, the prover can generate a valid proof.
If any constraint fails (e.g., `amount < threshold`), no valid proof can be generated.

### Cairo Circuit Implementation (Production)

```cairo
// circuits/range_proof.cairo

fn range_proof_circuit(
    // Public inputs
    commitment: felt252,
    threshold: u256,
    // Private inputs (witness — never revealed)
    amount: u256,
    secret: felt252,
) {
    // Constraint 1: commitment is correctly formed
    let computed = poseidon_hash_span(
        array![amount.low.into(), amount.high.into(), secret].span()
    );
    assert(computed == commitment, 'Invalid commitment');

    // Constraint 2: amount exceeds threshold
    assert(amount > threshold, 'Amount below threshold');

    // Constraint 3: amount is in valid range (prevents wrap-around attacks)
    // u256 type enforces this at the type level in Cairo
}
```

### Verification On-Chain

```cairo
// contracts/ProofVerifier.cairo (Production)

fn verify_range_proof(
    commitment: felt252,
    threshold: u256,
    proof: Array<felt252>,
) -> bool {
    // Deserialize proof
    let stark_proof = deserialize_proof(proof);

    // Verify using Starknet's native STARK verifier
    // Public inputs: [commitment, threshold_low, threshold_high]
    let public_inputs = array![
        commitment,
        threshold.low.into(),
        threshold.high.into()
    ];

    stark_verify(stark_proof, public_inputs.span())
}
```

---

## Nullifier Scheme

Nullifiers prevent the same deposit from being withdrawn multiple times.

### How It Works

```
Alice's deposit commitment: C = Poseidon(amount, secret)
Alice's nullifier:          N = Poseidon(C, withdraw_secret)

On withdraw:
  1. Check: nullifiers[N] == false    (not yet used)
  2. Transfer WBTC to Alice
  3. Set:   nullifiers[N] = true      (mark as used)

If Alice tries to withdraw again with the same N:
  1. Check: nullifiers[N] == true     (already used)
  2. Transaction REVERTS
```

### Privacy Property

On-chain observers see `N = 0x9b2f...` was used, but:
- They cannot compute `C` from `N` (Poseidon is one-way)
- They cannot link `N` to Alice's original deposit
- They cannot determine the amount withdrawn

---

## MVP vs Production Comparison

| Property | MVP (Stub Verifier) | Production (STARK Verifier) |
|----------|--------------------|-----------------------------|
| Commitment hiding | ✅ (Poseidon) | ✅ (Poseidon) |
| Prove amount > threshold | ❌ (stub: any deposit qualifies) | ✅ (STARK proof required) |
| Nullifier privacy | ✅ | ✅ |
| Double-spend prevention | ✅ | ✅ |
| Fake proof rejected | ❌ (no proof required) | ✅ (proof is verified) |
| Amount never revealed | ✅ | ✅ |

**The privacy properties hold in the MVP.** The missing piece is enforcement: in production, a user cannot claim `amount > threshold` without actually having it — the STARK proof makes this cryptographically impossible.

---

## Further Reading

- [STARK Math](https://starkware.co/stark-math/) — StarkWare's original STARK series
- [Poseidon Hash](https://eprint.iacr.org/2019/458.pdf) — Original paper
- [Cairo Builtins](https://docs.cairo-lang.org/how_cairo_works/builtins.html) — Cairo's native hash builtins
- [Stwo Prover](https://github.com/starkware-libs/stwo) — StarkWare's latest STARK prover
