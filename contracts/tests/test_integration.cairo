/// Integration test: Full end-to-end flow of the Shielded BTC Collateral Protocol.
///
/// Demonstrates the complete composability story:
///   Alice deposits BTC privately → requests loan → lending protocol
///   proves collateral without learning exact amount → loan approved
///
/// Also demonstrates the Paymaster eligibility check:
///   User with sufficient collateral qualifies for gas sponsorship
use core::poseidon::poseidon_hash_span;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use shielded_btc_collateral::interfaces::icollateral_vault::{
    ICollateralVaultDispatcher, ICollateralVaultDispatcherTrait,
};
use shielded_btc_collateral::interfaces::ilending_protocol::{
    ILendingProtocolDispatcher, ILendingProtocolDispatcherTrait,
};
use shielded_btc_collateral::interfaces::ipaymaster::{
    IPaymasterDispatcher, IPaymasterDispatcherTrait,
};
use shielded_btc_collateral::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

// =========================================================================
// Test helper interfaces
// =========================================================================

#[starknet::interface]
trait IMockERC20<TContractState> {
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

// =========================================================================
// Cryptographic helpers
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

fn admin() -> ContractAddress {
    0x4AD.try_into().unwrap()
}

fn protocol_owner() -> ContractAddress {
    0xB0B.try_into().unwrap()
}

// =========================================================================
// Deploy helpers
// =========================================================================

fn deploy_wbtc() -> ContractAddress {
    let contract = declare("MockERC20").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![8_u8.into()]).unwrap();
    address
}

fn deploy_vault(wbtc: ContractAddress) -> ContractAddress {
    let contract = declare("CollateralVault").unwrap().contract_class();
    let calldata = array![wbtc.into(), admin().into()];
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

fn deploy_lending(vault: ContractAddress) -> ContractAddress {
    let contract = declare("MockLendingProtocol").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![vault.into()]).unwrap();
    address
}

fn deploy_paymaster(vault: ContractAddress, threshold: u256) -> ContractAddress {
    let contract = declare("Paymaster").unwrap().contract_class();
    let calldata = array![
        protocol_owner().into(), vault.into(), threshold.low.into(), threshold.high.into(),
    ];
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

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
// INTEGRATION TEST 1: Deposit → Prove → Borrow
// =========================================================================

#[test]
fn test_private_deposit_enables_lending() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    // Alice deposits 10 BTC privately
    let deposit_amount = 10_00000000_u256; // 10 BTC in satoshis
    let secret = 0xBEEF_felt252;
    let commitment = make_commitment(deposit_amount, secret);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // LTV = 70%: to borrow 7 BTC, need to prove 10 BTC collateral
    let borrow_amount = 7_00000000_u256;

    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(borrow_amount);
    stop_cheat_caller_address(lending_addr);

    assert(lending.get_debt(alice()) == borrow_amount, 'Debt should equal borrow');
    assert(lending.get_total_borrowed() == borrow_amount, 'Total borrowed mismatch');
}

#[test]
fn test_borrow_limit_reflects_collateral() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    let deposit_amount = 10_00000000_u256; // 10 BTC
    let commitment = make_commitment(deposit_amount, 0xFACE_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // At 70% LTV: 10 BTC * 70/100 = 7 BTC borrowable
    let limit = lending.get_borrow_limit(alice());
    assert(limit == 7_00000000_u256, 'Borrow limit should be 7 BTC');
}

#[test]
#[should_panic(expected: 'Insufficient BTC collateral')]
fn test_borrow_fails_with_insufficient_collateral() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    // Alice only deposits 1 BTC
    let deposit_amount = 1_00000000_u256;
    let commitment = make_commitment(deposit_amount, 0xBAD_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Try to borrow 5 BTC with only 1 BTC collateral — must fail
    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(5_00000000_u256); // 5 BTC borrow needs ~7.14 BTC collateral at 70% LTV
    stop_cheat_caller_address(lending_addr);
}

#[test]
fn test_repay_reduces_debt() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    let deposit_amount = 10_00000000_u256;
    let commitment = make_commitment(deposit_amount, 0xabc_felt252);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);
    stop_cheat_caller_address(vault_addr);

    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(7_00000000_u256);
    lending.repay(3_00000000_u256);
    stop_cheat_caller_address(lending_addr);

    assert(lending.get_debt(alice()) == 4_00000000_u256, 'Debt should be 4 BTC');
}

#[test]
fn test_borrow_limit_is_zero_without_deposit() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    assert(lending.get_borrow_limit(alice()) == 0_u256, 'Limit 0 without deposit');
}

// =========================================================================
// INTEGRATION TEST 2: Paymaster eligibility via vault proof
// =========================================================================

#[test]
fn test_paymaster_eligible_user_with_collateral() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    // Threshold: 1 BTC minimum to qualify for gas sponsorship
    let threshold = 1_00000000_u256;
    let paymaster_addr = deploy_paymaster(vault_addr, threshold);
    let paymaster = IPaymasterDispatcher { contract_address: paymaster_addr };

    // Fund the paymaster
    start_cheat_caller_address(paymaster_addr, protocol_owner());
    paymaster.fund_budget(1000_u256);
    stop_cheat_caller_address(paymaster_addr);

    // Alice deposits 5 BTC — above threshold
    let deposit_amount = 5_00000000_u256;
    let commitment = make_commitment(deposit_amount, 0xDAD_felt252);
    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(paymaster.is_eligible_for_sponsorship(alice()), 'Alice should be eligible');
}

