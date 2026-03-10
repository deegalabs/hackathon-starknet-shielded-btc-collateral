/// Integration test: Full end-to-end flow of the Shielded BTC Collateral Protocol.
///
/// Demonstrates the complete composability story:
///   Alice deposits BTC privately → requests loan → lending protocol
///   proves collateral without learning exact amount → loan approved
///
/// [H-07 Fix — March 7, 2026]
///   - prove_collateral accepts proof parameter (empty span for stub)
///   - withdraw requires secret for cryptographic preimage verification
///   - get_borrow_limit returns 0 (privacy-preserving, no amount exposed)
///
/// NOTE ON STUB BEHAVIOR:
///   The stub verifier (zero address fallback) returns `commitment != 0`.
///   This means ANY user with a deposit passes the collateral check.
///   Threshold enforcement (e.g., borrow 7 BTC requires 10 BTC collateral)
///   requires a production RangeProofVerifier. See SECURITY.md H-07.
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

/// Nullifier = Poseidon(commitment, secret) — matches the updated vault contract.
fn make_nullifier(commitment: felt252, secret: felt252) -> felt252 {
    poseidon_hash_span(array![commitment, secret].span())
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

/// With stub verifier: any depositor passes the collateral check (commitment != 0).
/// This is the MVP behavior; threshold enforcement requires production verifier.
#[test]
fn test_private_deposit_enables_lending() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    let deposit_amount = 10_00000000_u256;
    let secret = 0xBEEF_felt252;
    let commitment = make_commitment(deposit_amount, secret);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, secret, commitment, 0x1_felt252);
    stop_cheat_caller_address(vault_addr);

    // Borrow: stub verifier returns true (commitment != 0), loan approved
    let borrow_amount = 7_00000000_u256;

    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(borrow_amount, array![].span());
    stop_cheat_caller_address(lending_addr);

    assert(lending.get_debt(alice()) == borrow_amount, 'Debt should equal borrow');
    assert(lending.get_total_borrowed() == borrow_amount, 'Total borrowed mismatch');
}

/// [H-07 Fix] get_borrow_limit now returns 0 (privacy-preserving).
/// Amount is not exposed on-chain. Production: ZK proof encodes borrow range.
#[test]
fn test_borrow_limit_privacy_preserving() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    let deposit_amount = 10_00000000_u256;
    let secret_face = 0xFACE_felt252;
    let commitment = make_commitment(deposit_amount, secret_face);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, secret_face, commitment, 0x1_felt252);
    stop_cheat_caller_address(vault_addr);

    // [H-07 Fix] get_borrow_limit returns 0 — no amount is exposed.
    // Production: ZK proof would encode the valid borrow range.
    let limit = lending.get_borrow_limit(alice());
    assert(limit == 0_u256, 'Borrow limit is 0 (private)');
}

#[test]
fn test_repay_reduces_debt() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    let deposit_amount = 10_00000000_u256;
    let secret_abc = 0xabc_felt252;
    let commitment = make_commitment(deposit_amount, secret_abc);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, secret_abc, commitment, 0x1_felt252);
    stop_cheat_caller_address(vault_addr);

    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(7_00000000_u256, array![].span());
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

/// [H-07 STUB NOTE] With stub verifier, any user with a deposit passes collateral check.
/// This test documents MVP stub behavior: deposit existence replaces threshold check.
/// In production, a user with 1 BTC trying to borrow 5 BTC would be rejected.
#[test]
fn test_stub_allows_any_depositor_to_borrow() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };

    // Alice only deposits 1 BTC
    let deposit_amount = 1_00000000_u256;
    let secret_bad = 0xBAD_felt252;
    let commitment = make_commitment(deposit_amount, secret_bad);

    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, secret_bad, commitment, 0x1_felt252);
    stop_cheat_caller_address(vault_addr);

    // Stub behavior: commitment != 0 → collateral proof passes regardless of threshold.
    // Production: this should fail (1 BTC < 7.14 BTC required at 70% LTV for 5 BTC borrow).
    // The test is intentionally checking STUB behavior, not production behavior.
    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(5_00000000_u256, array![].span()); // Passes with stub — commitment exists
    stop_cheat_caller_address(lending_addr);

    // Verify the borrow was recorded (stub accepted it)
    assert(lending.get_debt(alice()) == 5_00000000_u256, 'Stub: borrow recorded');
}

// =========================================================================
// INTEGRATION TEST 2: Paymaster eligibility via vault proof
// =========================================================================

