# 🎯 MVP Specification — Shielded BTC Collateral Protocol

This document captures the MVP scope, design decisions, trade-offs, and prioritization rationale.

---

## MVP Definition

The MVP proves the concept: **a user can deposit WBTC, prove their collateral exceeds a threshold, and withdraw — all without revealing their exact holdings.**

### In Scope

| Feature | Implementation |
|---------|---------------|
| `deposit(amount, commitment)` | Transfer WBTC, store Poseidon commitment |
| `prove_collateral(user, threshold)` | Return `true` if commitment exists (stub) |
| `withdraw(amount, nullifier)` | Check nullifier unused, transfer WBTC back |
| Nullifier double-spend prevention | `nullifiers: Map<felt252, bool>` |
| WBTC (ERC-20) integration | Transfer in/out via ERC-20 interface |
| OpenZeppelin Account Abstraction | Standard OZ account for signing |
| Frontend — 3 forms | Deposit, Prove, Withdraw |
| Wallet connect | Argent / Braavos via `starknet-react` |
| Testnet deployment | Starknet Sepolia |
| Unit tests | snforge, >70% coverage |
| Documentation | README, ARCHITECTURE, ROADMAP, this file |

### Out of Scope (Documented for Production)

| Feature | Reason Excluded | Production Path |
|---------|-----------------|----------------|
| Real STARK range proofs | Requires 4–6 weeks (Cairo circuits + Stone prover) | Phase 2 |
| Session keys | 2+ days of AA work | Phase 2 |
| Guardian recovery | 2+ days | Phase 2 |
| Paymaster / gasless | 1+ day | Phase 2 |
| Mock lending protocol integration | 1+ day, adds no core value to demo | Phase 3 |
| Prover API (backend service) | Not needed for stub verifier | Phase 2 |

---

## Key Design Decisions

### Decision 1: Stub Verifier vs Real STARK Prover

**Decision:** Use stub verifier.

**Rationale:**
- Real STARK proof generation requires: Cairo circuit design, Stone/Stwo prover integration, proof serialization, on-chain verification — each a multi-week project.
- Hackathon judges evaluate architecture, differentiation, and execution quality — not proof system completeness.
- The stub is **clearly documented** as an MVP placeholder.
- Architecture is designed to drop in a real verifier with zero changes to the vault.

**How it works in MVP:**
```cairo
fn prove_collateral(user: ContractAddress, threshold: u256) -> bool {
    // MVP: commitment exists = sufficient
    let commitment = self.commitments.read(user);
    commitment != 0
    // Production: verify STARK range proof here
}
```

**Upgrade path:**
```cairo
// Production: add proof parameter, call verifier
fn prove_collateral(user: ContractAddress, threshold: u256, proof: Array<felt252>) -> bool {
    let commitment = self.commitments.read(user);
    let verifier = IProofVerifierDispatcher { contract_address: self.verifier.read() };
    verifier.verify_range_proof(commitment, threshold, proof)
}
```

---

### Decision 2: Account Abstraction Depth

**Decision:** OpenZeppelin standard account only.

**Rationale:**
- Full AA (session keys + guardians + paymaster) takes 2+ days.
- OZ account provides the core benefit: smart contract account on Starknet.
- Session keys, guardians, and paymaster are clearly described in `ROADMAP.md` and `ARCHITECTURE.md`.
- The architecture is already designed to accommodate them.

---

### Decision 3: Commitment Generation

**Decision:** Client-side commitment generation (no prover API in MVP).

**Rationale:**
- Commitment = `Poseidon(amount, secret)` — can be computed in TypeScript with `starknet.js`.
- No server required for MVP.
- Production will add a prover API for generating full STARK proofs.

**Client-side implementation:**
```typescript
import { hash } from 'starknet';

const secret = crypto.getRandomValues(new Uint8Array(32));
const commitment = hash.computePoseidonHash(
    BigInt(amount),
    BigInt('0x' + Buffer.from(secret).toString('hex'))
);
```

---

### Decision 4: Nullifier Generation

**Decision:** Client-side nullifier generation.

**Same rationale as commitment generation.**

```typescript
const nullifier = hash.computePoseidonHash(commitment, withdrawSecret);
```

Users **must store** their `secret` and `withdrawSecret` locally. Loss of secret = cannot generate proofs or withdraw. Production will add encrypted key storage.

---

## Priority Matrix

```
MUST HAVE (blocks demo):
  ✅ CollateralVault: deposit / prove_collateral / withdraw
  ✅ Nullifier double-spend prevention
  ✅ WBTC ERC-20 integration
  ✅ Testnet deployment
  ✅ Frontend: 3 working forms
  ✅ README + Architecture docs
  ✅ Demo video (3 min)

SHOULD HAVE (differentiates from other projects):
  ✅ Comprehensive test coverage (>70%)
  ✅ Events with privacy (no amount in Deposit event)
  ✅ OpenZeppelin account abstraction
  ✅ Clear stub vs production documentation
  ✅ Poseidon hash (not keccak) — STARK-native

NICE TO HAVE (if time permits):
  ⚪ Session keys (1 approval → N txs)
  ⚪ Mock lending protocol integration example
  ⚪ Animated commitment/proof UI visualization
  ⚪ Mobile responsive frontend

SKIP:
  ❌ Real STARK prover
  ❌ Guardian recovery
  ❌ Paymaster
  ❌ Prover API backend
```

---

## Acceptance Criteria

The MVP is complete when:

1. `scarb build` compiles without errors or warnings
2. `snforge test` passes all tests with >70% coverage
3. Contracts are deployed and verified on Starknet Sepolia
4. Frontend is live at a public URL (Vercel/Netlify)
5. A user can: connect wallet → deposit WBTC → prove collateral → withdraw — in one session
6. README and ARCHITECTURE docs are complete and accurate
7. A 3-minute demo video is recorded and uploaded

---

## Testing Strategy

### Unit Tests (Cairo / snforge)

| Test | Description |
|------|-------------|
| `test_deposit_stores_commitment` | Deposit stores correct commitment |
| `test_deposit_transfers_wbtc` | WBTC moved from user to vault |
| `test_deposit_zero_amount_fails` | Zero deposit reverts |
| `test_prove_collateral_returns_true` | Returns true for deposited user |
| `test_prove_collateral_no_deposit_fails` | Returns false for unknown user |
| `test_withdraw_returns_wbtc` | WBTC returned to user |
| `test_withdraw_marks_nullifier_used` | Nullifier marked after withdraw |
| `test_double_spend_prevention` | Second withdraw with same nullifier fails |
| `test_events_no_amount_in_deposit` | Deposit event does not emit amount |

### Integration Tests

- Deploy vault + mock WBTC on local Katana
- Full flow: approve → deposit → prove → withdraw
- Verify on-chain state at each step

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Cairo compilation errors | Medium | High | Start early, fix incrementally |
| Testnet congestion / RPC issues | Low | Medium | Have backup RPC, test locally first |
| Frontend wallet integration bugs | Medium | Medium | Use `starknet-react` — well-tested library |
| Time runs out before frontend | Low | Medium | Contracts + docs alone demonstrate the concept |
| Secret loss by user (UX) | High (demo) | Low (demo) | Document clearly; use fixed test secrets |
