use core::poseidon::poseidon_hash_span;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use shielded_btc_collateral::interfaces::icollateral_vault::{
    ICollateralVaultDispatcher, ICollateralVaultDispatcherTrait,
};
use shielded_btc_collateral::interfaces::icollateral_vault_admin::{
    ICollateralVaultAdminDispatcher, ICollateralVaultAdminDispatcherTrait,
};
use shielded_btc_collateral::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

// =========================================================================
// Test helper: minimal interface for mock-only functions
// =========================================================================

#[starknet::interface]
trait IMockERC20<TContractState> {
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

// =========================================================================
// Deploy helpers
// =========================================================================

fn deploy_mock_wbtc() -> ContractAddress {
    let contract = declare("MockERC20").unwrap().contract_class();
    let calldata = array![8_u8.into()];
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

fn deploy_vault(wbtc_address: ContractAddress) -> ContractAddress {
    let contract = declare("CollateralVault").unwrap().contract_class();
    let owner: ContractAddress = 0x4AD.try_into().unwrap();
    let calldata = array![wbtc_address.into(), owner.into()];
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

// =========================================================================
// Cryptographic helpers — match the contract's internal functions
// =========================================================================

fn make_commitment(amount: u256, secret: felt252) -> felt252 {
    poseidon_hash_span(array![amount.low.into(), amount.high.into(), secret].span())
}

/// Nullifier = Poseidon(commitment, secret) — matches the updated contract.
fn make_nullifier(commitment: felt252, secret: felt252) -> felt252 {
    poseidon_hash_span(array![commitment, secret].span())
}

// =========================================================================
// Test accounts
// =========================================================================

fn alice() -> ContractAddress {
    0xAA.try_into().unwrap()
}

fn bob() -> ContractAddress {
    0xBB.try_into().unwrap()
}

fn attacker() -> ContractAddress {
    0xDEAD.try_into().unwrap()
}

// =========================================================================
// Setup helper: mint WBTC to user and approve vault
// =========================================================================

fn fund_and_approve(
    wbtc: ContractAddress, vault: ContractAddress, user: ContractAddress, amount: u256,
) {
    let mock = IMockERC20Dispatcher { contract_address: wbtc };
    mock.mint(user, amount);

    let erc20 = IERC20Dispatcher { contract_address: wbtc };
    start_cheat_caller_address(wbtc, user);
    erc20.approve(vault, amount);
    stop_cheat_caller_address(wbtc);
}

// =========================================================================
// DEPOSIT TESTS
// =========================================================================

#[test]
fn test_deposit_stores_commitment() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 10_00000000_u256;
    let secret = 0xdeadbeef_felt252;
    let commitment = make_commitment(amount, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_commitment(alice()) == commitment, 'Commitment not stored');
}

/// [H-07 Fix] No plaintext amount is stored — only the Poseidon commitment.
/// This test validates the privacy model: get_committed_amount does NOT exist.
/// The commitment is the ONLY on-chain representation of the deposited value.
#[test]
fn test_deposit_stores_commitment_only_no_plaintext() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 5_00000000_u256;
    let secret = 0xabc_felt252;
    let commitment = make_commitment(amount, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Verify commitment is stored (cryptographic binding to amount)
    assert(vault.get_commitment(alice()) == commitment, 'Commitment must be stored');

    // Verify vault holds WBTC (tokens are locked)
    let erc20 = IERC20Dispatcher { contract_address: wbtc };
    assert(erc20.balance_of(vault_addr) == amount, 'Vault must hold WBTC');

    // Verify total_locked is updated (aggregate, non-private)
    assert(vault.get_total_locked() == amount, 'Total locked must equal deposit');
}

#[test]
fn test_deposit_transfers_wbtc_to_vault() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let erc20 = IERC20Dispatcher { contract_address: wbtc };

    let amount = 5_00000000_u256;
    let commitment = make_commitment(amount, 0x1234_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(erc20.balance_of(vault_addr) == amount, 'Vault should hold WBTC');
    assert(erc20.balance_of(alice()) == 0_u256, 'Alice balance should be 0');
}

#[test]
fn test_deposit_updates_total_locked() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 3_00000000_u256;
    let commitment = make_commitment(amount, 0x5678_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    assert(vault.get_total_locked() == 0_u256, 'Should start at zero');

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_total_locked() == amount, 'Total should equal deposit');
}

#[test]
#[should_panic(expected: 'Amount must be positive')]
fn test_deposit_zero_amount_fails() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(0_u256, 0x1234_felt252);
    stop_cheat_caller_address(vault_addr);
}

