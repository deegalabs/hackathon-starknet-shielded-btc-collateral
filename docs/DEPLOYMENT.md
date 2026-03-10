# Sepolia Testnet Deployment Guide

## Prerequisites

### 1. Install Tools

```bash
# Starknet Foundry (sncast)
curl -L https://raw.githubusercontent.com/foundry-rs/starknet-foundry/master/scripts/install.sh | sh

# Scarb (Cairo build system)
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh
```

### 2. Create and Fund a Starknet Account

```bash
# Create account
mkdir -p ~/.starknet_accounts
starkli account create ~/.starknet_accounts/sepolia.json

# Fund via faucet
# https://starknet-faucet.vercel.app/
```

### 3. Set Environment Variables

```bash
export STARKNET_ACCOUNT=~/.starknet_accounts/sepolia.json
export STARKNET_RPC=https://starknet-sepolia.public.blastapi.io
```

## Deployment

### Automated (Recommended)

```bash
# From project root
./scripts/deploy_sepolia.sh
```

This script will:
1. Build all Cairo contracts (`scarb build`)
2. Declare all 7 contract classes on Sepolia
3. Deploy all contracts with correct constructor args
4. Call `set_verifier` on the vault
5. Save addresses to `scripts/deployment/sepolia.json`
6. Generate `scripts/deployment/frontend.env.sepolia`

### Manual Deployment

If you prefer step-by-step:

```bash
# 1. Build
scarb build

# 2. Declare each contract
sncast --account $STARKNET_ACCOUNT declare --contract-name MockERC20
sncast --account $STARKNET_ACCOUNT declare --contract-name StubProofVerifier
sncast --account $STARKNET_ACCOUNT declare --contract-name CollateralVault
sncast --account $STARKNET_ACCOUNT declare --contract-name SessionKeyManager
sncast --account $STARKNET_ACCOUNT declare --contract-name Paymaster
sncast --account $STARKNET_ACCOUNT declare --contract-name ShieldedAccount
sncast --account $STARKNET_ACCOUNT declare --contract-name MockLendingProtocol

# 3. Deploy (use class hashes from declare output)
sncast --account $STARKNET_ACCOUNT deploy \
    --class-hash <WBTC_CLASS_HASH> \
    --constructor-calldata 8 1000000000000 0 <YOUR_ADDRESS>
# ... repeat for other contracts
```

## Frontend Configuration

After deployment:

```bash
# Copy generated env file
cp scripts/deployment/frontend.env.sepolia frontend/.env

# Start frontend
cd frontend && pnpm dev
```

## Verify Deployment

Visit Voyager Explorer to verify contracts:

```
https://sepolia.voyager.online/contract/<VAULT_ADDRESS>
```

Check the `scripts/deployment/sepolia.json` file for all addresses and explorer links.

## Contract Architecture

```
deployer
├── MockERC20 (WBTC)          — ERC-20 token, 8 decimals
├── StubProofVerifier          — MVP ZK proof stub
├── CollateralVault            — Core privacy vault (H-07 fixed)
│   └── verifier: StubProofVerifier
├── SessionKeyManager          — SNIP-9 session keys
├── Paymaster                  — Gas sponsorship
│   └── vault: CollateralVault
├── ShieldedAccount (class)    — Deployed per-user via UDC
└── MockLendingProtocol        — 70% LTV lending demo
    └── vault: CollateralVault
```

## Troubleshooting

### "Insufficient balance" / "Nonce too low"
- Wait 30s between transactions for nonce to settle
- Fund account via faucet if balance is low

### "Class already declared"
- Use the existing class hash from the error message
- The script handles this automatically

### "STARKNET_ACCOUNT not set"
- Run: `export STARKNET_ACCOUNT=~/.starknet_accounts/sepolia.json`

### Contract interaction failing
- Verify the vault has a verifier set: `get_verifier()` should return non-zero
- Run `set_verifier(VERIFIER_ADDRESS)` as owner if needed

## Privacy Note

The deployed `CollateralVault` has no plaintext amount storage (H-07 fix).
Deposits are hidden via Poseidon commitments. Withdrawals require knowledge
of the deposit secret — proven cryptographically on-chain.

See [SECURITY.md](../SECURITY.md) for full security documentation.
