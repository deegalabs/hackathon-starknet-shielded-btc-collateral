# Scripts — E2E Demo & Validation

This folder contains the end-to-end demo script for the **Shielded BTC Collateral Protocol**.

It deploys the Cairo contracts to a local Starknet devnet and runs the full protocol flow via `starknet.js`, validating every step in a real on-chain environment — not just unit tests.

---

## What the Demo Does

The script (`demo.ts`) executes the complete protocol lifecycle against a live local node:

| Step | Action | Privacy Property |
|------|--------|-----------------|
| 1 | Deploy `MockERC20` (WBTC) and `CollateralVault` | — |
| 2 | Mint WBTC to Alice and approve the vault | — |
| 3 | Alice deposits WBTC with a Poseidon commitment | Amount hidden on-chain |
| 4 | Bob's lending protocol calls `prove_collateral` | Bob learns ≥ threshold, NOT exact amount |
| 5 | Alice withdraws using a one-time nullifier | Withdrawal unlinked from deposit identity |
| 6 | Double-spend attack attempt | Blocked by nullifier registry ✅ |

---

## Requirements

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | [nvm](https://github.com/nvm-sh/nvm) |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| starknet-devnet | 0.7.x | See below |
| Scarb (Cairo) | 2.15.x | [docs.swmansion.com/scarb](https://docs.swmansion.com/scarb/) |
| snforge | 0.56.x | [foundry-rs.github.io/starknet-foundry](https://foundry-rs.github.io/starknet-foundry/) |

### Installing starknet-devnet

```bash
# Linux x86_64
curl -L https://github.com/0xSpaceShard/starknet-devnet/releases/download/v0.7.2/starknet-devnet-x86_64-unknown-linux-musl.tar.gz \
  -o /tmp/devnet.tar.gz
cd /tmp && tar xzf devnet.tar.gz
mv starknet-devnet ~/.local/bin/
```

---

## Setup

```bash
# 1. Build the Cairo contracts (from repo root)
cd contracts
scarb build

# 2. Install Node.js dependencies (from this folder)
cd ../scripts
pnpm install
```

---

## Running the Demo

**Terminal 1** — start the local Starknet node:

```bash
starknet-devnet --seed 0 --port 5050
```

**Terminal 2** — run the full E2E demo:

```bash
cd scripts
pnpm demo
```

### Expected output

```
╔══════════════════════════════════════════════════════════════╗
║   SHIELDED BTC COLLATERAL PROTOCOL  —  E2E DEMO             ║
╚══════════════════════════════════════════════════════════════╝

── Connecting to starknet-devnet ────────────────────────────────
  Chain ID                       0x534e5f5345504f4c4941
  Alice                          0x064b4880...
  Bob                            0x078662e7...

── STEP 1 — Deploy Contracts ───────────────────────────────────
  📦  MockERC20 deployed... ✅
  📦  CollateralVault deployed... ✅

── STEP 2 — Fund Alice with WBTC ───────────────────────────────
  🪙  Mint confirmed... ✅
  Alice WBTC balance             1000000 sats

── STEP 3 — Alice Makes a PRIVATE Deposit ──────────────────────
  commitment = Poseidon(amount, secret)   0x4bb47bbf...
  Deposit confirmed... ✅
  Vault WBTC balance             1000000 sats   ← vault holds funds
  Alice WBTC balance             0 sats         ← amount hidden from chain

── STEP 4 — Prove Collateral to Bob ────────────────────────────
  Proof result                   true ✅

── STEP 5 — Withdraw with Nullifier ────────────────────────────
  Withdrawal confirmed... ✅
  Nullifier registered           true

── STEP 6 — Double-Spend Attack ────────────────────────────────
  ✅  BLOCKED: Nullifier already used

╔══════════════════════════════════════════════════════════════╗
║              PROTOCOL VALIDATION COMPLETE ✅                 ║
╚══════════════════════════════════════════════════════════════╝
```

---

## How the Privacy Primitives Work

### Poseidon Commitment

Alice computes the commitment **off-chain** before depositing:

```
commitment = Poseidon(amount.low, amount.high, secret)
```

Only the `commitment` hash is stored on-chain. The `amount` and `secret` never leave Alice's device. This mirrors the Cairo contract's `InternalImpl::compute_commitment`.

### Nullifier

When withdrawing, Alice computes a one-time nullifier:

```
nullifier = Poseidon(commitment, withdraw_secret)
```

The nullifier is posted on-chain to prevent reuse. It does **not** link back to Alice's identity or the original deposit.

### Collateral Proof (MVP vs Production)

| | MVP (Hackathon) | Production |
|-|----------------|------------|
| Mechanism | `commitment != 0` check | STARK range proof |
| Reveals amount? | No | No |
| Cryptographic guarantee? | No | Yes |
| On-chain verifier | `StubProofVerifier` | Real ZK verifier |

---

## File Structure

```
scripts/
├── demo.ts          # Main E2E demo — deploy + full flow
├── package.json
├── tsconfig.json
└── README.md        # This file
```

---

## Pre-funded Devnet Accounts (seed=0)

These accounts are automatically available when you start devnet with `--seed 0`:

| Label | Address | Role |
|-------|---------|------|
| Alice | `0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691` | Depositor |
| Bob | `0x078662e7352d062084b0010068b99288486c2d8b914f6e2a55ce945f8792c8b1` | DeFi Protocol |

Each account starts with `1,000,000,000,000,000,000,000 WEI` (ETH for gas fees).
