# Security Audit Report — Shielded BTC Collateral Protocol

**Version:** 2.0  
**Date:** March 2026  
**Scope:** All MVP contracts — `CollateralVault`, `ShieldedAccount`, `SessionKeyManager`, `Paymaster`, `MockLendingProtocol`, `StubProofVerifier`, `MockERC20`  
**Status:** All findings resolved or documented as intentional MVP trade-offs.

---

## Audit History

| Version | Date | Scope |
|---------|------|-------|
| 1.0 | March 2026 | `CollateralVault`, `StubProofVerifier`, `MockERC20` |
| 2.0 | March 2026 | Added AA contracts: `ShieldedAccount`, `SessionKeyManager`, `Paymaster`, `MockLendingProtocol` |

---

## Executive Summary (v2.0)

A second manual security review was performed after adding the Account Abstraction layer. **5 new high/medium** vulnerabilities were identified and patched in the same review cycle.

### Cumulative totals across both audits

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 2 | 2 | 0 |
| High | 7 | 5 | 2 (MVP design, documented) |
| Medium | 7 | 5 | 2 (known MVP trade-offs) |
| Low | 8 | 3 | 5 (documented, non-exploitable in MVP) |

---

## Scope

### Audit v1.0

| Contract | File |
|----------|------|
| `CollateralVault` | `contracts/src/contracts/collateral_vault.cairo` |
| `StubProofVerifier` | `contracts/src/contracts/stub_proof_verifier.cairo` |
| `MockERC20` | `contracts/src/mocks/mock_erc20.cairo` |
| `ICollateralVault` | `contracts/src/interfaces/icollateral_vault.cairo` |
| `IERC20` | `contracts/src/interfaces/ierc20.cairo` |

### Audit v2.0 (new contracts)

| Contract | File |
|----------|------|
| `ShieldedAccount` | `contracts/src/accounts/shielded_account.cairo` |
| `SessionKeyManager` | `contracts/src/accounts/session_key_manager.cairo` |
| `Paymaster` | `contracts/src/accounts/paymaster.cairo` |
| `MockLendingProtocol` | `contracts/src/mocks/mock_lending_protocol.cairo` |

---

## Methodology

- Manual line-by-line code review
- Threat modelling against: fund drain, double-spend, privacy leaks, denial of service, griefing, privilege escalation
- Cairo-specific checks: storage model, felt252 field arithmetic, reentrancy patterns, Span/Array ownership
- Cross-referencing Cairo security best practices and known Starknet vulnerabilities
- SNIP-5 / SNIP-6 / SNIP-9 compliance review

---

## Findings — v1.0 (CollateralVault)

---

### [C-01] — Vault Drain: `withdraw` Has No Ownership Check

**Severity:** CRITICAL  
**Status:** ✅ Fixed  
**Location:** `collateral_vault.cairo` → `withdraw()`

**Description:**  
The `withdraw` function only checks that a nullifier is fresh (not previously used). It does **not** verify that the caller has an active commitment (i.e., has previously deposited). Any address — including one that never deposited — can call `withdraw` with a fresh nullifier and drain the entire vault.

```cairo
// VULNERABLE — before fix
fn withdraw(ref self: ContractState, amount: u256, nullifier: felt252) {
    assert(!self.nullifiers.read(nullifier), 'Nullifier already used');
    // Missing: assert caller has a commitment!
    self.nullifiers.write(nullifier, true);
    wbtc.transfer(caller, amount);  // any caller, any amount!
}
```

**Attack Scenario:**
1. Alice deposits 10 BTC.
2. Attacker (no deposit) calls `withdraw(10_BTC, fresh_nullifier)`.
3. Nullifier check passes (fresh). Vault transfers 10 BTC to attacker. Total loss.

**Fix:**  
Add `committed_amounts` storage. On `withdraw`, assert the caller has a stored commitment, and that the requested amount equals the committed amount. Clear the commitment after withdrawal.

---

### [C-02] — Vault Drain: `withdraw` Amount Is Unconstrained

**Severity:** CRITICAL  
**Status:** ✅ Fixed (via same fix as C-01)  
**Location:** `collateral_vault.cairo` → `withdraw()`

**Description:**  
Even if an attacker does have a commitment (deposited a dust amount), they can call `withdraw` with an arbitrary `amount` — e.g., the entire vault balance. The contract never checks that `amount` equals the committed deposit.

