use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use starknet::ContractAddress;
use shielded_btc_collateral::interfaces::isession_key_manager::{
    ISessionKeyManagerDispatcher, ISessionKeyManagerDispatcherTrait,
};

// =========================================================================
// Deploy helper
// =========================================================================

fn deploy_session_key_manager() -> ContractAddress {
    let contract = declare("SessionKeyManager").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    address
}

fn alice() -> ContractAddress {
    0xAA.try_into().unwrap()
}

fn bob() -> ContractAddress {
    0xBB.try_into().unwrap()
}

fn zero_addr() -> ContractAddress {
    0.try_into().unwrap()
}

// =========================================================================
// REGISTER SESSION TESTS
// =========================================================================

#[test]
fn test_register_session_stores_data() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x1234_felt252;
    let expiry: u64 = 9999999999_u64;
    let limit = 5_00000000_u256;

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, expiry, limit, zero_addr());
    stop_cheat_caller_address(mgr_addr);

    let (stored_expiry, stored_limit, spent, _, is_active) = mgr
        .get_session_info(alice(), session_key);
    assert(stored_expiry == expiry, 'Wrong expiry');
    assert(stored_limit == limit, 'Wrong limit');
    assert(spent == 0_u256, 'Spent should be zero');
    assert(is_active, 'Should be active');
}

#[test]
fn test_is_valid_session_returns_true_when_active() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0xABCD_felt252;

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, 0_u256, zero_addr());
    stop_cheat_caller_address(mgr_addr);

    assert(mgr.is_valid_session(alice(), session_key), 'Session should be valid');
}

#[test]
fn test_is_valid_session_returns_false_before_registration() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    assert(!mgr.is_valid_session(alice(), 0x9999_felt252), 'Should be invalid before reg');
}

#[test]
fn test_revoke_session_invalidates_key() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0xDEAD_felt252;

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, 0_u256, zero_addr());
    assert(mgr.is_valid_session(alice(), session_key), 'Should be valid after register');
    mgr.revoke_session(session_key);
    stop_cheat_caller_address(mgr_addr);

    assert(!mgr.is_valid_session(alice(), session_key), 'Should be invalid after revoke');
}

#[test]
fn test_session_invalid_after_expiry_timestamp() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x5555_felt252;

    start_cheat_block_timestamp(mgr_addr, 100_u64);

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 200_u64, 0_u256, zero_addr());
    stop_cheat_caller_address(mgr_addr);

    assert(mgr.is_valid_session(alice(), session_key), 'Should be valid at t=100');

    stop_cheat_block_timestamp(mgr_addr);
    start_cheat_block_timestamp(mgr_addr, 300_u64);

    assert(!mgr.is_valid_session(alice(), session_key), 'Should be invalid at t=300');

    stop_cheat_block_timestamp(mgr_addr);
}

#[test]
fn test_alice_and_bob_sessions_independent() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x7777_felt252; // same key, different accounts

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, 0_u256, zero_addr());
    stop_cheat_caller_address(mgr_addr);

    // Bob's session with the same key is independent
    assert(mgr.is_valid_session(alice(), session_key), 'Alice session should be valid');
    assert(!mgr.is_valid_session(bob(), session_key), 'Bob session should be invalid');
}

// =========================================================================
// SPENDING LIMIT TESTS
// =========================================================================

#[test]
fn test_record_spending_within_limit() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x1111_felt252;
    let limit = 10_00000000_u256; // 10 BTC limit

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, limit, zero_addr());
    stop_cheat_caller_address(mgr_addr);

    // [H-07 Fix] record_spending requires caller == account
    start_cheat_caller_address(mgr_addr, alice());
    mgr.record_spending(alice(), session_key, 3_00000000_u256);
    stop_cheat_caller_address(mgr_addr);

    let (_, stored_limit, spent, _, _) = mgr.get_session_info(alice(), session_key);
    assert(stored_limit == limit, 'Limit should be unchanged');
    assert(spent == 3_00000000_u256, 'Spent should be 3 BTC');

    // Session still valid (3 < 10)
    assert(mgr.is_valid_session(alice(), session_key), 'Should still be valid');
}

#[test]
fn test_session_invalid_when_spending_limit_reached() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x2222_felt252;
    let limit = 5_00000000_u256; // 5 BTC limit

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, limit, zero_addr());
    stop_cheat_caller_address(mgr_addr);

    // [H-07 Fix] caller must be the account
    start_cheat_caller_address(mgr_addr, alice());
    mgr.record_spending(alice(), session_key, 5_00000000_u256);
    stop_cheat_caller_address(mgr_addr);

    // Session should now be invalid (spent == limit)
    assert(!mgr.is_valid_session(alice(), session_key), 'Should be invalid at limit');
}

#[test]
#[should_panic(expected: 'Spending limit exceeded')]
fn test_record_spending_reverts_when_exceeding_limit() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x3333_felt252;
    let limit = 2_00000000_u256; // 2 BTC limit

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, limit, zero_addr());
    // [H-07 Fix] caller must be the account — also applies inside same cheat block
    mgr.record_spending(alice(), session_key, 5_00000000_u256); // Must revert
    stop_cheat_caller_address(mgr_addr);
}

// =========================================================================
// SECURITY: H-07 — record_spending authentication
// =========================================================================

#[test]
#[should_panic(expected: 'Unauthorized: not account')]
fn test_record_spending_unauthorized_attacker_fails() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x6666_felt252;
    let limit = 5_00000000_u256;

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, limit, zero_addr());
    stop_cheat_caller_address(mgr_addr);

    // Attacker (bob) tries to exhaust alice's session key spending limit
    // This is the griefing attack — must be prevented
    let attacker: ContractAddress = 0xA77AC.try_into().unwrap();
    start_cheat_caller_address(mgr_addr, attacker);
    mgr.record_spending(alice(), session_key, 5_00000000_u256); // Must revert
    stop_cheat_caller_address(mgr_addr);
}

#[test]
#[should_panic(expected: 'Session key already active')]
fn test_cannot_register_duplicate_session() {
    let mgr_addr = deploy_session_key_manager();
    let mgr = ISessionKeyManagerDispatcher { contract_address: mgr_addr };

    let session_key: felt252 = 0x4444_felt252;

    start_cheat_caller_address(mgr_addr, alice());
    mgr.register_session(session_key, 9999999999_u64, 0_u256, zero_addr());
    mgr.register_session(session_key, 9999999999_u64, 0_u256, zero_addr()); // Must fail
    stop_cheat_caller_address(mgr_addr);
}