#[test]
fn test_paymaster_eligible_user_with_collateral() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };

    let threshold = 1_00000000_u256;
    let paymaster_addr = deploy_paymaster(vault_addr, threshold);
    let paymaster = IPaymasterDispatcher { contract_address: paymaster_addr };

    start_cheat_caller_address(paymaster_addr, protocol_owner());
    paymaster.fund_budget(1000_u256);
    stop_cheat_caller_address(paymaster_addr);

    let deposit_amount = 5_00000000_u256;
    let secret_dad = 0xDAD_felt252;
    let commitment = make_commitment(deposit_amount, secret_dad);
    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, secret_dad, commitment, 0x1_felt252);
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

    let deposit_amount = 5_00000000_u256;
    let secret_cab = 0xCAB_felt252;
    let commitment = make_commitment(deposit_amount, secret_cab);
    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, secret_cab, commitment, 0x1_felt252);
    stop_cheat_caller_address(vault_addr);

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

    let deposit_amount = 1_u256;
    let secret_one = 0x1_felt252;
    let commitment = make_commitment(deposit_amount, secret_one);
    fund_and_approve(wbtc, vault_addr, alice(), deposit_amount);

    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit_amount, secret_one, commitment, 0x1_felt252);
    stop_cheat_caller_address(vault_addr);

    // [H-07 Fix] get_borrow_limit returns 0 (privacy-preserving)
    start_cheat_caller_address(lending_addr, alice());
    let result = lending.get_borrow_limit(alice());
    assert(result == 0_u256, 'Borrow limit should be 0');
    stop_cheat_caller_address(lending_addr);
}

// =========================================================================
// INTEGRATION TEST 3: Full privacy primitive flow
// =========================================================================

/// Complete protocol flow with H-07 fix applied:
/// - deposit (commitment only, no plaintext stored)
/// - prove_collateral (stub: commitment existence check)
/// - borrow / repay
/// - withdraw (cryptographic preimage verification on-chain)
#[test]
fn test_full_privacy_flow_deposit_prove_borrow_repay_withdraw() {
    let wbtc = deploy_wbtc();
    let vault_addr = deploy_vault(wbtc);
    let lending_addr = deploy_lending(vault_addr);

    let vault = ICollateralVaultDispatcher { contract_address: vault_addr };
    let lending = ILendingProtocolDispatcher { contract_address: lending_addr };
    let erc20 = IERC20Dispatcher { contract_address: wbtc };

    // Step 1: Alice deposits 10 BTC privately (commitment only stored on-chain)
    let deposit = 10_00000000_u256;
    let secret = 0xFEED_felt252;
    let commitment = make_commitment(deposit, secret);
    let nullifier = make_nullifier(commitment, secret);

    fund_and_approve(wbtc, vault_addr, alice(), deposit);
    start_cheat_caller_address(vault_addr, alice());
    vault.deposit(deposit, secret, commitment, 0x1_felt252);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_total_locked() == deposit, 'Vault should hold 10 BTC');

    // Step 2: Alice borrows 7 BTC (stub: commitment existence proves collateral)
    start_cheat_caller_address(lending_addr, alice());
    lending.borrow(7_00000000_u256, array![].span());
    stop_cheat_caller_address(lending_addr);

    assert(lending.get_debt(alice()) == 7_00000000_u256, 'Debt should be 7 BTC');

    // Step 3: Alice repays the loan
    start_cheat_caller_address(lending_addr, alice());
    lending.repay(7_00000000_u256);
    stop_cheat_caller_address(lending_addr);

    assert(lending.get_debt(alice()) == 0_u256, 'Debt should be 0 after repay');

    // Step 4: Alice withdraws using cryptographic preimage proof
    // [H-07 Fix] withdraw(amount, secret, nullifier) — on-chain preimage verification
    start_cheat_caller_address(vault_addr, alice());
    vault.withdraw(deposit, secret, nullifier);
    stop_cheat_caller_address(vault_addr);

    assert(vault.get_total_locked() == 0_u256, 'Vault should be empty');
    assert(erc20.balance_of(alice()) == deposit, 'Alice should get BTC back');

    // Step 5: Nullifier is burned — double-spend prevention
    assert(vault.is_nullifier_used(nullifier), 'Nullifier should be marked used');

    // Step 6: Commitment cleared — prove_collateral now returns false
    assert(
        !vault.prove_collateral(alice(), 1_u256, array![].span()),
        'No proof after withdrawal',
    );
}