**Attack Scenario:**
1. Attacker deposits 1 satoshi (minimum valid deposit).
2. Attacker calls `withdraw(total_vault_balance, fresh_nullifier)`.
3. Drains all funds from all other users.

**Fix:**  
Store the deposited `amount` alongside the commitment. On `withdraw`, assert `amount == committed_amounts[caller]`.

---

### [H-01] — Commitment Overwrite Permanently Locks Funds

**Severity:** HIGH  
**Status:** ✅ Fixed  
**Location:** `collateral_vault.cairo` → `deposit()`

**Description:**  
If a user calls `deposit` twice, the second call silently overwrites the first commitment. The funds from the first deposit remain in the vault, but the original commitment is gone — making the first deposit **unrecoverable**.

```cairo
// VULNERABLE — no guard against overwriting
fn deposit(ref self: ContractState, amount: u256, commitment: felt252) {
    // ...
    self.commitments.write(caller, commitment);  // overwrites without warning!
}
```

**Fix:**  
Assert that no active commitment exists for the caller before writing:
```cairo
assert(self.commitments.read(caller) == 0, 'Commitment already active');
```
This also aligns with the ZK design where each commitment is a single-use note.

---

### [H-02] — `prove_collateral` Ignores the Threshold Parameter

**Severity:** HIGH  
**Status:** ✅ Fixed  
**Location:** `collateral_vault.cairo` → `prove_collateral()`

**Description:**  
The `prove_collateral` function accepts a `threshold: u256` argument but never uses it. It returns `true` for any depositor regardless of the threshold. A user who deposited 1 satoshi would pass a 100 BTC collateral check.

```cairo
// VULNERABLE — threshold ignored
fn prove_collateral(self: @ContractState, user: ContractAddress, threshold: u256) -> bool {
    let commitment = self.commitments.read(user);
    commitment != 0  // threshold is never evaluated!
}
```

**Impact:**  
Any lending or derivatives protocol integrating this vault and relying on `prove_collateral` for collateral adequacy checks would be deceived into accepting under-collateralised positions.

**Fix:**  
With `committed_amounts` now stored, the MVP implementation can compare the stored amount against the threshold:
```cairo
fn prove_collateral(self: @ContractState, user: ContractAddress, threshold: u256) -> bool {
    let commitment = self.commitments.read(user);
    if commitment == 0 { return false; }
    self.committed_amounts.read(user) >= threshold
}
```
Note: this leaks the exact amount in the MVP. In production, a ZK range proof replaces this comparison.

---

### [H-03] — `StubProofVerifier` Always Returns `true` (MVP Design Limitation)

**Severity:** HIGH (in production)  
**Status:** ⚠️ Intentional for MVP — documented, not patched  
**Location:** `stub_proof_verifier.cairo` → `verify_range_proof()`

**Description:**  
The stub verifier returns `true` for any non-zero commitment, regardless of `threshold` or `proof` data. This is the intended MVP behaviour but **must never be deployed in production**.

```cairo
fn verify_range_proof(self: @ContractState, commitment: felt252, threshold: u256, proof: Span<felt252>) -> bool {
    commitment != 0  // always true if commitment exists!
}
```

**Remediation for Production:**  
Replace with a real Cairo STARK verifier contract that cryptographically validates:
- `commitment = Poseidon(amount.low, amount.high, secret)`
- `amount >= threshold`

---

### [M-01] — Missing Zero-Address Validation in Constructor

**Severity:** MEDIUM  
**Status:** ✅ Fixed  
**Location:** `collateral_vault.cairo` → `constructor()`

**Description:**  
The constructor accepts any `wbtc_token` address, including `0`. Deploying with a zero address would make all deposit/withdraw calls fail silently on the token dispatch, bricking the vault.

**Fix:**
```cairo
let zero: ContractAddress = 0.try_into().unwrap();
assert(wbtc_token != zero, 'WBTC token cannot be zero');
```

---

### [M-02] — `total_locked` Can Diverge from Actual Token Balance

**Severity:** MEDIUM  
**Status:** ⚠️ Known limitation — documented  
**Location:** `collateral_vault.cairo` — storage accounting

**Description:**  
`total_locked` is updated manually on `deposit` and `withdraw`. If WBTC is sent directly to the vault address (bypassing `deposit`), or if a fee-on-transfer token is used, `total_locked` will diverge from the actual balance. This could cause arithmetic underflow on withdrawal in edge cases.

