#!/usr/bin/env bash
# =============================================================================
# deploy_devnet.sh — Deploy all contracts to local Katana devnet
# =============================================================================
# Prerequisites:
#   1. Katana running: katana --accounts 3 --seed 0
#   2. Scarb installed: https://docs.swmansion.com/scarb/
#   3. Starknet Foundry installed: https://github.com/foundry-rs/starknet-foundry
#
# Usage:
#   bash scripts/deploy_devnet.sh
#
# Output:
#   deployment/devnet.json          — All contract addresses
#   deployment/frontend.env.devnet  — Frontend .env config
# =============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { echo -e "${CYAN}  ℹ${RESET}  $1"; }
success() { echo -e "${GREEN}  ✅${RESET}  $1"; }
warn()    { echo -e "${YELLOW}  ⚠️${RESET}   $1"; }
error()   { echo -e "${RED}  ❌${RESET}  $1"; exit 1; }

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Shielded BTC Collateral — Devnet Deployment             ║"
echo "║  Starknet Re{define} Hackathon 2026                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ─── Config ──────────────────────────────────────────────────────────────────

RPC_URL="${STARKNET_RPC:-http://localhost:5050}"

# Katana seed-0 account 0 (deterministic)
DEPLOYER="0x517ececd29116499f4a1b64b094da79ba08dfd54a3edaa316134c41f8160973"
DEPLOYER_PRIVATE_KEY="0x1800000000300000180000000000030000000000003006001800006600"

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/contracts"
DEPLOYMENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deployment"

# ─── Preflight ───────────────────────────────────────────────────────────────

echo -e "\n${CYAN}${BOLD}━━━ Preflight checks ━━━${RESET}"

# Check Katana is running
if ! curl -sf "$RPC_URL" -d '{"jsonrpc":"2.0","method":"starknet_syncing","id":1}' \
     -H "Content-Type: application/json" > /dev/null 2>&1; then
    error "Katana devnet not running at $RPC_URL\nStart it with: katana --accounts 3 --seed 0"
fi
success "Katana devnet is running at $RPC_URL"

# Check sncast
if ! command -v sncast &>/dev/null; then
    error "sncast not found. Install Starknet Foundry: https://github.com/foundry-rs/starknet-foundry"
fi
success "sncast $(sncast --version 2>&1 | head -1)"

mkdir -p "$DEPLOYMENT_DIR"

# ─── Build ───────────────────────────────────────────────────────────────────

echo -e "\n${CYAN}${BOLD}━━━ Building contracts ━━━${RESET}"
(cd "$CONTRACTS_DIR" && scarb build) || error "scarb build failed"
success "Contracts built successfully"

# ─── Helper: declare with dedup ──────────────────────────────────────────────

declare_contract() {
    local name="$1"
    info "Declaring $name..."
    local output
    output=$(sncast --url "$RPC_URL" \
        --account "$DEPLOYER" \
        --private-key "$DEPLOYER_PRIVATE_KEY" \
        declare \
        --contract-name "$name" \
        --fee-token strk \
        2>&1) || true

    local class_hash
    class_hash=$(echo "$output" | grep -oP 'class_hash: \K0x[a-fA-F0-9]+' | head -1 || true)

    if [[ -z "$class_hash" ]]; then
        # Already declared — extract from error
        class_hash=$(echo "$output" | grep -oP '0x[a-fA-F0-9]{60,}' | head -1 || true)
    fi

    if [[ -z "$class_hash" ]]; then
        warn "Could not extract class hash for $name. Output: $output"
        class_hash="0x0"
    else
        success "$name class hash: $class_hash"
    fi
    echo "$class_hash"
}

