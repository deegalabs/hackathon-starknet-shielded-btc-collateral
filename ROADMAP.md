# 🗺️ Roadmap — Shielded BTC Collateral Protocol

---

## Phase 1: MVP — Hackathon (Current)

**Goal:** Demonstrate the concept with a working demo on Starknet Sepolia testnet.

### Deliverables

| Item | Description | Status |
|------|-------------|--------|
| `CollateralVault.cairo` | Core vault: deposit, prove_collateral, withdraw | ✅ |
| `StubProofVerifier.cairo` | Verifier stub (documents production design) | ✅ |
| `MockERC20.cairo` | WBTC mock for local testing | ✅ |
| Unit tests | snforge test suite, >70% coverage | ✅ |
| Frontend | React + Starknet.js, wallet connect, 3 forms | ✅ |
| Testnet deploy | Sepolia deployment, verified on Voyager | ✅ |
| Documentation | README, ARCHITECTURE, ROADMAP, MVP | ✅ |
| Demo video | 3-minute walkthrough | ✅ |

### Trade-offs (Documented)

- **Stub verifier:** Range proof always returns `true` for existing commitments. No real STARK proof generated.
- **Basic AA:** OpenZeppelin account only. No session keys or guardian recovery.
- **No prover API:** Commitment and nullifier generated client-side with a simple hash.
- **No external integration:** Mock lending protocol shows integration pattern only.

---

## Phase 2: Production Ready (Q2 2026)

**Goal:** Mainnet-ready protocol with real STARK proofs and security audits.

### Deliverables

| Item | Description |
|------|-------------|
| Real STARK range proof circuit | Cairo circuit proving `amount > threshold` |
| On-chain STARK verifier | `verify_range_proof(commitment, threshold, proof)` |
| Off-chain prover API | REST service generating STARK proofs |
| Security audit — Trail of Bits | Full contract audit |
| Security audit — OpenZeppelin | Secondary audit |
| Formal verification | Critical functions formally verified |
| Mainnet deployment | Starknet mainnet |
| SDK v1 | `npm install @shielded/sdk` — TypeScript SDK for integrators |

### Technical Work

**STARK Range Proof Circuit:**
```cairo
// Range proof circuit (pseudocode)
fn range_proof(
    amount: felt252,         // private
    secret: felt252,         // private
    commitment: felt252,     // public
    threshold: u256,         // public
) -> bool {
    // Constraint 1: commitment is well-formed
    assert poseidon_hash(amount, secret) == commitment;

    // Constraint 2: amount exceeds threshold
    assert amount > threshold;

    true
}
```

**Prover API Endpoints:**
- `POST /proof/deposit` — Prove `amount > 0` and commitment is well-formed
- `POST /proof/range` — Prove `commitment hides value > threshold`
- `POST /proof/nullifier` — Prove `nullifier` derived from valid commitment

---

## Phase 3: Ecosystem Adoption (Q3 2026)

**Goal:** 3+ protocol integrations, multi-collateral support.

### Integrations

| Protocol | Type | Integration |
|----------|------|-------------|
| zkLend | Lending | `prove_collateral` call in borrow function |
| Nostra | Money market | Collateral verification middleware |
| Ekubo | Perps/derivatives | Margin requirement proof |
| Opus | CDP / stablecoin | BTC collateral for stablecoin minting |

### Multi-Collateral Support

| Token | Bridge | Status |
|-------|--------|--------|
| WBTC | BitGo → Starkgate | Phase 1 |
| tBTC | Threshold Network | Phase 3 |
| LBTC | Lombard Finance | Phase 3 |
| cbBTC | Coinbase | Phase 3 |

### Full Account Abstraction

- **Session keys:** One-time approval for N transactions (Web2 UX)
- **Guardian recovery:** 3-of-5 social recovery for lost keys
- **Paymaster:** Protocol sponsors gas — users only need BTC
- **Spending limits:** Daily cap on vault operations

---

## Phase 4: Advanced Features (Q4 2026)

**Goal:** Performance optimization and cross-chain expansion.

| Feature | Description | Impact |
|---------|-------------|--------|
| Batch proofs | Aggregate multiple range proofs | 10x gas reduction |
| Recursive proofs | Prove about proofs (proof composition) | Faster verification |
| Cross-chain collateral | Prove collateral on another chain via Starkgate | Multi-chain DeFi |
| Delegation | `prove_on_behalf_of(user, delegate)` | Institutional use |
| Threshold sharing | Split secret across multiple devices | Better key management |
| Private liquidation | Liquidate without revealing position | MEV protection |

---

## Vision

> "Become the standard collateral verification layer for all private DeFi on Starknet."

**2026:** Launch + first integrations  
**2027:** Standard for private collateral in Starknet DeFi  
**2028:** 10+ protocols integrated, $100M+ TVL, cross-chain expansion

Like **Chainlink → oracles** and **Uniswap → DEX**, Shielded should become the default answer to: *"How do I accept private Bitcoin collateral in my DeFi protocol?"*