#[test]
#[should_panic(expected: 'Commitment cannot be zero')]
fn test_deposit_zero_commitment_fails() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    fund_and_approve(wbtc, vault_addr, alice(), 1_00000000_u256);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(1_00000000_u256, 0);
    stop_cheat_caller_address(vault_addr);
}

// [H-01] Fix: second deposit must be rejected if commitment already active
#[test]
#[should_panic(expected: 'Commitment already active')]
fn test_deposit_prevents_commitment_overwrite() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let mock = IMockERC20Dispatcher { contract_address: wbtc };
    mock.mint(alice(), amount * 2);

    let erc20 = IERC20Dispatcher { contract_address: wbtc };
    start_cheat_caller_address(wbtc, alice());
    erc20.approve(vault_addr, amount * 2);
    stop_cheat_caller_address(wbtc);

    let commitment1 = make_commitment(amount, 0x111_felt252);
    let commitment2 = make_commitment(amount, 0x222_felt252);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment1); // OK
    vault.deposit(amount, commitment2); // Must revert: 'Commitment already active'
    stop_cheat_caller_address(vault_addr);
}

// After withdrawal (commitment cleared), a new deposit must be accepted
#[test]
fn test_deposit_allowed_after_full_withdrawal() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let mock = IMockERC20Dispatcher { contract_address: wbtc };
    mock.mint(alice(), amount * 2);

    let erc20 = IERC20Dispatcher { contract_address: wbtc };
    start_cheat_caller_address(wbtc, alice());
    erc20.approve(vault_addr, amount * 2);
    stop_cheat_caller_address(wbtc);

    let secret1 = 0xaaa_felt252;
    let commitment1 = make_commitment(amount, secret1);
    let nullifier1 = make_nullifier(commitment1, secret1);
    let commitment2 = make_commitment(amount, 0xccc_felt252);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment1);
    vault.withdraw(amount, secret1, nullifier1); // clears commitment
    vault.deposit(amount, commitment2); // must succeed
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_commitment(alice()) == commitment2, 'Second deposit not stored');
}

// =========================================================================
// PROVE COLLATERAL TESTS
// =========================================================================
// NOTE ON STUB BEHAVIOR:
//   The vault has no verifier configured in these tests (zero address).
//   Fallback: prove_collateral returns `commitment != 0` for any non-zero commitment.
//   This confirms deposit EXISTENCE but does NOT enforce the threshold.
//   Threshold enforcement requires a production RangeProofVerifier.
//   See SECURITY.md for H-07 documentation.

/// [H-07 Fix] prove_collateral returns true when commitment exists (stub: no threshold check).
/// The key property tested: commitment-only model, no plaintext amount reads.
#[test]
fn test_prove_collateral_returns_true_when_commitment_exists() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 10_00000000_u256;
    let commitment = make_commitment(amount, 0xabc_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Stub verifier: returns true for any non-zero commitment (no threshold check).
    // Empty proof span = stub mode.
    assert(vault.prove_collateral(alice(), 1_u256, array![].span()), 'Should return true');
    assert(
        vault.prove_collateral(alice(), 5_00000000_u256, array![].span()),
        'Should return true (stub)',
    );
    assert(
        vault.prove_collateral(alice(), 10_00000000_u256, array![].span()),
        'Should return true (stub)',
    );
    // NOTE: Even a threshold higher than the deposited amount returns true in stub mode.
    // This is the documented stub limitation. Production verifier would return false here.
    assert(
        vault.prove_collateral(alice(), 100_00000000_u256, array![].span()),
        'Stub: true for any threshold',
    );
}

/// Stub verifier returns false only when NO commitment exists (zero commitment).
#[test]
fn test_prove_collateral_returns_false_for_no_deposit() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    // Bob has never deposited — should return false regardless of threshold.
    assert(!vault.prove_collateral(bob(), 1_u256, array![].span()), 'False when no commitment');
    assert(
        !vault.prove_collateral(bob(), 1000_u256, array![].span()), 'False for any threshold',
    );
}

