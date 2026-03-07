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
    // constructor(decimals: u8) — 8 decimals like Bitcoin satoshis
    let calldata = array![8_u8.into()];
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

fn deploy_vault(wbtc_address: ContractAddress) -> ContractAddress {
    let contract = declare("CollateralVault").unwrap().contract_class();
    // constructor(wbtc_token, owner) — use a fixed owner address in tests
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

fn make_nullifier(commitment: felt252, withdraw_secret: felt252) -> felt252 {
    poseidon_hash_span(array![commitment, withdraw_secret].span())
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

    let amount = 10_00000000_u256; // 10 BTC in satoshis
    let secret = 0xdeadbeef_felt252;
    let commitment = make_commitment(amount, secret);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_commitment(alice()) == commitment, 'Commitment not stored');
}

#[test]
fn test_deposit_stores_committed_amount() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 5_00000000_u256;
    let commitment = make_commitment(amount, 0xabc_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_committed_amount(alice()) == amount, 'Committed amount not stored');
}

#[test]
fn test_deposit_transfers_wbtc_to_vault() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let erc20 = IERC20Dispatcher { contract_address: wbtc };

    let amount = 5_00000000_u256; // 5 BTC
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

    let commitment1 = make_commitment(amount, 0xaaa_felt252);
    let nullifier1 = make_nullifier(commitment1, 0xbbb_felt252);
    let commitment2 = make_commitment(amount, 0xccc_felt252);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment1);
    vault.withdraw(amount, nullifier1); // clears commitment
    vault.deposit(amount, commitment2); // must succeed
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_commitment(alice()) == commitment2, 'Second deposit not stored');
}

// =========================================================================
// PROVE COLLATERAL TESTS
// =========================================================================

// [H-02] Fix: prove_collateral must now respect the threshold
#[test]
fn test_prove_collateral_passes_when_above_threshold() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 10_00000000_u256; // 10 BTC
    let commitment = make_commitment(amount, 0xabc_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(vault.prove_collateral(alice(), 1_50000000_u256), 'Should pass: 10 >= 1.5 BTC');
    assert(vault.prove_collateral(alice(), 5_00000000_u256), 'Should pass: 10 >= 5 BTC');
    assert(vault.prove_collateral(alice(), 10_00000000_u256), 'Should pass: 10 >= 10 BTC');
}

// [H-02] Fix: prove_collateral must fail when deposited amount is below threshold
#[test]
fn test_prove_collateral_fails_when_below_threshold() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256; // 1 BTC deposited
    let commitment = make_commitment(amount, 0xabc_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Threshold is higher than deposited amount — must fail
    assert(!vault.prove_collateral(alice(), 5_00000000_u256), 'Should fail: 1 < 5 BTC');
    assert(!vault.prove_collateral(alice(), 2_00000000_u256), 'Should fail: 1 < 2 BTC');
}