deploy_contract() {
    local name="$1"
    local class_hash="$2"
    shift 2
    local calldata=("$@")
    info "Deploying $name..."

    local calldata_args=""
    if [[ ${#calldata[@]} -gt 0 ]]; then
        calldata_args="--constructor-calldata ${calldata[*]}"
    fi

    local output
    output=$(sncast --url "$RPC_URL" \
        --account "$DEPLOYER" \
        --private-key "$DEPLOYER_PRIVATE_KEY" \
        deploy \
        --class-hash "$class_hash" \
        --fee-token strk \
        $calldata_args \
        2>&1) || true

    local address
    address=$(echo "$output" | grep -oP 'contract_address: \K0x[a-fA-F0-9]+' | head -1 || true)

    if [[ -z "$address" ]]; then
        warn "Could not extract address for $name. Output: $output"
        address="0x0"
    else
        success "$name deployed at: $address"
    fi
    echo "$address"
}

# ─── Declare all contracts ───────────────────────────────────────────────────

echo -e "\n${CYAN}${BOLD}━━━ Declaring contracts ━━━${RESET}"
cd "$CONTRACTS_DIR"

WBTC_CLASS=$(declare_contract "MockERC20")
VERIFIER_CLASS=$(declare_contract "StubProofVerifier")
VAULT_CLASS=$(declare_contract "CollateralVault")
SESSION_CLASS=$(declare_contract "SessionKeyManager")
PAYMASTER_CLASS=$(declare_contract "Paymaster")
ACCOUNT_CLASS=$(declare_contract "ShieldedAccount")
LENDING_CLASS=$(declare_contract "MockLendingProtocol")

# ─── Deploy contracts ────────────────────────────────────────────────────────

echo -e "\n${CYAN}${BOLD}━━━ Deploying contracts ━━━${RESET}"

# MockERC20 (WBTC): decimals=8, initial_supply=1000000000000 (10 BTC), recipient=deployer
WBTC_ADDRESS=$(deploy_contract "MockERC20 (WBTC)" "$WBTC_CLASS" \
    "8" \
    "0x1000000000000" "0x0" \
    "$DEPLOYER")

# StubProofVerifier: no constructor args
VERIFIER_ADDRESS=$(deploy_contract "StubProofVerifier" "$VERIFIER_CLASS")

# CollateralVault: wbtc_token, owner
VAULT_ADDRESS=$(deploy_contract "CollateralVault" "$VAULT_CLASS" \
    "$WBTC_ADDRESS" \
    "$DEPLOYER")

# SessionKeyManager: no constructor args
SESSION_ADDRESS=$(deploy_contract "SessionKeyManager" "$SESSION_CLASS")

# Paymaster: owner
PAYMASTER_ADDRESS=$(deploy_contract "Paymaster" "$PAYMASTER_CLASS" \
    "$DEPLOYER")

# MockLendingProtocol: wbtc_token, vault
LENDING_ADDRESS=$(deploy_contract "MockLendingProtocol" "$LENDING_CLASS" \
    "$WBTC_ADDRESS" \
    "$VAULT_ADDRESS")

# ─── Post-deploy: set verifier on vault ──────────────────────────────────────

echo -e "\n${CYAN}${BOLD}━━━ Post-deploy configuration ━━━${RESET}"
info "Setting StubProofVerifier on CollateralVault..."
sncast --url "$RPC_URL" \
    --account "$DEPLOYER" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    invoke \
    --contract-address "$VAULT_ADDRESS" \
    --function "set_verifier" \
    --calldata "$VERIFIER_ADDRESS" \
    --fee-token strk \
    > /dev/null 2>&1 || warn "set_verifier call failed (may already be set)"
success "Verifier configured on vault"

# ─── Write deployment outputs ────────────────────────────────────────────────

echo -e "\n${CYAN}${BOLD}━━━ Saving deployment info ━━━${RESET}"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$DEPLOYMENT_DIR/devnet.json" <<EOF
{
  "network": "devnet",
  "timestamp": "$TIMESTAMP",
  "rpc": "$RPC_URL",
  "deployer": "$DEPLOYER",
  "contracts": {
    "wbtc": {
      "address": "$WBTC_ADDRESS",
      "class_hash": "$WBTC_CLASS"
    },
    "verifier": {
      "address": "$VERIFIER_ADDRESS",
      "class_hash": "$VERIFIER_CLASS"
    },
    "vault": {
      "address": "$VAULT_ADDRESS",
      "class_hash": "$VAULT_CLASS"
    },
    "session_manager": {
      "address": "$SESSION_ADDRESS",
      "class_hash": "$SESSION_CLASS"
    },
    "paymaster": {
      "address": "$PAYMASTER_ADDRESS",
      "class_hash": "$PAYMASTER_CLASS"
    },
    "shielded_account_class": {
      "class_hash": "$ACCOUNT_CLASS"
    },
    "lending": {
      "address": "$LENDING_ADDRESS",
      "class_hash": "$LENDING_CLASS"
    }
  }
}
EOF

cat > "$DEPLOYMENT_DIR/frontend.env.devnet" <<EOF
VITE_NETWORK=devnet
VITE_RPC_URL=$RPC_URL

VITE_WBTC_ADDRESS=$WBTC_ADDRESS
VITE_COLLATERAL_VAULT_ADDRESS=$VAULT_ADDRESS
VITE_STUB_VERIFIER_ADDRESS=$VERIFIER_ADDRESS
VITE_PAYMASTER_ADDRESS=$PAYMASTER_ADDRESS
VITE_SESSION_MANAGER_ADDRESS=$SESSION_ADDRESS
VITE_LENDING_ADDRESS=$LENDING_ADDRESS
VITE_SHIELDED_ACCOUNT_CLASS_HASH=$ACCOUNT_CLASS

VITE_ENABLE_SESSION_KEYS=true
VITE_ENABLE_PAYMASTER=true
EOF

success "deployment/devnet.json written"
success "deployment/frontend.env.devnet written"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}DEPLOYMENT COMPLETE${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  WBTC (MockERC20):    $WBTC_ADDRESS"
echo "  CollateralVault:     $VAULT_ADDRESS"
echo "  StubProofVerifier:   $VERIFIER_ADDRESS"
echo "  Paymaster:           $PAYMASTER_ADDRESS"
echo "  SessionKeyManager:   $SESSION_ADDRESS"
echo "  MockLendingProtocol: $LENDING_ADDRESS"
echo "  ShieldedAccount:     $ACCOUNT_CLASS  (class hash only)"
echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo "  1. cp deployment/frontend.env.devnet frontend/.env"
echo "  2. cd frontend && pnpm install && pnpm dev"
echo "  3. Open http://localhost:5173"
echo "  4. Connect Argent X (network: http://localhost:5050)"
echo ""
echo "  Or run the E2E demo:"
echo "  cd contracts && scarb run demo"
echo ""