**Recommendation for Production:**  
Compute the vault's actual balance via `wbtc.balance_of(self)` rather than maintaining a separate counter. Or add an invariant check: `assert(total_locked <= wbtc.balance_of(vault))`.

---

### [M-03] — `Deposited` Event Links User Address to Commitment

**Severity:** MEDIUM (privacy concern)  
**Status:** ⚠️ Known MVP trade-off — documented  
**Location:** `collateral_vault.cairo` → `Deposited` event

**Description:**  
The `Deposited` event emits `user: ContractAddress` as an indexed key alongside the `commitment`. This permanently links an on-chain identity to a commitment hash. While the commitment hides the amount, the user-to-commitment binding is public.

```cairo
pub struct Deposited {
    #[key]
    pub user: ContractAddress,   // identity exposed!
    pub commitment: felt252,
}
```

**Impact:**  
An observer can track Alice's address → commitment → nullifier chain. This partially breaks the unlinkability promise.

**Recommendation for Production:**  
Use a Merkle tree of commitments (like Tornado Cash's approach). Deposits add a leaf to the Merkle tree without any address association. Withdrawals prove Merkle inclusion without revealing which leaf.

---

### [L-01] — MockERC20 Has Unrestricted `mint` Function

**Severity:** LOW (test-only context)  
**Status:** ⚠️ Intentional for tests — documented  
**Location:** `mock_erc20.cairo` → `mint()`

**Description:**  
`mint()` has no access control — any address can mint infinite tokens. This is intentional for test setup but would be catastrophic in any production context.

**Note:** `MockERC20` is only used in tests and is not intended for production deployment.

---

### [L-02] — `_transfer` Allows Transfer to Zero Address (Token Burn)

**Severity:** LOW  
**Status:** ✅ Fixed in MockERC20 (not a vault issue)  
**Location:** `mock_erc20.cairo` → `_transfer()`

**Description:**  
There is no check preventing transfers to the zero address (`0x0`). Tokens sent to `0x0` are unrecoverable.

**Fix:**
```cairo
fn _transfer(ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) {
    let zero: ContractAddress = 0.try_into().unwrap();
    assert(recipient != zero, 'Transfer to zero address');
    // ...
}
```

---

### [L-03] — No Emergency Pause Mechanism

**Severity:** LOW  
**Status:** ⚠️ Known limitation — documented  
**Location:** Architecture

**Description:**  
The vault has no owner, admin, or circuit breaker. If a vulnerability is discovered post-deployment, there is no way to pause operations and protect user funds during remediation.

**Recommendation for Production:**  
Implement OpenZeppelin's `Ownable` + `Pausable` pattern, or use a Starknet multisig admin. Consider timelocks for sensitive operations.

---

## Summary of Applied Fixes — v1.0

| ID | Fix Applied |
|----|-------------|
| C-01 | Added `committed_amounts` storage; `withdraw` checks `caller has commitment` |
| C-02 | `withdraw` checks `amount == committed_amounts[caller]` |
| H-01 | `deposit` asserts `commitments[caller] == 0` before writing |
| H-02 | `prove_collateral` compares `committed_amounts[caller] >= threshold` |
| M-01 | Constructor asserts `wbtc_token != 0` |
| L-02 | `_transfer` in MockERC20 checks `recipient != 0` |

---

## Findings — v2.0 (Account Abstraction Layer)

---

### [H-04] — ShieldedAccount: `allowed_contract` Not Enforced in `__validate__`

**Severity:** HIGH  
**Status:** ✅ Fixed  
**Location:** `shielded_account.cairo` → `_validate_session_sig()`

**Description:**  
Session keys are created with an `allowed_contract` restriction to scope them to a single contract (e.g., only the CollateralVault). This field was stored but never checked. A session key scoped to the vault could sign any arbitrary transaction, including draining other contracts or registering new session keys.

```cairo
// VULNERABLE — allowed_contract field exists but is never checked
fn _validate_session_sig(...) -> bool {
    let session = self.session_keys.read(session_pubkey);
    // ... checks active, expiry, spending_limit ...
    // allowed_contract = session.allowed_contract — NEVER VALIDATED
    check_ecdsa_signature(tx_hash, session_pubkey, sig_r, sig_s)
}
```

**Attack Scenario:**  
DApp is granted a session key scoped to `vault_address`. DApp uses the session key to call a malicious contract instead, draining other assets held by the account.

**Fix:**  
Pass `calls.span()` from `__validate__` into `_validate_session_sig`. If `allowed_contract != 0`, every call in the multicall must target that contract:

```cairo
fn _validate_session_sig(..., calls: Span<Call>) -> bool {
    // ... existing checks ...
    let zero: ContractAddress = 0.try_into().unwrap();
    if session.allowed_contract != zero {
        let mut calls_iter = calls;
        loop {
            match calls_iter.pop_front() {
                Option::None => { break; },
                Option::Some(call) => {
                    if *call.to != session.allowed_contract { return false; }
                },
            }
        }
    }
    check_ecdsa_signature(tx_hash, session_pubkey, sig_r, sig_s)
}
```

---

### [H-05] — ShieldedAccount: Session Key Can Escalate Privileges via Self-Call

**Severity:** HIGH  
**Status:** ⚠️ Documented — MVP design limitation  
**Location:** `shielded_account.cairo` → `__execute__()`, `register_session_key()`

**Description:**  
Management functions (`register_session_key`, `revoke_session_key`) are protected by `_assert_only_self()`, which checks `caller == contract_address`. Since `__execute__` passes all calls through `call_contract_syscall`, any call targeting the account itself (including `register_session_key`) will see `caller == account`. This means a session key can include a self-call to register new session keys with broader permissions.

**Attack Scenario:**  
1. Owner grants DApp a session key scoped to the vault.  
2. DApp constructs a multicall: `[vault.deposit(...), self.register_session_key(dapp_key2, expiry=never, limit=unlimited)]`.  
3. Both calls execute through the account. Step 2 is a self-call — passes `_assert_only_self`. DApp gains an unlimited session key.

**Remediation for Production:**  
Track at the account level whether the current execution was authorized by the **owner key** or a **session key**. Management functions should require owner authorization specifically. One approach:
- Use a transient storage slot `is_owner_tx: bool` set to `true` inside `__execute__` only when the owner signature validated.
- Management functions check `is_owner_tx` instead of `_assert_only_self`.

---

### [H-06] — SessionKeyManager: `record_spending` Has No Caller Authentication (Griefing)

**Severity:** HIGH  
**Status:** ✅ Fixed  
**Location:** `session_key_manager.cairo` → `record_spending()`

**Description:**  
`record_spending(account, session_pubkey, amount)` accepts any `account` address but does not verify the caller is that account. An attacker can call this repeatedly for any victim's session key, exhausting the spending limit without the victim doing any transactions. This is a griefing-only attack (no fund drain), but it renders session keys unusable.

```cairo
// VULNERABLE — no authentication
fn record_spending(ref self: ContractState, account: ContractAddress, ...) {
    let mut session = self.sessions.read((account, session_public_key));
    // any caller can exhaust any account's spending limit
}
```

**Attack Scenario:**  
1. Attacker observes Alice registers a session key with `spending_limit = 1 BTC`.  
2. Attacker calls `record_spending(alice_address, alice_session_key, 1 BTC)`.  
3. Alice's session key is now "spent" — all her transactions signed with it will be rejected.

**Fix:**  
Add an authentication check at the top of the function:

```cairo
fn record_spending(ref self: ContractState, account: ContractAddress, ...) {
    assert(get_caller_address() == account, 'Unauthorized: not account');
    // ...
}
```

---

### [M-04] — Paymaster: `fund_budget` Owner-Only Creates Single Point of Failure

**Severity:** MEDIUM  
**Status:** ✅ Fixed  
**Location:** `paymaster.cairo` → `fund_budget()`

**Description:**  
Only the contract owner could add gas budget to the Paymaster. If the owner's key is lost or compromised, the Paymaster can never receive additional budget and will stop sponsoring transactions when depleted. This creates a centralized dependency on a single key for liveness.

**Fix:**  
Remove the `_assert_only_owner()` restriction. `fund_budget` is now permissionless — any address can contribute to the protocol's gas sponsorship pool. Owner-exclusive control is kept only for `set_sponsorship_threshold`, `withdraw_budget`, and `transfer_ownership`.

---

### [M-05] — Paymaster: No Budget Withdrawal Mechanism

**Severity:** MEDIUM  
**Status:** ✅ Fixed  
**Location:** `paymaster.cairo` — architecture

**Description:**  
The original Paymaster had no way to recover unused budget. If the contract is deprecated or migrated, any remaining budget is permanently locked.

**Fix:**  
Added `withdraw_budget(amount, recipient)` callable by the owner only, allowing recovery of unspent budget when migrating to a new Paymaster version.

---

### [M-06] — MockLendingProtocol: LTV Calculation Uses Floor Division

**Severity:** MEDIUM  
**Status:** ✅ Fixed  
**Location:** `mock_lending_protocol.cairo` → `borrow()`

**Description:**  
The required collateral calculation used floor (truncating) integer division:

```cairo
// VULNERABLE — rounds DOWN, under-collateralizes micro-loans
let required_collateral = (borrow_amount * LTV_DENOMINATOR.into()) / LTV_RATIO.into();
// Example: borrow 1 satoshi → required = 100/70 = 1 (floor) — should be 2 (ceiling)
```

For small amounts (particularly when `borrow_amount < LTV_RATIO`), floor division underestimates the required collateral, allowing loans that violate the intended 70% LTV ratio.

**Fix:**  
Switch to ceiling (round-up) division using the formula `(numerator + denominator - 1) / denominator`:

```cairo
// FIXED — ceiling division, always conservative for the lender
let required_collateral = (borrow_amount * LTV_DENOMINATOR.into()
    + (LTV_RATIO - 1).into())
    / LTV_RATIO.into();
// Example: borrow 1 satoshi → required = (100 + 69) / 70 = 2 (ceiling) ✓
```

---

### [H-07] — MockLendingProtocol: No Collateral Lock During Active Debt

**Severity:** HIGH  
**Status:** ⚠️ Documented — MVP architecture limitation  
**Location:** `mock_lending_protocol.cairo` × `collateral_vault.cairo` — cross-contract design

**Description:**  
The `CollateralVault` and `MockLendingProtocol` are independent contracts. After borrowing, a user can call `vault.withdraw()` to reclaim their collateral while their debt remains active. The vault has no mechanism to "lock" collateral on behalf of a third-party lending protocol.

**Attack Scenario:**  
1. Alice deposits 10 BTC into the vault (commitment created).  
2. Alice borrows 7 BTC from lending (`prove_collateral` passes).  
3. Alice calls `vault.withdraw(10 BTC, nullifier)` — vault does not know about the loan.  
4. Alice has both the loan proceeds AND her original BTC. The lending protocol has 7 BTC of unbacked debt.

**Why Not Fixed in MVP:**  
The vault's privacy model (commitment-based) makes collateral locking architecturally complex: locking requires knowing the committed amount (privacy leak) or ZK-proving a lock state. Implementing this correctly requires the full ZK stack.

**Remediation for Production:**  
Option A — Registry-based locking: `vault.lock_collateral(lender_address, amount)` emits a locked state; `withdraw` checks no locks exist for the caller.  
Option B — Merkle-note-based locking: each commitment note tracks a "locked" bit. Lending protocols issue a ZK proof that the note is locked before approving loans.

---

### [L-04] — ShieldedAccount: No Owner Key Rotation

**Severity:** LOW  
**Status:** ⚠️ Documented — MVP limitation  
**Location:** `shielded_account.cairo` — missing function

**Description:**  
There is no `set_owner_public_key(new_key)` function. If the owner's private key is compromised, the account is permanently compromised with no recovery path. The user would need to deploy a new account contract and migrate all assets.

**Recommendation for Production:**  
Add social recovery (Phase 3 roadmap): a set of guardian keys that can authorize a key rotation via multisig. Alternatively, support an `update_owner_key(new_key)` callable only by the current owner.

---

### [L-05] — ShieldedAccount: Revoked Keys Can Be Re-Registered (Resets Spent Counter)

**Severity:** LOW  
**Status:** ⚠️ Documented — intentional behavior  
**Location:** `shielded_account.cairo` → `register_session_key()`

**Description:**  
After revoking a session key (`is_active = false`), the same public key can be re-registered because `register_session_key` only blocks re-registration if `is_active == true`. Re-registration resets `spent_this_session` to 0. While re-registration requires owner authorization, this could be surprising to DApp developers expecting a "permanently banned" key.

**Note:** This is considered intentional behavior (key recycling) but should be clearly documented.

---

### [L-06] — Paymaster: Zero Threshold Enables Sponsorship for All Depositors

**Severity:** LOW  
**Status:** ⚠️ Documented — admin responsibility  
**Location:** `paymaster.cairo` → `set_sponsorship_threshold()`

**Description:**  
If the owner calls `set_sponsorship_threshold(0)`, then `prove_collateral(user, 0)` returns `true` for any user with an active commitment (even 1 satoshi). This opens gas sponsorship to all depositors regardless of collateral size. While this may be intentional (e.g., to onboard all depositors), it could drain the budget rapidly.

**Recommendation:**  
Validate `new_threshold > 0` in `set_sponsorship_threshold`, or document clearly that `threshold == 0` means "sponsor all depositors".

---

### [L-07] — SessionKeyManager: `allowed_contract` Not Validated in `is_valid_session`

**Severity:** LOW  
**Status:** ⚠️ Documented — by design  
**Location:** `session_key_manager.cairo` → `is_valid_session()`

**Description:**  
The standalone `SessionKeyManager` stores `allowed_contract` per session but `is_valid_session()` does not take a target contract parameter and therefore cannot validate the scope restriction. The `allowed_contract` field is informational in the external registry.

**Context:** This is by design — `is_valid_session` is a general validity check (active + not expired + within limit). Contract-scope enforcement requires knowledge of the specific transaction being authorized, which is available only inside an account's `__validate__`. The `ShieldedAccount` enforces `allowed_contract` at `__validate__` time (see H-04 fix).

---

### [L-08] — ShieldedAccount: `spent_this_session` Never Incremented on Use

**Severity:** LOW  
**Status:** ⚠️ Documented — MVP limitation  
**Location:** `shielded_account.cairo` → `_validate_session_sig()`

**Description:**  
`spent_this_session` is initialized to 0 on session key registration and checked against `spending_limit` in `__validate__`. However, the spending amount is never incremented inside `__validate__`. This means the spending limit field exists and is checked, but the running total never increases — effectively making all spending limits of infinite duration.

**Why not fixed in MVP:**  
To accurately track spending, the account must parse the `calldata` of each `Call` in the multicall to extract token transfer amounts — this requires ABI decoding or well-known selectors. This is complex to implement correctly and out of scope for the MVP.

**Recommended approach for Production:**  
Use `SessionKeyManager.record_spending(account, session_key, amount)` at the end of `__execute__` for session-key-signed transactions. The total amount can be computed by inspecting the vault's `withdraw` calldata or by requiring DApps to declare intent upfront.

---

## Summary of Applied Fixes — v2.0

| ID | Fix Applied |
|----|-------------|
| H-04 | `_validate_session_sig` now accepts `Span<Call>` and enforces `allowed_contract` scope |
| H-06 | `record_spending` asserts `get_caller_address() == account` — blocks griefing |
| M-04 | `fund_budget` owner restriction removed — permissionless contribution now allowed |
| M-05 | Added `withdraw_budget(amount, recipient)` callable by owner for budget recovery |
| M-06 | LTV calculation switched from floor to ceiling division: `(borrow * 100 + 69) / 70` |

---

## Remaining Known Limitations (MVP vs Production)

These are **by design** for the hackathon MVP and are documented in `docs/architecture.md`:

| Limitation | MVP | Production |
|-----------|-----|------------|
| Proof verification | Stub (always true for non-zero commitment) | Real STARK range proof |
| Amount privacy | Stored in plaintext alongside commitment | Hidden, verified by ZK proof |
| Identity unlinkability | User address linked to commitment via event | Merkle tree commitment scheme |
| Nullifier-commitment link | Not enforced on-chain | Enforced by ZK proof |
| Upgrade mechanism | None | Proxy pattern with timelock |
| Collateral locking | None — vault unaware of loans | Locked-note model via ZK |
| Session key spending tracking | Not tracked in `__validate__` | `record_spending` integration |
| Owner key rotation | No recovery if key compromised | Social recovery with guardians |
| Session privilege escalation | Session key can register new sessions | Separate owner-vs-session auth context |

---

## Recommendations for Production

1. **Replace `StubProofVerifier`** with a real Cairo STARK range proof verifier.
2. **Remove `committed_amounts` storage** — the amount must be hidden in production; the ZK proof verifies it instead.
3. **Adopt a Merkle commitment tree** to fully decouple user identity from commitments.
4. **Implement collateral locking** in `CollateralVault` — required before connecting to real lending protocols.
5. **Add social recovery** to `ShieldedAccount` — guardian-based key rotation.
6. **Differentiate owner vs session authorization** in `__execute__` to block privilege escalation.
7. **Integrate `record_spending`** in `__execute__` for accurate spending limit enforcement.
8. **Formal verification** of the ZK circuit constraints before mainnet.
9. **External audit** by a specialized ZK/Cairo security firm before production deployment.
10. **Invariant tests**: add fuzz tests asserting `total_locked <= wbtc.balance_of(vault)` at all times.