#[test]
fn test_prove_collateral_returns_false_for_no_deposit() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    // Bob has never deposited — should return false
    assert(!vault.prove_collateral(bob(), 1_u256), 'Should return false for Bob');
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
    let commitment = make_commitment(amount, 0xfeed_felt252);
    let nullifier = make_nullifier(commitment, 0xbeef_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    vault.withdraw(amount, nullifier);
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
    let commitment = make_commitment(amount, 0x111_felt252);
    let nullifier = make_nullifier(commitment, 0x222_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    assert(!vault.is_nullifier_used(nullifier), 'Nullifier should not be used');

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    vault.withdraw(amount, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(vault.is_nullifier_used(nullifier), 'Nullifier should be used now');
}

#[test]
fn test_withdraw_clears_commitment() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 1_00000000_u256;
    let commitment = make_commitment(amount, 0x999_felt252);
    let nullifier = make_nullifier(commitment, 0x888_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    assert(vault.get_commitment(alice()) != 0, 'Commitment should exist');
    vault.withdraw(amount, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_commitment(alice()) == 0, 'Commitment should be cleared');
    assert(vault.get_committed_amount(alice()) == 0_u256, 'Amount should be cleared');
}

#[test]
fn test_withdraw_updates_total_locked() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 4_00000000_u256;
    let commitment = make_commitment(amount, 0x333_felt252);
    let nullifier = make_nullifier(commitment, 0x444_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    assert(vault.get_total_locked() == amount, 'Total should equal deposit');
    vault.withdraw(amount, nullifier);
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
    let commitment = make_commitment(amount, 0x999_felt252);
    let nullifier = make_nullifier(commitment, 0xaaa_felt252);

    // Fund twice so the vault has enough for a second attempt
    let mock = IMockERC20Dispatcher { contract_address: wbtc };
    mock.mint(alice(), amount * 2);
    let erc20 = IERC20Dispatcher { contract_address: wbtc };
    start_cheat_caller_address(wbtc, alice());
    erc20.approve(vault_addr, amount * 2);
    stop_cheat_caller_address(wbtc);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    vault.withdraw(amount, nullifier); // First withdrawal: OK (nullifier marked used, commitment cleared)
    vault.withdraw(amount, nullifier); // Second: must revert with 'Nullifier already used'
    stop_cheat_caller_address(vault_addr);
}

// =========================================================================
// SECURITY: C-01 — Drain Attack Prevention (no commitment = no withdrawal)
// =========================================================================

#[test]
#[should_panic(expected: 'No active commitment')]
fn test_withdraw_fails_without_commitment() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    // Seed the vault with Alice's deposit
    let amount = 5_00000000_u256;
    fund_and_approve(wbtc, vault_addr, alice(), amount);
    let commitment = make_commitment(amount, 0x111_felt252);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Attacker (no deposit) tries to drain
    let attacker_nullifier = make_nullifier(0xBAD_felt252, 0xDEAD_felt252);
    start_cheat_caller_address(vault_addr, attacker());
    vault.withdraw(amount, attacker_nullifier); // Must revert: 'No active commitment'
    stop_cheat_caller_address(vault_addr);
}

// =========================================================================
// SECURITY: C-02 — Amount Mismatch Prevention
// =========================================================================

#[test]
#[should_panic(expected: 'Amount does not match deposit')]
fn test_withdraw_fails_with_wrong_amount() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    // Alice deposits 1 BTC
    let deposit_amount = 1_00000000_u256;
    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);
    let commitment = make_commitment(deposit_amount, 0x555_felt252);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);

    // Alice tries to withdraw MORE than deposited — must fail
    let nullifier = make_nullifier(commitment, 0x666_felt252);
    let inflated_amount = 10_00000000_u256; // 10x the actual deposit
    vault.withdraw(inflated_amount, nullifier); // Must revert: 'Amount does not match deposit'
    stop_cheat_caller_address(vault_addr);
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
fn test_get_committed_amount_returns_zero_before_deposit() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    assert(vault.get_committed_amount(alice()) == 0_u256, 'Should be zero before deposit');
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

    // Commitments are independent
    assert(vault.get_commitment(alice()) == alice_commitment, 'Wrong alice commitment');
    assert(vault.get_commitment(bob()) == bob_commitment, 'Wrong bob commitment');
    assert(vault.get_commitment(alice()) != vault.get_commitment(bob()), 'Commitments should differ');

    // Committed amounts are independent
    assert(vault.get_committed_amount(alice()) == alice_amount, 'Wrong alice amount');
    assert(vault.get_committed_amount(bob()) == bob_amount, 'Wrong bob amount');

    // Threshold-respecting collateral proofs
    assert(vault.prove_collateral(alice(), 5_00000000_u256), 'Alice: 10 >= 5 BTC');
    assert(!vault.prove_collateral(alice(), 11_00000000_u256), 'Alice: 10 < 11 BTC');
    assert(vault.prove_collateral(bob(), 1_00000000_u256), 'Bob: 3 >= 1 BTC');
    assert(!vault.prove_collateral(bob(), 5_00000000_u256), 'Bob: 3 < 5 BTC');

    // Total is sum of both deposits
    assert(
        vault.get_total_locked() == alice_amount + bob_amount, 'Total should be sum',
    );
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

    // Pause the vault
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
    let commitment = make_commitment(amount, 0xf00_felt252);
    let nullifier = make_nullifier(commitment, 0xbaa_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Pause the vault after deposit
    start_cheat_caller_address(vault_addr, admin());
    admin_iface.pause();
    stop_cheat_caller_address(vault_addr);

    // Withdrawal must fail while paused
    start_cheat_caller_address(vault_addr, alice());
    vault.withdraw(amount, nullifier); // Must revert: 'Vault is paused'
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

    assert(vault.prove_collateral(alice(), 1_00000000_u256), 'Proof should work when paused');
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
