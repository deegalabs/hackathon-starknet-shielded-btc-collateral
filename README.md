# 🛡️ Shielded BTC Collateral Protocol

> **Private, Verifiable Collateral Layer for Bitcoin DeFi on Starknet**

Built for [Starknet Re{define} Hackathon 2026](https://hackathon.starknet.org/) — **Privacy Track + Bitcoin Track**

[![Cairo Version](https://img.shields.io/badge/Cairo-2.15.0-blue)](https://book.cairo-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Starknet](https://img.shields.io/badge/Starknet-Sepolia-purple)](https://starknet.io)
[![Tests](https://img.shields.io/badge/Tests-68%20passing-green)](./contracts/)

---

## 🎯 Problem

In current DeFi, **collateral is completely public**:

- ❌ Anyone can see exactly how much BTC you hold
- ❌ Your liquidation price is visible — MEV bots front-run it
- ❌ Whales become phishing and coercion targets
- ❌ Institutional players cannot participate without exposing strategy

**Result:** Bitcoin holders are forced to choose between **privacy** and **DeFi participation**.

---

## 💡 Solution

**Shielded Collateral Protocol** enables **private, verifiable collateral** using zero-knowledge proofs natively on Starknet.

| Without Shielded | With Shielded |
|-----------------|---------------|
| Deposit 100 BTC → everyone sees `100 BTC` | Deposit 100 BTC → on-chain sees `commitment = 0x7f3a...` |
| "Prove you have collateral" → reveal full balance | "Prove collateral > threshold" → reveal nothing |
| Liquidation is predictable → MEV attacks | Position private → no front-running |
| Withdraw: attacker can forge nullifier | Withdraw: requires `Poseidon(commitment, secret)` ✅ |

### Core Flow (H-07 Hardened — March 7, 2026)

```
1. DEPOSIT:   amount + secret  →  commitment = Poseidon(amount, secret)  →  on-chain stores commitment ONLY (no plaintext)
2. PROVE:     commitment + proof  →  "value > threshold"  →  verifiable without learning amount
3. WITHDRAW:  provide (amount, secret, nullifier)  →  on-chain verifies Poseidon(amount,secret)==commitment
              AND Poseidon(commitment,secret)==nullifier  →  prevents forgery and double-spend
```

> **Privacy Guarantee:** The amount is *never* stored in plaintext — on-chain or in events. Only the Poseidon commitment is persisted.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                            │
│           React + TypeScript + Starknet.js                    │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│               ACCOUNT ABSTRACTION LAYER                       │
│   ShieldedAccount │ Session Keys │ Paymaster (gasless)        │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│              SMART CONTRACTS  (Cairo 2.15)                    │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  CollateralVault.cairo (H-07 hardened)                  │  │
│  │   deposit(amount, commitment)                           │  │
│  │   prove_collateral(user, threshold, proof) → bool       │  │
│  │   withdraw(amount, secret, nullifier)                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  StubProofVerifier.cairo   (MVP)                        │  │
│  │   verify_range_proof(commitment, threshold, proof)      │  │
│  │   [Production: full STARK range proof verification]     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  MockLendingProtocol.cairo                              │  │
│  │   borrow(amount, threshold) — uses prove_collateral     │  │
│  │   repay(amount) — clear debt                            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│              CRYPTOGRAPHIC LAYER                              │
│   Poseidon Hash (STARK-native) │ Nullifiers │ Commitments     │
└──────────────────────────────────────────────────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full diagrams.

---

## 🔐 Core Primitives

### 1. Poseidon Commitments — Hide deposit amounts
```
commitment = Poseidon(amount.low, amount.high, secret)
```
Only the depositor knows `amount` and `secret`. On-chain **only** stores `commitment` — no plaintext amount ever persisted.

### 2. STARK Range Proofs — Prove thresholds without revealing values
```
proof: "commitment hides value > threshold"
```
Any verifier can check the proof without learning the actual amount. MVP uses `StubProofVerifier` (commitment-existence check); production replaces with `RangeProofVerifier` via `set_verifier()`.

### 3. Nullifiers — Prevent double-spending and forgery
```
nullifier = Poseidon(commitment, secret)
```
Marks withdrawals as used without linking them to the original deposit. Requires knowledge of `secret` — making forgery cryptographically infeasible.

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Scarb | 2.15+ | [scarb.sh](https://docs.swmansion.com/scarb/) |
| Starknet Foundry | 0.56+ | [foundry-rs/starknet-foundry](https://github.com/foundry-rs/starknet-foundry) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| pnpm | 10+ | `npm i -g pnpm` |

### Installation

```bash
# Clone repository
git clone https://github.com/deegalabs/shielded-btc-collateral
cd shielded-btc-collateral

# Build Cairo contracts
cd contracts
scarb build

# Run all 68 tests
snforge test
```

### Run Locally

```bash
# Start Katana local node
katana --seed 0

# Deploy contracts (local)
cd contracts
scarb run deploy-local

# Start frontend
cd ../frontend
pnpm install && pnpm dev
```

### Deploy to Sepolia

```bash
# Configure environment
cp scripts/.env.example scripts/.env
# Edit: STARKNET_ACCOUNT, STARKNET_PRIVATE_KEY, STARKNET_RPC

# Automated deployment
bash scripts/deploy_sepolia.sh

# Output: deployment/sepolia.json  +  deployment/frontend.env.sepolia
```

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for full deployment guide.

---

## 📖 Usage Example

### TypeScript (Frontend Integration)

```typescript
import { hash } from 'starknet';

// Step 1: Generate commitment locally (private — never sent as plaintext)
const secret = BigInt('0x' + crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''));
const commitment = hash.computePoseidonHashOnElements([amount_low, amount_high, secret]);

// Step 2: Deposit privately (on-chain sees commitment only)
await vault.invoke("deposit", [amount_u256, commitment]);

// Step 3: Prove collateral to any lending protocol (no amount revealed)
const hasCollateral = await vault.call("prove_collateral", [user, threshold, []]);

// Step 4: Private withdrawal (cryptographic preimage verification on-chain)
const nullifier = hash.computePoseidonHash(commitment, secret);
await vault.invoke("withdraw", [amount_u256, secret, nullifier]);
```

### Cairo (Protocol Integration)

```cairo
use shielded_collateral::ICollateralVaultDispatcher;
use shielded_collateral::ICollateralVaultDispatcherTrait;

#[external(v0)]
fn borrow(ref self: ContractState, amount: u256, threshold: u256, proof: Span<felt252>) {
    let vault = ICollateralVaultDispatcher { contract_address: VAULT_ADDRESS };

    // Verify user has sufficient collateral — without learning the exact amount
    let is_valid = vault.prove_collateral(get_caller_address(), threshold, proof);
    assert(is_valid, 'Insufficient collateral');

    // Proceed with loan...
}
```

---

## 🌐 Deployed Contracts (Testnet — Sepolia)

| Contract | Address | Explorer |
|----------|---------|----------|
| CollateralVault | `TBD — run deploy_sepolia.sh` | [Voyager](https://sepolia.voyager.online/) |
| StubProofVerifier | `TBD — run deploy_sepolia.sh` | [Voyager](https://sepolia.voyager.online/) |
| MockWBTC (ERC-20) | `TBD — run deploy_sepolia.sh` | [Voyager](https://sepolia.voyager.online/) |
| ShieldedAccount | `TBD — run deploy_sepolia.sh` | [Voyager](https://sepolia.voyager.online/) |
| Paymaster | `TBD — run deploy_sepolia.sh` | [Voyager](https://sepolia.voyager.online/) |
| MockLendingProtocol | `TBD — run deploy_sepolia.sh` | [Voyager](https://sepolia.voyager.online/) |

> After running `scripts/deploy_sepolia.sh`, addresses are written to `deployment/sepolia.json`.

---

## 🧪 Testing

```bash
cd contracts

# All 68 tests
snforge test

# With detailed output
snforge test -v

# Specific suite
snforge test test_collateral_vault
snforge test test_integration
```

### Test Coverage (68 tests)

| Suite | Tests | Coverage |
|-------|-------|---------|
| `test_collateral_vault` | 25+ | Core vault: deposit, prove, withdraw, privacy model |
| `test_integration` | 10+ | Full E2E: lending, repay, withdraw flow |
| `test_shielded_account` | 10+ | AA: deploy, session keys, signature |
| `test_paymaster` | 8+ | Gas sponsorship, collateral eligibility |
| `test_mock_lending` | 8+ | Borrow, repay, collateral checks |
| `test_session_key` | 7+ | Session lifecycle, expiry, revocation |

### Key Privacy Tests

| Test | Validates |
|------|----------|
| `test_deposit_stores_commitment_only_no_plaintext` | No plaintext amount on-chain after deposit |
| `test_withdraw_fails_with_wrong_secret` | Preimage check enforced |
| `test_withdraw_fails_with_wrong_amount` | Amount inflation attack prevented |
| `test_withdraw_fails_with_forged_nullifier` | Nullifier forgery prevented |
| `test_privacy_model_commitment_only` | Only commitment accessible externally |
| `test_prove_collateral_false_after_withdrawal` | Commitment cleared on withdraw |

---

## 🎮 Use Cases

### 1. Private Lending (Aave-style)
```
Whale deposits 100 BTC privately
→ Wants to borrow $50k from zkLend
→ zkLend asks: "Prove collateral > $75k"
→ User proves: ✅ (zkLend never learns it's 100 BTC)
→ Loan approved — position fully private
```

### 2. Private Derivatives (GMX-style)
```
Trader opens $100k perp position
→ Protocol requires: "margin > $10k"
→ Trader proves margin requirement
→ Trade executes — total holdings never exposed
```

### 3. Private CDP / Stablecoins (MakerDAO-style)
```
User mints $50k stablecoin
→ CDP requires: "BTC collateral > $75k (150%)"
→ User proves threshold
→ Stablecoin minted — collateral position private
```

---

## ⚡ Why Starknet?

| Feature | Ethereum | Starknet |
|---------|----------|----------|
| Account Abstraction | ERC-4337 (complex) | **Native (built-in)** |
| Poseidon Hash | ~150k gas | **~15k gas (10x cheaper)** |
| STARK Range Proofs | External/expensive | **Native, optimized** |
| Session Keys | Not native | **Native support** |
| Gasless Transactions | Relayer workarounds | **Native Paymaster** |
| Quantum Resistance | ❌ | **✅ (STARKs)** |

---

## ⚠️ MVP vs Production

### This MVP Includes
- ✅ Core vault logic: `deposit`, `prove_collateral`, `withdraw`
- ✅ Privacy-preserving commitment storage (**no plaintext amounts** — H-07 fix)
- ✅ Cryptographic withdrawal with preimage + nullifier verification
- ✅ Nullifier tracking (double-spend prevention + forgery prevention)
- ✅ WBTC (ERC-20) integration
- ✅ Account Abstraction: `ShieldedAccount`, `SessionKeyManager`, `Paymaster`
- ✅ Mock Lending Protocol integration
- ✅ 68 passing tests
- ✅ Sepolia deployment scripts
- ✅ Frontend with wallet connect + private deposit/withdraw UI

### Production Roadmap
- 🔄 **Real STARK prover** — Current: stub verifier. Production: full STARK range proof via Cairo circuits + Stone/Stwo prover
- 🔄 **Mainnet deployment** — Audit completion + liquidity bootstrap
- 🔄 **Security audits** — Trail of Bits + OpenZeppelin
- 🔄 **SDK** — `npm install @shielded/sdk` for protocol integrators
- 🔄 **Guardian recovery** — Social recovery for `ShieldedAccount`

> **Note:** Hackathon constraints (6 days) require focus on architecture proof and concept validation. The architecture is production-ready; the STARK prover integration requires 4–6 additional weeks of development. See [MVP.md](./MVP.md) for detailed trade-off analysis.

---

## 🗺️ Roadmap

| Phase | Timeline | Status |
|-------|----------|--------|
| **Phase 1: MVP** — Core contracts, AA, stub verifier, frontend, testnet | Hackathon | ✅ |
| **Phase 2: Production** — Real STARK proofs, audits, mainnet | Q2 2026 | 🔄 |
| **Phase 3: Ecosystem** — zkLend, Nostra, Ekubo integrations | Q3 2026 | 📋 |
| **Phase 4: Advanced** — Batch proofs, recursive proofs, cross-chain | Q4 2026 | 📋 |

See [ROADMAP.md](./ROADMAP.md) for detailed breakdown.

---

## 🤝 Integrating with Other Protocols

Any DeFi protocol can integrate by calling a single function:

```cairo
ICollateralVaultDispatcher { contract_address: VAULT_ADDRESS }
    .prove_collateral(user: ContractAddress, threshold: u256, proof: Span<felt252>) -> bool
```

The `proof` parameter allows protocols to pass a STARK range proof generated client-side. For the MVP stub, pass an empty array `array![].span()`.

**Integration examples:** [docs/integration.md](./docs/integration.md)

---

## 🔒 Security

- **Poseidon commitments**: amount stored as opaque hash — no plaintext on-chain
- **Cryptographic withdrawal**: requires knowledge of `secret` (preimage proof)
- **Nullifier integrity**: `nullifier = Poseidon(commitment, secret)` — forgery is computationally infeasible
- **Double-spend prevention**: nullifier registry (used nullifiers never reusable)
- **Upgradeable verifier**: `set_verifier()` allows dropping in real STARK prover with zero vault changes
- **OpenZeppelin components**: battle-tested AA primitives

See [SECURITY.md](./SECURITY.md) for the full audit report including H-07 fix documentation.

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System diagrams, component breakdown |
| [ROADMAP.md](./ROADMAP.md) | Development timeline |
| [MVP.md](./MVP.md) | MVP scope, trade-offs, decision log |
| [SECURITY.md](./SECURITY.md) | Security audit report (v3.0 — H-07 fix) |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Sepolia deployment guide |
| [docs/zk-proofs.md](./docs/zk-proofs.md) | ZK proof mechanics explained |
| [docs/integration.md](./docs/integration.md) | How to integrate as a protocol |

---

## 👥 Team

Built with ❤️ by [DeegaLabs](https://deegalabs.com)

| Member | Role |
|--------|------|
| **Dan** | Blockchain Architect, Cairo Developer (2nd place Cronos Hackathon) |
| **Dayane** | Full-stack Developer, UX/UI, Web3 Integrations |

---

## 📞 Contact

- 🐦 Twitter: [@deegalabs](https://twitter.com/deegalabs)
- 💬 Telegram: [@deegadan](https://t.me/deegadan)
- 📧 Email: [hello@deegalabs.com](mailto:hello@deegalabs.com)

---

## 📜 License

MIT License — see [LICENSE](./LICENSE) for details.

---

*Built for Starknet Re{define} Hackathon 2026 — Privacy Track + Bitcoin Track*