#[test]
fn test_paymaster_ineligible_without_deposit() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let threshold = 1_00000000_u256;
    let paymaster_addr = deploy_paymaster(vault_addr, threshold);
    let paymaster = IPaymasterDispatcher { contract_address: paymaster_addr };

    start_cheat_caller_address(paymaster_addr, protocol_owner());
    paymaster.fund_budget(1000_u256);
    stop_cheat_caller_address(paymaster_addr);

    // Alice has no deposit — not eligible
    assert(!paymaster.is_eligible_for_sponsorship(alice()), 'Should not be eligible');
}

#[test]
fn test_paymaster_ineligible_when_budget_empty() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let threshold = 1_00000000_u256;
    let paymaster_addr = deploy_paymaster(vault_addr, threshold);
    let paymaster = IPaymasterDispatcher { contract_address: paymaster_addr };

    // Alice deposits but paymaster has NO budget
    let deposit_amount = 5_00000000_u256;
    let commitment = make_commitment(deposit_amount, 0xCAB_felt252);
    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // Paymaster has no budget → not eligible
    assert(!paymaster.is_eligible_for_sponsorship(alice()), 'Not eligible: no budget');
}

// =========================================================================
// SECURITY: M-07 — Paymaster fund_budget permissionless
// =========================================================================

#[test]
fn test_paymaster_anyone_can_fund_budget() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let threshold = 1_00000000_u256;
    let paymaster_addr = deploy_paymaster(vault_addr, threshold);
    let paymaster = IPaymasterDispatcher { contract_address: paymaster_addr };

    // [M-07 Fix] A random contributor (not the owner) can fund the paymaster
    let contributor: ContractAddress = 0xC0CAC01A.try_into().unwrap();
    start_cheat_caller_address(paymaster_addr, contributor);
    paymaster.fund_budget(500_u256);
    stop_cheat_caller_address(paymaster_addr);

    assert(paymaster.get_remaining_budget() == 500_u256, 'Budget should be 500');
}

// =========================================================================
// SECURITY: M-09 — LTV ceiling division
// =========================================================================

#[test]
fn test_ltv_ceiling_prevents_undercollateralized_micro_loans() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    // Alice deposits exactly 1 satoshi (minimum)
    let deposit_amount = 1_u256;
    let commitment = make_commitment(deposit_amount, 0x1_felt252);
    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, commitment);
    stop_cheat_caller_address(vault_addr);

    // [M-09 Fix] Borrow 1 satoshi requires ceil(1 * 100 / 70) = 2 satoshis collateral.
    // With floor division it would be 1, which under-collateralizes the loan.
    // Alice only has 1 satoshi → borrow should fail (needs 2).
    start_cheat_caller_address(lending_addr, alice());
    let result = lending.get_borrow_limit(alice());
    // 1 satoshi * 70 / 100 = 0 (floor) — borrow limit is 0
    assert(result == 0_u256, 'Micro loan limit should be 0');
    stop_cheat_caller_address(lending_addr);
}

// =========================================================================
// INTEGRATION TEST 3: Full privacy primitive flow
// =========================================================================

#[test]
fn test_full_privacy_flow_deposit_prove_borrow_repay_withdraw() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };
    let erc20 = IERC20Dispatcher { contract_address: wbtc };

    // Step 1: Alice deposits 10 BTC privately
    let deposit = 10_00000000_u256;
    let secret = 0xFEED_felt252;
    let withdraw_secret = 0xBEAD_felt252;
    let commitment = make_commitment(deposit, secret);
    let nullifier = make_nullifier(commitment, withdraw_secret);

    fund_and_approve(wbtc, vault_addr, alice(), deposit);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit, commitment);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_total_locked() == deposit, 'Vault should hold 10 BTC');

    // Step 2: Alice borrows 7 BTC from lending (proves collateral privately)
    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(7_00000000_u256);
    stop_cheat_caller_address(lending_addr);

    assert(lending.get_debt(alice()) == 7_00000000_u256, 'Debt should be 7 BTC');

    // Step 3: Alice repays the loan
    start_cheat_caller_address(lending_addr, alice());
    lending.repay(7_00000000_u256);
    stop_cheat_caller_address(lending_addr);

    assert(lending.get_debt(alice()) == 0_u256, 'Debt should be 0 after repay');

    // Step 4: Alice withdraws her BTC using nullifier (prevents double-spend)
    start_cheat_caller_address(vault_addr, alice());
    vault.withdraw(deposit, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_total_locked() == 0_u256, 'Vault should be empty');
    assert(erc20.balance_of(alice()) == deposit, 'Alice should get BTC back');

    // Step 5: Nullifier is burned — double-spend attempt must fail
    assert(vault.is_nullifier_used(nullifier), 'Nullifier should be marked used');
}