/// prove_collateral returns false AFTER withdrawal (commitment cleared).
#[test]
fn test_prove_collateral_false_after_withdrawal() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 5_00000000_u256;
    let secret = 0xBEEF_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    assert(vault.prove_collateral(alice(), 1_u256, array![].span()), 'True before withdrawal');
    vault.withdraw(amount, secret, nullifier);
    stop_cheat_caller_address(vault_addr);

    // After withdrawal commitment is cleared → prove_collateral returns false
    assert(
        !vault.prove_collateral(alice(), 1_u256, array![].span()), 'False after withdrawal',
    );
}

// =========================================================================
// WITHDRAW TESTS
// =========================================================================

#[test]
fn test_withdraw_returns_wbtc_to_user() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let erc20 = IERC20Dispatcher { contract_address: wbtc };

    let amount = 2_00000000_u256;
    let secret = 0xfeed_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    vault.withdraw(amount, secret, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(erc20.balance_of(alice()) == amount, 'Alice should receive WBTC');
    assert(erc20.balance_of(vault_addr) == 0_u256, 'Vault should be empty');
}

#[test]
fn test_withdraw_marks_nullifier_as_used() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let secret = 0x111_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    assert(!vault.is_nullifier_used(nullifier), 'Nullifier should not be used');

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    vault.withdraw(amount, secret, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(vault.is_nullifier_used(nullifier), 'Nullifier should be used now');
}

#[test]
fn test_withdraw_clears_commitment() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let secret = 0x999_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    assert(vault.get_commitment(alice()) != 0, 'Commitment should exist');
    vault.withdraw(amount, secret, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_commitment(alice()) == 0, 'Commitment should be cleared');
}

#[test]
fn test_withdraw_updates_total_locked() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 4_00000000_u256;
    let secret = 0x333_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    assert(vault.get_total_locked() == amount, 'Total should equal deposit');
    vault.withdraw(amount, secret, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_total_locked() == 0_u256, 'Total should be zero after');
}

// =========================================================================
// DOUBLE-SPEND PREVENTION
// =========================================================================

#[test]
#[should_panic(expected: 'Nullifier already used')]
fn test_double_spend_prevention() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let secret = 0x999_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    let mock = IMockERC20Dispatcher { contract_address: wbtc };
    mock.mint(alice(), amount * 2);
    let erc20 = IERC20Dispatcher { contract_address: wbtc };
    start_cheat_caller_address(wbtc, alice());
    erc20.approve(vault_addr, amount * 2);
    stop_cheat_caller_address(wbtc);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    vault.withdraw(amount, secret, nullifier); // First: OK (nullifier marked used)
    vault.withdraw(amount, secret, nullifier); // Second: must revert 'Nullifier already used'
    stop_cheat_caller_address(vault_addr);
}

// =========================================================================
// SECURITY: C-01 — Drain Attack Prevention
// =========================================================================

#[test]
#[should_panic(expected: 'No active commitment')]
fn test_withdraw_fails_without_commitment() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 5_00000000_u256;
    fund_and_approve(wbtc, vault_addr, alice(), amount);
    let commitment = make_commitment(amount, 0x111_felt252);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Attacker (no deposit) tries to drain using a fabricated commitment+secret
    let attacker_secret = 0xBAD_felt252;
    let attacker_commitment = 0xF4FEFEFE_felt252;
    let attacker_nullifier = make_nullifier(attacker_commitment, attacker_secret);
    start_cheat_caller_address(vault_addr, attacker());
    vault.withdraw(amount, attacker_secret, attacker_nullifier); // 'No active commitment'
    stop_cheat_caller_address(vault_addr);
}

// =========================================================================
// SECURITY: H-07 — Preimage check prevents unauthorized withdrawal
// =========================================================================

/// [H-07 Fix] Wrong secret → commitment mismatch → withdrawal rejected.
/// Replaces the old C-02 plaintext amount check with cryptographic preimage verification.
#[test]
#[should_panic(expected: 'Invalid preimage')]
fn test_withdraw_fails_with_wrong_secret() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let correct_secret = 0x555_felt252;
    let wrong_secret = 0x999_felt252;
    let commitment = make_commitment(amount, correct_secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);

    // Attempt withdrawal with wrong secret — preimage check fails
    let bad_nullifier = make_nullifier(commitment, wrong_secret);
    vault.withdraw(amount, wrong_secret, bad_nullifier); // 'Invalid preimage'
    stop_cheat_caller_address(vault_addr);
}

