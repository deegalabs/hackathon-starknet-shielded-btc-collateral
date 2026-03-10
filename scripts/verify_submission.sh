#!/usr/bin/env bash
# =============================================================================
# verify_submission.sh — Pre-submission checklist for Starknet Re{define} 2026
# =============================================================================
# Verifies that all hackathon deliverables are in order before submission.
# Run from project root: bash scripts/verify_submission.sh
# =============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

PASS=0
WARN=0
FAIL=0

pass() { echo -e "  ${GREEN}✅ PASS${RESET}  $1"; PASS=$((PASS+1)); }
warn() { echo -e "  ${YELLOW}⚠️  WARN${RESET}  $1"; WARN=$((WARN+1)); }
fail() { echo -e "  ${RED}❌ FAIL${RESET}  $1"; FAIL=$((FAIL+1)); }
section() { echo -e "\n${CYAN}${BOLD}━━━ $1 ━━━${RESET}"; }

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Shielded BTC Collateral — Submission Verification       ║"
echo "║  Starknet Re{define} Hackathon 2026                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ─── 1. CONTRACTS ────────────────────────────────────────────────────────────
section "1. Cairo Contracts"

contracts=(
  "contracts/src/contracts/collateral_vault.cairo"
  "contracts/src/contracts/stub_proof_verifier.cairo"
  "contracts/src/accounts/shielded_account.cairo"
  "contracts/src/accounts/session_key_manager.cairo"
  "contracts/src/accounts/paymaster.cairo"
  "contracts/src/mocks/mock_erc20.cairo"
  "contracts/src/mocks/mock_lending_protocol.cairo"
)

for f in "${contracts[@]}"; do
  if [[ -f "$f" ]]; then
    pass "$f exists"
  else
    fail "$f MISSING"
  fi
done

# Verify H-07 fix: committed_amounts storage variable must not exist in vault
# (comments mentioning it as removed are OK)
if grep -v "^[[:space:]]*//" contracts/src/contracts/collateral_vault.cairo 2>/dev/null | grep -q "committed_amounts:"; then
  fail "H-07 NOT FIXED — committed_amounts storage variable still present in vault"
else
  pass "H-07 fixed — no plaintext committed_amounts storage in vault"
fi

# Verify cryptographic withdrawal
if grep -q "compute_commitment" contracts/src/contracts/collateral_vault.cairo 2>/dev/null; then
  pass "Cryptographic withdrawal — Poseidon preimage check present"
else
  fail "Cryptographic withdrawal — compute_commitment not found"
fi

# Verify nullifier forgery prevention
if grep -q "compute_nullifier" contracts/src/contracts/collateral_vault.cairo 2>/dev/null; then
  pass "Nullifier forgery prevention — compute_nullifier check present"
else
  fail "Nullifier forgery prevention — compute_nullifier not found"
fi

# ─── 2. BUILD ─────────────────────────────────────────────────────────────────
section "2. Cairo Build"

if command -v scarb &>/dev/null; then
  echo "  Building contracts..."
  if (cd contracts && scarb build 2>&1 | tail -3); then
    pass "scarb build succeeded"
  else
    fail "scarb build FAILED"
  fi
else
  warn "scarb not found — skipping build check"
fi

# ─── 3. TESTS ─────────────────────────────────────────────────────────────────
section "3. Test Suite"

if command -v snforge &>/dev/null; then
  echo "  Running tests..."
  TEST_OUTPUT=$(cd contracts && snforge test 2>&1 | tail -5)
  echo "$TEST_OUTPUT" | head -3

  if echo "$TEST_OUTPUT" | grep -q "0 failed"; then
    TOTAL=$(echo "$TEST_OUTPUT" | grep -oP '\d+ passed' | grep -oP '\d+')
    pass "All tests pass ($TOTAL tests)"
  else
    fail "Tests have failures"
  fi
else
  warn "snforge not found — skipping test check"
fi

# ─── 4. FRONTEND ──────────────────────────────────────────────────────────────
section "4. Frontend"

frontend_files=(
  "frontend/src/pages/Dashboard.tsx"
  "frontend/src/pages/Vault.tsx"
  "frontend/src/pages/Lending.tsx"
  "frontend/src/pages/Paymaster.tsx"
  "frontend/src/pages/AccountSetup.tsx"
  "frontend/src/hooks/useVault.ts"
  "frontend/src/lib/abis.ts"
  "frontend/package.json"
)

for f in "${frontend_files[@]}"; do
  if [[ -f "$f" ]]; then
    pass "$f exists"
  else
    fail "$f MISSING"
  fi
done

# Verify frontend ABI matches contract changes (no committed_amounts function, new withdraw sig)
# (comments documenting removal are OK)
if grep -v "^[[:space:]]*//" frontend/src/lib/abis.ts 2>/dev/null | grep -q '"get_committed_amount"'; then
  fail "Frontend ABI still has get_committed_amount function — not synced with H-07 fix"
else
  pass "Frontend ABI synced — get_committed_amount removed"
fi

if grep -q '"secret"' frontend/src/lib/abis.ts 2>/dev/null; then
  pass "Frontend ABI has secret param in withdraw"
else
  warn "Frontend ABI may not have secret param in withdraw"
fi

# ─── 5. DOCUMENTATION ─────────────────────────────────────────────────────────
section "5. Documentation"

