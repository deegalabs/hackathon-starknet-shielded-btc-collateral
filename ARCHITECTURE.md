# 🏗️ Architecture — Shielded BTC Collateral Protocol

This document describes the full technical architecture of the protocol, including component diagrams, data flows, and cryptographic primitives.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Breakdown](#2-component-breakdown)
3. [Deposit Flow](#3-deposit-flow)
4. [Prove Collateral Flow](#4-prove-collateral-flow)
5. [Withdraw Flow](#5-withdraw-flow)
6. [Account Abstraction Layer](#6-account-abstraction-layer)
7. [Bitcoin → Starknet Integration](#7-bitcoin--starknet-integration)
8. [Privacy Layer — ZK Primitives](#8-privacy-layer--zk-primitives)
9. [Ecosystem Integration](#9-ecosystem-integration)
10. [Security Model](#10-security-model)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                           │
│         Web App (React + TypeScript + Starknet.js)           │
│         Mobile (Argent / Braavos wallet)                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│               ACCOUNT ABSTRACTION LAYER                      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ OZ Account   │  │ Session Keys │  │ Paymaster        │   │
│  │ (AA native)  │  │ (batch txs)  │  │ (gasless UX)     │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│              SMART CONTRACTS — Starknet L2                   │
│                       Cairo 2.15                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                CollateralVault                        │   │
│  │  deposit(amount, commitment)                          │   │
│  │  prove_collateral(user, threshold) → bool             │   │
│  │  withdraw(amount, nullifier)                          │   │
│  │  get_commitment(user) → felt252                       │   │
│  │  get_total_locked() → u256                            │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │              StubProofVerifier  (MVP)                 │   │
│  │  verify_proof(commitment, threshold) → bool           │   │
│  │  [Production: STARK range proof circuit]              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                WBTC Token (ERC-20)                    │   │
│  │  Standard ERC-20 on Starknet (wrapped BTC)            │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│              CRYPTOGRAPHIC PRIMITIVES                        │
│                                                              │
│  Poseidon Hash (STARK-native, 10x cheaper than Keccak)       │
│  Nullifier Scheme  (double-spend prevention)                 │
│  STARK Range Proofs  (production — off-chain generation)     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│              EXTERNAL DEPENDENCIES                           │
│                                                              │
│  WBTC Bridge  (Bitcoin → Ethereum → Starknet)                │
│  Pragma Oracle  (BTC/USD price feed)                         │
│  Other Protocols  (zkLend, Nostra, Ekubo — integrators)      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Component Breakdown

### CollateralVault.cairo

The core contract. Holds WBTC and manages the commitment/nullifier state.

| Function | Visibility | Description |
|----------|-----------|-------------|
| `deposit(amount, commitment)` | external | Transfers WBTC from user to vault, stores commitment |
| `prove_collateral(user, threshold)` | view | Verifies user's commitment hides value > threshold |
| `withdraw(amount, nullifier)` | external | Verifies nullifier, releases WBTC to caller |
| `get_commitment(user)` | view | Returns stored commitment for a user |
| `get_total_locked()` | view | Returns total WBTC in vault |

**Storage:**
```
wbtc_token:    ContractAddress           — address of the WBTC ERC-20
commitments:   Map<Address, felt252>     — user → commitment (hides amount)
nullifiers:    Map<felt252, bool>        — nullifier → used? (prevents double-spend)
total_locked:  u256                      — total WBTC held
```

**Events:**
```
Deposit        { user: Address, commitment: felt252 }          — does NOT emit amount
Withdraw       { nullifier: felt252 }                          — does NOT emit user or amount
CollateralProved { user: Address, threshold: u256, valid: bool }
```

### StubProofVerifier.cairo (MVP)

Placeholder for the real STARK range proof verifier. Returns `true` if a commitment exists.

**Production version** will:
1. Accept a STARK proof (serialized as `Array<felt252>`)
2. Verify the proof on-chain using Cairo's native STARK verifier
3. Confirm the commitment hides a value > threshold

### WBTC Token

Standard OpenZeppelin ERC-20 on Starknet. In production: the real WBTC token bridged via Starkgate. In testnet/local: a mock ERC-20 used for testing.

---

## 3. Deposit Flow

```
User                Frontend            Prover API         CollateralVault    WBTC Token
 │                     │                    │                     │               │
 │  Enter amount=10     │                   │                     │               │
 │─────────────────────>│                   │                     │               │
 │                      │                   │                     │               │
 │                      │ generate secret (local, random)         │               │
 │                      │─────────────────────────────────────────┤               │
 │                      │                   │                     │               │
 │                      │ commitment = Poseidon(10, secret)        │               │
 │                      │─────────────────────────────────────────┤               │
 │                      │                   │                     │               │
 │                      │ POST /proof/deposit (amount, secret)    │               │
 │                      │──────────────────>│                     │               │
 │                      │                   │ return proof        │               │
 │                      │<──────────────────│                     │               │
 │                      │                   │                     │               │
 │  Sign transaction     │                   │                     │               │
 │<─────────────────────│                   │                     │               │
 │─────────────────────>│                   │                     │               │
 │                      │                   │                     │               │
 │                      │ approve(vault, amount)                  │               │
 │                      │─────────────────────────────────────────────────────────>│
 │                      │                   │                     │               │
 │                      │ deposit(amount, commitment)             │               │
 │                      │─────────────────────────────────────────>               │
 │                      │                   │      transferFrom(user, vault, amount)│
 │                      │                   │                     │──────────────>│
 │                      │                   │                     │               │
 │                      │                   │      commitments[user] = commitment │
 │                      │                   │                     │               │
 │                      │                   │      emit Deposit { user, commitment }
 │                      │                   │                     │ (NOT amount!) │
 │  "Deposit successful!"│                   │                     │               │
 │<─────────────────────│                   │                     │               │

On-chain state after deposit:
  commitments[alice] = 0x7f3a8b2c...   ← amount is HIDDEN
  total_locked       = 10_00000000     ← total WBTC (aggregate, not per-user)
```

**Privacy guarantee:** On-chain observers see only the commitment hash. The actual amount is never stored or emitted.

---

## 4. Prove Collateral Flow

```
LendingProtocol     User               Frontend         CollateralVault     StubVerifier
      │               │                    │                   │                  │
      │ "Prove ≥ 1.5 BTC collateral"       │                   │                  │
      │──────────────>│                    │                   │                  │
      │               │ generate range proof                   │                  │
      │               │───────────────────>│                   │                  │
      │               │                    │ prove_collateral(user, 1.5 BTC)      │
      │               │                    │──────────────────>│                  │
      │               │                    │                   │ verify_proof(    │
      │               │                    │                   │   commitment,    │
      │               │                    │                   │   threshold)     │
      │               │                    │                   │─────────────────>│
      │               │                    │                   │   return true    │
      │               │                    │                   │<─────────────────│
      │               │                    │    return true    │                  │
      │               │                    │<──────────────────│                  │
      │ "Collateral verified ✓"             │                   │                  │
      │──────────────>│                    │                   │                  │
      │               │                    │                   │                  │
      │ Approve loan  │                    │                   │                  │
      │──────────────>│                    │                   │                  │

LendingProtocol knows:  user has sufficient collateral ✓
LendingProtocol does NOT know:  user has exactly 10 BTC (could be 10M)
```

---

## 5. Withdraw Flow

```
User               Frontend          Prover API       CollateralVault     WBTC Token
 │                    │                  │                   │                │
 │  Request withdraw  │                  │                   │                │
 │───────────────────>│                  │                   │                │
 │                    │ get commitment + secret (local)       │                │
 │                    │──────────────────────────────────────┤                │
 │                    │                  │                   │                │
 │                    │ nullifier = Poseidon(commitment, secret)               │
 │                    │──────────────────────────────────────┤                │
 │                    │                  │                   │                │
 │                    │ POST /proof/nullifier                │                │
 │                    │─────────────────>│                   │                │
 │                    │                  │ return proof      │                │
 │                    │<─────────────────│                   │                │
 │                    │                  │                   │                │
 │                    │ withdraw(amount, nullifier)          │                │
 │                    │─────────────────────────────────────>│                │
 │                    │                  │  check nullifiers[nullifier] == false
 │                    │                  │                   │                │
 │                    │                  │  nullifiers[nullifier] = true      │
 │                    │                  │                   │                │
 │                    │                  │                   │ transfer(user, amount)
 │                    │                  │                   │───────────────>│
 │                    │                  │  emit Withdraw { nullifier }       │
 │                    │                  │                   │ (no user/amount)│
 │  "Withdrawn!"      │                  │                   │                │
 │<───────────────────│                  │                   │                │

On-chain observers see: nullifier = 0x9b2f... was used
They CANNOT link it to the original deposit commitment.
```

---

## 6. Account Abstraction Layer

Starknet has **native Account Abstraction** — every account is a smart contract.

```
Traditional EOA (Ethereum)              Shielded Account (Starknet AA)
──────────────────────────              ─────────────────────────────────
Private key → sign every tx             Smart contract account
Lost key = lost funds                   Guardian recovery (3-of-5 friends)
Must hold gas token                     Paymaster pays gas (gasless UX)
Approve every operation                 Session keys (1 approval → N txs)
Fixed signature scheme                  Pluggable auth (biometric, passkey)
```

### Components Used (MVP)

**OpenZeppelin Account** — Base smart contract account:
```cairo
use openzeppelin::account::AccountComponent;
```

**Session Keys** (roadmap — post-MVP):
- User approves a temporary key for 24h
- Frontend signs subsequent transactions automatically
- No wallet popup for every action

**Paymaster** (roadmap — post-MVP):
- Protocol sponsors gas for new users
- User only needs WBTC, no STRK required
- Lowers onboarding friction to near-zero

---

## 7. Bitcoin → Starknet Integration

Bitcoin does not run smart contracts. We use **Wrapped BTC (WBTC)** as the token:

```
Bitcoin Mainnet          Ethereum L1              Starknet L2
───────────────          ─────────────            ───────────────────────
Alice: 10 BTC
    │
    │ 1. Send to custodian (BitGo)
    ▼
BitGo Cold Storage
    │
    │ 2. Mint 10 WBTC (ERC-20)
    ▼
WBTC Contract (Ethereum)
    │
    │ 3. Bridge via Starkgate
    ▼
                         Starknet Bridge
                             │
                             │ 4. Mint 10 WBTC on L2
                             ▼
                                          Alice: 10 WBTC on Starknet
                                              │
                                              │ 5. Use in our protocol
                                              ▼
                                          CollateralVault
                                          commitment stored (private)
```

**Supported wrapped BTC tokens:**
| Token | Mechanism | Trust Model |
|-------|-----------|-------------|
| WBTC | BitGo custodian | Centralized (battle-tested) |
| tBTC | Threshold Network | Decentralized (newer) |
| LBTC | Lombard Finance | LST-based |

For hackathon: MockWBTC (local) + real WBTC testnet address.

---

## 8. Privacy Layer — ZK Primitives

### Poseidon Hash (STARK-native)

Why Poseidon instead of Keccak or SHA256?

| Hash | Gas on Starknet | ZK-friendly | Use case |
|------|----------------|-------------|----------|
| SHA256 | ~500k | ❌ | Legacy |
| Keccak256 | ~150k | ❌ | EVM compat |
| Pedersen | ~30k | ✅ | Legacy Starknet |
| **Poseidon** | **~15k** | **✅** | **This protocol** |

```
commitment = poseidon_hash_span([amount_low, amount_high, secret])
```

### Commitment Scheme

```
PRIVATE (never on-chain):          PUBLIC (on-chain only):
  amount  = 10_00000000 (10 BTC)     commitment = 0x7f3a8b2c4d1e9f3a...
  secret  = 0xdeadbeef1234...
                  │
                  └──── Poseidon(amount, secret) ────► commitment
                                                          ▲
                                                 Cannot reverse without secret
```

### Range Proof Circuit (Production)

The range proof circuit proves:
1. `commitment == Poseidon(amount, secret)`  — commitment is well-formed
2. `amount > threshold`                      — value exceeds the required threshold

```
Public inputs:  commitment, threshold
Private inputs: amount, secret

Constraints:
  poseidon_hash(amount, secret) == commitment
  amount - threshold > 0  (range check)

Output: proof (STARK bytes)
```

Any verifier can check the proof using only the **public inputs** — they learn nothing about `amount` or `secret`.

### Nullifier Scheme

```
nullifier = poseidon_hash(commitment, withdraw_secret)
```

- Derived from commitment + a fresh secret
- One-time use: stored in `nullifiers` map after withdrawal
- On-chain observers cannot link nullifier → original deposit
- Prevents double-spending even with full knowledge of the nullifier

---

## 9. Ecosystem Integration

```
                    Shielded Collateral Protocol
                    ┌────────────────────────────┐
                    │    CollateralVault.cairo    │
                    │    prove_collateral(...)    │
                    └──────────────┬─────────────┘
                                   │
          ┌────────────────────────┼───────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
   Lending Protocols          Derivatives             Stablecoins (CDP)
   ┌─────────────┐           ┌─────────────┐        ┌─────────────┐
   │ zkLend      │           │ Ekubo Perps │        │ Opus / ZEND │
   │ Nostra      │           │ ZKX Futures │        │ Custom CDP  │
   │ Morpho      │           │             │        │             │
   └─────────────┘           └─────────────┘        └─────────────┘

  "Collateral > 150%?"      "Margin > $10k?"      "BTC > $75k?"
  vault.prove_collateral()  vault.prove_collateral()  vault.prove_collateral()
       ↓ true                     ↓ true                    ↓ true
  Loan approved             Trade executed            Stablecoin minted
  (amount private)          (holdings private)        (position private)
```

**Integration interface** (one line of Cairo):
```cairo
ICollateralVaultDispatcher { contract_address: VAULT_ADDRESS }
    .prove_collateral(user, threshold) → bool
```

---

## 10. Security Model

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Commitment value revealed | Poseidon preimage resistance — computationally infeasible |
| Double-spend attack | Nullifier map — nullifier marked used on first withdrawal |
| Fake commitment (no BTC) | WBTC transfer in same tx — commitment only stored if transfer succeeds |
| Fake proof | Verifier checks proof mathematically (production: STARK verifier) |
| Front-running deposit | commitment revealed before BTC transfer | Atomicity: deposit is a single tx |
| Reentrancy | Nullifier marked before transfer; ERC-20 does not call back |
| Vault drain (admin key) | No admin key in V1; upgrades via timelock (post-audit) |

### Trust Assumptions (MVP)

- **Stub verifier:** MVP always returns `true` for existing commitments. This means any user who has deposited can claim "infinite" threshold. Documented and acceptable for hackathon demo.
- **WBTC custody:** Users trust BitGo or the bridge to hold underlying BTC 1:1.
- **Secret storage:** Users must not lose their `secret`. Loss = cannot generate proofs or withdraw.

### Trust Assumptions (Production)

- Only the depositor knows their `secret`
- STARK proof is cryptographically binding — cannot fake a range proof
- No trusted setup — STARKs are transparent (unlike SNARKs/Groth16)
- Quantum-resistant — STARK security relies on hash functions, not elliptic curves

---

*See [docs/zk-proofs.md](./docs/zk-proofs.md) for a deep dive into the ZK proof mechanics.*