/// [H-07 Fix] Wrong amount with correct secret → commitment mismatch → rejected.
/// This replaces the old 'Amount does not match deposit' plaintext check.
#[test]
#[should_panic(expected: 'Invalid preimage')]
fn test_withdraw_fails_with_wrong_amount() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let deposit_amount = 1_00000000_u256;
    let correct_secret = 0x555_felt252;
    let commitment = make_commitment(deposit_amount, correct_secret);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);

    // Alice tries to withdraw MORE — Poseidon(10BTC, secret) != commitment → 'Invalid preimage'
    let inflated_amount = 10_00000000_u256;
    let nullifier = make_nullifier(commitment, correct_secret);
    vault.withdraw(inflated_amount, correct_secret, nullifier); // 'Invalid preimage'
    stop_cheat_caller_address(vault_addr);
}

/// [H-07 Fix] Forged nullifier (not derived from commitment+secret) → rejected.
#[test]
#[should_panic(expected: 'Invalid nullifier')]
fn test_withdraw_fails_with_forged_nullifier() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let secret = 0x777_felt252;
    let commitment = make_commitment(amount, secret);
    let forged_nullifier = 0xDEAD_felt252; // Not derived from commitment+secret

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    vault.withdraw(amount, secret, forged_nullifier); // 'Invalid nullifier'
    stop_cheat_caller_address(vault_addr);
}

// =========================================================================
// PRIVACY MODEL TEST
// =========================================================================

/// [H-07 Fix] Core privacy model test:
/// - Commitment is stored (binding to amount)
/// - No plaintext amount is accessible on-chain
/// - prove_collateral works without reading the amount
/// - Withdrawal requires knowledge of the secret (preimage)
#[test]
fn test_privacy_model_commitment_only() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 5_00000000_u256;
    let secret = 0x5ECBE7_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // 1. Commitment is stored on-chain
    let stored = vault.get_commitment(alice());
    assert(stored == commitment, 'Commitment must be stored');

    // 2. Commitment is a Poseidon hash — opaque to on-chain observers
    //    (amount is NOT recoverable from the commitment alone)

    // 3. prove_collateral works without revealing amount (stub: commitment != 0)
    assert(
        vault.prove_collateral(alice(), 1_00000000_u256, array![].span()),
        'Prove collateral must work',
    );

    // 4. Withdrawal requires knowledge of secret (preimage proof on-chain)
    start_cheat_caller_address(vault_addr, alice());
    vault.withdraw(amount, secret, nullifier);
    stop_cheat_caller_address(vault_addr);

    // 5. After withdrawal: commitment cleared, prove_collateral returns false
    assert(vault.get_commitment(alice()) == 0_felt252, 'Commitment not cleared');
    assert(
        !vault.prove_collateral(alice(), 1_u256, array![].span()), 'False after withdrawal',
    );
}

// =========================================================================
// VIEW FUNCTION TESTS
// =========================================================================

#[test]
fn test_get_wbtc_token_returns_correct_address() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    assert(vault.get_wbtc_token() == wbtc, 'Wrong WBTC token address');
}

#[test]
fn test_get_commitment_returns_zero_before_deposit() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    assert(vault.get_commitment(alice()) == 0, 'Should be zero before deposit');
}

#[test]
fn test_initial_total_locked_is_zero() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    assert(vault.get_total_locked() == 0_u256, 'Initial total should be zero');
}

// =========================================================================
// MULTIPLE USERS TEST
// =========================================================================

#[test]
fn test_multiple_users_independent_commitments() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let alice_amount = 10_00000000_u256;
    let bob_amount = 3_00000000_u256;

    let alice_commitment = make_commitment(alice_amount, 0xaa_felt252);
    let bob_commitment = make_commitment(bob_amount, 0xbb_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), alice_amount);
    fund_and_approve(wbtc, vault_addr, bob(), bob_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(alice_amount, alice_commitment);
    stop_cheat_caller_address(vault_addr);

    start_cheat_caller_address(vault_addr, bob());
    vault.deposit(bob_amount, bob_commitment);
    stop_cheat_caller_address(vault_addr);

    // Commitments are independent and different
    assert(vault.get_commitment(alice()) == alice_commitment, 'Wrong alice commitment');
    assert(vault.get_commitment(bob()) == bob_commitment, 'Wrong bob commitment');
    assert(vault.get_commitment(alice()) != vault.get_commitment(bob()), 'Commitments must differ');

    // Both users have active commitments → prove_collateral returns true (stub behavior)
    assert(
        vault.prove_collateral(alice(), 1_u256, array![].span()), 'Alice: has commitment',
    );
    assert(
        vault.prove_collateral(bob(), 1_u256, array![].span()), 'Bob: has commitment',
    );

    // User with no deposit → false
    let charlie: ContractAddress = 0xCC.try_into().unwrap();
    assert(
        !vault.prove_collateral(charlie, 1_u256, array![].span()), 'Charlie: no commitment',
    );

    // Total is sum of both deposits
    assert(vault.get_total_locked() == alice_amount + bob_amount, 'Total should be sum');
}

