use core::poseidon::poseidon_hash_span;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use shielded_btc_collateral::interfaces::icollateral_vault::{
    ICollateralVaultDispatcher, ICollateralVaultDispatcherTrait,
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
    let calldata = array![wbtc_address.into()];
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

// =========================================================================
// PROVE COLLATERAL TESTS
// =========================================================================

#[test]
fn test_prove_collateral_returns_true_after_deposit() {
    let wbtc = deploy_mock_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let amount = 10_00000000_u256;
    let commitment = make_commitment(amount, 0xabc_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // MVP stub: both thresholds pass since commitment is non-zero
    assert(vault.prove_collateral(alice(), 1_50000000_u256), 'Should prove >= 1.5 BTC');
    assert(vault.prove_collateral(alice(), 5_00000000_u256), 'Should prove >= 5 BTC');
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
    vault.withdraw(amount, nullifier); // First withdrawal: OK
    vault.withdraw(amount, nullifier); // Second: must revert
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

    // Both can prove collateral
    assert(vault.prove_collateral(alice(), 1_u256), 'Alice should prove collateral');
    assert(vault.prove_collateral(bob(), 1_u256), 'Bob should prove collateral');

    // Total is sum of both deposits
    assert(
        vault.get_total_locked() == alice_amount + bob_amount, 'Total should be sum',
    );
}
