#!/bin/bash
# =============================================================================
# Shielded BTC Collateral Protocol — Sepolia Testnet Deployment Script
# =============================================================================
# Usage:
#   export STARKNET_ACCOUNT=~/.starknet_accounts/sepolia.json
#   export STARKNET_RPC=https://starknet-sepolia.public.blastapi.io
#   ./scripts/deploy_sepolia.sh
#
# Requirements:
#   - Funded Starknet Sepolia account (use faucet: https://starknet-faucet.vercel.app/)
#   - sncast installed (starknet-foundry)
#   - scarb installed
# =============================================================================

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()    { echo -e "${BLUE}[deploy]${NC} $1"; }
ok()     { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()   { echo -e "${YELLOW}[warn]${NC}  $1"; }
die()    { echo -e "${RED}[error]${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Shielded BTC — Sepolia Testnet Deployment          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Environment checks ───────────────────────────────────────────────────────
if [ -z "$STARKNET_ACCOUNT" ]; then
    die "STARKNET_ACCOUNT not set. Set it to your Starknet account JSON path."
fi

if [ -z "$STARKNET_RPC" ]; then
    warn "STARKNET_RPC not set. Using default Sepolia RPC."
    export STARKNET_RPC="https://starknet-sepolia.public.blastapi.io"
fi

log "Account:  $STARKNET_ACCOUNT"
log "RPC URL:  $STARKNET_RPC"

# ── Build contracts ───────────────────────────────────────────────────────────
log "Building contracts..."
scarb build
ok "Build complete"

# ── Helper: declare a contract ────────────────────────────────────────────────
declare_contract() {
    local name=$1
    log "Declaring $name..."
    local output
    output=$(sncast --account "$STARKNET_ACCOUNT" \
        --rpc-url "$STARKNET_RPC" \
        declare \
        --contract-name "$name" \
        --fee-token strk 2>&1)
    
    # Check if already declared (class hash already exists)
    if echo "$output" | grep -q "already declared"; then
        local class_hash
        class_hash=$(echo "$output" | grep -oP 'class_hash: \K0x[a-fA-F0-9]+' | head -1)
        warn "$name already declared. Class hash: $class_hash"
        echo "$class_hash"
    else
        local class_hash
        class_hash=$(echo "$output" | grep -oP 'class_hash: \K0x[a-fA-F0-9]+' | head -1)
        ok "$name declared: $class_hash"
        echo "$class_hash"
    fi
}

# ── Helper: deploy a contract ─────────────────────────────────────────────────
deploy_contract() {
    local name=$1
    local class_hash=$2
    shift 2
    local calldata=("$@")
    
    log "Deploying $name..."
    local output
    output=$(sncast --account "$STARKNET_ACCOUNT" \
        --rpc-url "$STARKNET_RPC" \
        deploy \
        --class-hash "$class_hash" \
        --constructor-calldata "${calldata[@]}" \
        --fee-token strk 2>&1)
    
    local address
    address=$(echo "$output" | grep -oP 'contract_address: \K0x[a-fA-F0-9]+' | head -1)
    ok "$name deployed: $address"
    echo "$address"
}

# ── Get deployer address ───────────────────────────────────────────────────────
log "Fetching deployer address..."
DEPLOYER=$(sncast --account "$STARKNET_ACCOUNT" \
    --rpc-url "$STARKNET_RPC" \
    account address 2>&1 | grep -oP '0x[a-fA-F0-9]+' | head -1)
log "Deployer: $DEPLOYER"

# ── Declare all contracts ──────────────────────────────────────────────────────
echo ""
log "=== DECLARING CONTRACTS ==="

WBTC_CLASS_HASH=$(declare_contract "MockERC20")
VERIFIER_CLASS_HASH=$(declare_contract "StubProofVerifier")
VAULT_CLASS_HASH=$(declare_contract "CollateralVault")
SESSION_CLASS_HASH=$(declare_contract "SessionKeyManager")
PAYMASTER_CLASS_HASH=$(declare_contract "Paymaster")
ACCOUNT_CLASS_HASH=$(declare_contract "ShieldedAccount")
LENDING_CLASS_HASH=$(declare_contract "MockLendingProtocol")

# ── Deploy contracts ──────────────────────────────────────────────────────────
echo ""
log "=== DEPLOYING CONTRACTS ==="

# MockERC20 (WBTC): decimals=8, initial_supply=1000000000000, recipient=deployer
WBTC_ADDRESS=$(deploy_contract "MockERC20 (WBTC)" "$WBTC_CLASS_HASH" \
    "8" \
    "1000000000000" "0" \
    "$DEPLOYER")

# StubProofVerifier (no constructor args)
VERIFIER_ADDRESS=$(deploy_contract "StubProofVerifier" "$VERIFIER_CLASS_HASH")

# CollateralVault (wbtc, owner)
VAULT_ADDRESS=$(deploy_contract "CollateralVault" "$VAULT_CLASS_HASH" \
    "$WBTC_ADDRESS" \
    "$DEPLOYER")

# SessionKeyManager (no constructor args)
SESSION_ADDRESS=$(deploy_contract "SessionKeyManager" "$SESSION_CLASS_HASH")

# Paymaster (owner, vault, threshold_low, threshold_high)
# Threshold: 1_000_000 sats = 0.01 BTC minimum for gas sponsorship
PAYMASTER_ADDRESS=$(deploy_contract "Paymaster" "$PAYMASTER_CLASS_HASH" \
    "$DEPLOYER" \
    "$VAULT_ADDRESS" \
    "1000000" "0")

# MockLendingProtocol (vault)
LENDING_ADDRESS=$(deploy_contract "MockLendingProtocol" "$LENDING_CLASS_HASH" \
    "$VAULT_ADDRESS")

# Set verifier on vault (owner call)
echo ""
log "Setting verifier on vault..."
sncast --account "$STARKNET_ACCOUNT" \
    --rpc-url "$STARKNET_RPC" \
    invoke \
    --contract-address "$VAULT_ADDRESS" \
    --function "set_verifier" \
    --calldata "$VERIFIER_ADDRESS" \
    --fee-token strk
ok "Verifier set on vault"

# ── Save deployment manifest ───────────────────────────────────────────────────
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p deployment

cat > deployment/sepolia.json <<EOF
{
  "network": "sepolia",
  "timestamp": "$TIMESTAMP",
  "deployer": "$DEPLOYER",
  "rpc_url": "$STARKNET_RPC",
  "contracts": {
    "wbtc": {
      "address": "$WBTC_ADDRESS",
      "class_hash": "$WBTC_CLASS_HASH",
      "note": "MockERC20, 8 decimals, 1T initial supply to deployer"
    },
    "verifier": {
      "address": "$VERIFIER_ADDRESS",
      "class_hash": "$VERIFIER_CLASS_HASH",
      "note": "StubProofVerifier — MVP. Replace with RangeProofVerifier in production."
    },
    "vault": {
      "address": "$VAULT_ADDRESS",
      "class_hash": "$VAULT_CLASS_HASH",
      "note": "CollateralVault — privacy-preserving BTC collateral. H-07 fix applied."
    },
    "session_manager": {
      "address": "$SESSION_ADDRESS",
      "class_hash": "$SESSION_CLASS_HASH"
    },
    "paymaster": {
      "address": "$PAYMASTER_ADDRESS",
      "class_hash": "$PAYMASTER_CLASS_HASH",
      "note": "Threshold: 1M sats (0.01 BTC) for gas sponsorship"
    },
    "shielded_account": {
      "class_hash": "$ACCOUNT_CLASS_HASH",
      "note": "Class hash only — deployed per-user via UDC from AccountSetup page"
    },
    "lending": {
      "address": "$LENDING_ADDRESS",
      "class_hash": "$LENDING_CLASS_HASH",
      "note": "MockLendingProtocol — 70% LTV"
    }
  },
  "explorer_links": {
    "vault": "https://sepolia.voyager.online/contract/$VAULT_ADDRESS",
    "wbtc": "https://sepolia.voyager.online/contract/$WBTC_ADDRESS",
    "lending": "https://sepolia.voyager.online/contract/$LENDING_ADDRESS",
    "paymaster": "https://sepolia.voyager.online/contract/$PAYMASTER_ADDRESS",
    "session_manager": "https://sepolia.voyager.online/contract/$SESSION_ADDRESS"
  }
}
EOF

ok "Deployment manifest saved to deployment/sepolia.json"

# ── Generate .env snippet ──────────────────────────────────────────────────────
cat > deployment/frontend.env.sepolia <<EOF
# Starknet Sepolia — Auto-generated by deploy_sepolia.sh
# Deployed: $TIMESTAMP

VITE_NETWORK=sepolia
VITE_RPC_URL=$STARKNET_RPC

VITE_WBTC_ADDRESS=$WBTC_ADDRESS
VITE_VAULT_ADDRESS=$VAULT_ADDRESS
VITE_LENDING_ADDRESS=$LENDING_ADDRESS
VITE_PAYMASTER_ADDRESS=$PAYMASTER_ADDRESS
VITE_SESSION_KEY_MANAGER_ADDRESS=$SESSION_ADDRESS
VITE_SHIELDED_ACCOUNT_CLASS_HASH=$ACCOUNT_CLASS_HASH

VITE_VOYAGER_URL=https://sepolia.voyager.online
EOF

ok "Frontend env saved to deployment/frontend.env.sepolia"
log "Copy to frontend: cp deployment/frontend.env.sepolia frontend/.env"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Deployment Complete ✅                              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  WBTC (MockERC20):    $WBTC_ADDRESS"
echo "  CollateralVault:     $VAULT_ADDRESS"
echo "  StubProofVerifier:   $VERIFIER_ADDRESS"
echo "  Paymaster:           $PAYMASTER_ADDRESS"
echo "  SessionKeyManager:   $SESSION_ADDRESS"
echo "  MockLending:         $LENDING_ADDRESS"
echo "  ShieldedAccount:     $ACCOUNT_CLASS_HASH (class hash)"
echo ""
echo "  🔗 Voyager: https://sepolia.voyager.online/contract/$VAULT_ADDRESS"
echo ""
echo "  Next steps:"
echo "    1. cp deployment/frontend.env.sepolia frontend/.env"
echo "    2. cd frontend && pnpm dev"
echo "    3. Connect wallet to Sepolia"
echo ""