// =========================================================================
// ADMIN: PAUSE / UNPAUSE TESTS
// =========================================================================

fn admin() -> ContractAddress {
    0x4AD.try_into().unwrap()
}

#[test]
fn test_vault_starts_unpaused() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    assert(!vault.is_paused(), 'Vault should start unpaused');
}

#[test]
fn test_owner_can_pause_and_unpause() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let admin_iface = ICollateralVaultAdminDispatcher { contract_address: vault_addr };

    start_cheat_caller_address(vault_addr, admin());
    admin_iface.pause();
    stop_cheat_caller_address(vault_addr);

    assert(vault.is_paused(), 'Vault should be paused');

    start_cheat_caller_address(vault_addr, admin());
    admin_iface.unpause();
    stop_cheat_caller_address(vault_addr);

    assert(!vault.is_paused(), 'Vault should be unpaused');
}

#[test]
#[should_panic(expected: 'Only owner')]
fn test_non_owner_cannot_pause() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let admin_iface = ICollateralVaultAdminDispatcher { contract_address: vault_addr };

    start_cheat_caller_address(vault_addr, alice()); // alice is NOT the owner
    admin_iface.pause();
    stop_cheat_caller_address(vault_addr);
}

#[test]
#[should_panic(expected: 'Vault is paused')]
fn test_deposit_fails_when_paused() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let admin_iface = ICollateralVaultAdminDispatcher { contract_address: vault_addr };

    start_cheat_caller_address(vault_addr, admin());
    admin_iface.pause();
    stop_cheat_caller_address(vault_addr);

    let amount = 1_00000000_u256;
    fund_and_approve(wbtc, vault_addr, alice(), amount);
    let commitment = make_commitment(amount, 0x1_felt252);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment); // Must revert: 'Vault is paused'
    stop_cheat_caller_address(vault_addr);
}

#[test]
#[should_panic(expected: 'Vault is paused')]
fn test_withdraw_fails_when_paused() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let admin_iface = ICollateralVaultAdminDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let secret = 0xf00_felt252;
    let commitment = make_commitment(amount, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    start_cheat_caller_address(vault_addr, admin());
    admin_iface.pause();
    stop_cheat_caller_address(vault_addr);

    start_cheat_caller_address(vault_addr, alice());
    vault.withdraw(amount, secret, nullifier); // Must revert: 'Vault is paused'
    stop_cheat_caller_address(vault_addr);
}

#[test]
fn test_prove_collateral_works_when_paused() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let admin_iface = ICollateralVaultAdminDispatcher { contract_address: vault_addr };

    let amount = 5_00000000_u256;
    let commitment = make_commitment(amount, 0xcafe_felt252);
    fund_and_approve(wbtc, vault_addr, alice(), amount);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Pause vault — but prove_collateral must still work (DeFi integrators need it)
    start_cheat_caller_address(vault_addr, admin());
    admin_iface.pause();
    stop_cheat_caller_address(vault_addr);

    assert(
        vault.prove_collateral(alice(), 1_00000000_u256, array![].span()),
        'Proof should work when paused',
    );
}

#[test]
fn test_ownership_transfer() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let admin_iface = ICollateralVaultAdminDispatcher { contract_address: vault_addr };

    let new_owner: ContractAddress = 0x4E0.try_into().unwrap();

    start_cheat_caller_address(vault_addr, admin());
    admin_iface.transfer_ownership(new_owner);
    stop_cheat_caller_address(vault_addr);

    assert(admin_iface.get_owner() == new_owner, 'Ownership not transferred');
}

#[test]
fn test_set_verifier() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let admin_iface = ICollateralVaultAdminDispatcher { contract_address: vault_addr };

    let verifier_addr: ContractAddress = 0xFFF.try_into().unwrap();

    start_cheat_caller_address(vault_addr, admin());
    admin_iface.set_verifier(verifier_addr);
    stop_cheat_caller_address(vault_addr);

    assert(admin_iface.get_verifier() == verifier_addr, 'Verifier not set');
}