docs=(
  "README.md"
  "MVP.md"
  "ARCHITECTURE.md"
  "SECURITY.md"
  "ROADMAP.md"
  "docs/DEPLOYMENT.md"
)

for f in "${docs[@]}"; do
  if [[ -f "$f" ]]; then
    pass "$f exists"
  else
    fail "$f MISSING"
  fi
done

# Check SECURITY.md is v3.0
if grep -q "Version.*3.0\|v3.0" SECURITY.md 2>/dev/null; then
  pass "SECURITY.md is v3.0 (post H-07)"
else
  warn "SECURITY.md may not be updated to v3.0"
fi

# Check README mentions 68 tests
if grep -qE "68.*test|test.*68" README.md 2>/dev/null; then
  pass "README mentions 68 tests"
else
  warn "README may not mention 68 tests"
fi

# ─── 6. DEPLOYMENT SCRIPTS ────────────────────────────────────────────────────
section "6. Deployment Scripts"

if [[ -f "scripts/deploy_sepolia.sh" ]]; then
  pass "scripts/deploy_sepolia.sh exists"
else
  fail "scripts/deploy_sepolia.sh MISSING"
fi

if [[ -f "scripts/demo.ts" ]]; then
  pass "scripts/demo.ts exists"
else
  fail "scripts/demo.ts MISSING"
fi

if [[ -f "scripts/deployment/.gitkeep" ]] || [[ -d "scripts/deployment" ]]; then
  pass "scripts/deployment/ directory exists"
else
  warn "scripts/deployment/ directory not found"
fi

if [[ -f "scripts/deployment/sepolia.json" ]]; then
  pass "scripts/deployment/sepolia.json exists — Sepolia deployed"
else
  warn "scripts/deployment/sepolia.json not found — run deploy_sepolia.sh to deploy to Sepolia"
fi

# ─── 7. PRIVACY MODEL ─────────────────────────────────────────────────────────
section "7. Privacy Model Audit"

# 1. committed_amounts not in vault
if ! grep -q "committed_amounts" contracts/src/contracts/collateral_vault.cairo 2>/dev/null; then
  pass "No plaintext amount storage in vault"
fi

# 2. get_committed_amount not as a function in interface (comments OK)
if grep -v "^[[:space:]]*//" contracts/src/interfaces/icollateral_vault.cairo 2>/dev/null | grep -q "fn get_committed_amount"; then
  fail "get_committed_amount fn still in interface — H-07 incomplete"
else
  pass "get_committed_amount fn removed from interface"
fi

# 3. prove_collateral takes proof param
if grep -q "prove_collateral.*proof\|proof.*Span" contracts/src/interfaces/icollateral_vault.cairo 2>/dev/null; then
  pass "prove_collateral interface has proof parameter"
else
  warn "prove_collateral may not have proof parameter"
fi

# 4. withdraw takes secret param
if grep -q "fn withdraw.*secret\|secret.*felt252" contracts/src/contracts/collateral_vault.cairo 2>/dev/null; then
  pass "withdraw has secret parameter (cryptographic preimage)"
else
  fail "withdraw does not have secret parameter"
fi

# 5. Events don't emit amount
if grep -A5 "fn deposit" contracts/src/contracts/collateral_vault.cairo 2>/dev/null | grep -q "emit.*amount"; then
  warn "deposit event may emit amount — verify privacy"
else
  pass "deposit event does not emit plaintext amount"
fi

# ─── 8. JUDGE EVALUATION ──────────────────────────────────────────────────────
section "8. Judge Evaluation Files"

if [[ -f "temp/judge-evaluation.md" ]]; then
  pass "temp/judge-evaluation.md (v1 — 79/100) exists"
else
  warn "temp/judge-evaluation.md not found"
fi

if [[ -f "temp/judge-evaluation-v2.md" ]]; then
  pass "temp/judge-evaluation-v2.md (v2 — 83/100) exists"
else
  fail "temp/judge-evaluation-v2.md MISSING"
fi

# ─── 9. GIT STATUS ────────────────────────────────────────────────────────────
section "9. Git Status"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [[ "$UNCOMMITTED" -eq 0 ]]; then
  pass "All changes committed"
else
  warn "$UNCOMMITTED uncommitted change(s) — consider committing before submission"
fi

LOG=$(git log --oneline -5 2>/dev/null)
echo -e "\n  Recent commits:"
echo "$LOG" | while read -r line; do echo "    $line"; done

# ─── SUMMARY ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}SUBMISSION VERIFICATION SUMMARY${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  ${GREEN}✅ PASSED:${RESET}  $PASS"
echo -e "  ${YELLOW}⚠️  WARNED:${RESET}  $WARN"
echo -e "  ${RED}❌ FAILED:${RESET}  $FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}${BOLD}  ⛔ NOT READY FOR SUBMISSION — fix $FAIL failure(s) above${RESET}"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "${YELLOW}${BOLD}  ⚠️  SUBMISSION READY WITH WARNINGS — resolve $WARN warning(s) for best results${RESET}"
  echo ""
  echo "  Key actions before deadline:"
  echo "  1. Run: bash scripts/deploy_sepolia.sh  (add live Sepolia addresses)"
  echo "  2. Record 3-min demo video of deposit flow"
  exit 0
else
  echo -e "${GREEN}${BOLD}  🚀 READY FOR SUBMISSION — all checks passed${RESET}"
  exit 0
fi
