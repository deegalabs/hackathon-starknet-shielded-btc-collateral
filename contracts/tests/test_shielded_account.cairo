use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use snforge_std::signature::stark_curve::{StarkCurveKeyPairImpl, StarkCurveSignerImpl};
use starknet::ContractAddress;
use shielded_btc_collateral::interfaces::ishielded_account::{
    IShieldedAccountDispatcher, IShieldedAccountDispatcherTrait,
};

// =========================================================================
// Deploy helpers
// =========================================================================

fn deploy_shielded_account(
    owner_public_key: felt252, vault_address: ContractAddress,
) -> ContractAddress {
    let contract = declare("ShieldedAccount").unwrap().contract_class();
    let calldata = array![owner_public_key, vault_address.into()];
    let (address, _) = contract.deploy(@calldata).unwrap();
    address
}

fn dummy_vault() -> ContractAddress {
    0xCA.try_into().unwrap()
}

// =========================================================================
// CONSTRUCTOR TESTS
// =========================================================================

#[test]
fn test_constructor_stores_owner_key() {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(key_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    assert(account.get_owner_public_key() == key_pair.public_key, 'Wrong owner key');
}

#[test]
fn test_constructor_stores_vault_address() {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let vault = dummy_vault();
    let account_addr = deploy_shielded_account(key_pair.public_key, vault);
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    assert(account.get_vault_address() == vault, 'Wrong vault address');
}

#[test]
fn test_constructor_rejects_zero_key() {
    let contract = declare("ShieldedAccount").unwrap().contract_class();
    let calldata = array![0_felt252, dummy_vault().into()];
    let deploy_result = contract.deploy(@calldata);
    // Constructor must reject zero owner key — deploy should fail
    match deploy_result {
        Result::Err(panic_data) => {
            let span = panic_data.span();
            assert(*span.at(0) == 'Owner key cannot be zero', 'Wrong error message');
        },
        Result::Ok(_) => { panic!("Deploy should have failed with zero key"); },
    }
}

// =========================================================================
// SIGNATURE VALIDATION TESTS
// =========================================================================

#[test]
fn test_is_valid_signature_owner_key() {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(key_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let msg_hash: felt252 = 0xdeadbeef_felt252;
    let (r, s) = key_pair.sign(msg_hash).unwrap();

    let result = account.is_valid_signature(msg_hash, array![r, s]);
    assert(result == 'VALID', 'Owner signature should be valid');
}

#[test]
fn test_is_valid_signature_wrong_key_returns_invalid() {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(key_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let msg_hash: felt252 = 0xdeadbeef_felt252;
    // Sign with a DIFFERENT key pair — should not validate as owner
    let other_pair = StarkCurveKeyPairImpl::generate();
    let (r, s) = other_pair.sign(msg_hash).unwrap();

    let result = account.is_valid_signature(msg_hash, array![r, s]);
    assert(result == 'INVALID', 'Wrong key should return INVALID');
}

#[test]
fn test_is_valid_signature_wrong_hash_returns_invalid() {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(key_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let msg_hash: felt252 = 0xdeadbeef_felt252;
    let (r, s) = key_pair.sign(msg_hash).unwrap();

    // Check against a DIFFERENT hash
    let different_hash: felt252 = 0xcafebabe_felt252;
    let result = account.is_valid_signature(different_hash, array![r, s]);
    assert(result == 'INVALID', 'Wrong hash: should be INVALID');
}

// =========================================================================
// SESSION KEY MANAGEMENT TESTS
// =========================================================================

#[test]
fn test_register_session_key() {
    let owner_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(owner_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let session_pair = StarkCurveKeyPairImpl::generate();
    let expiry: u64 = 9999999999_u64;
    let limit = 1_00000000_u256;
    let zero_addr: ContractAddress = 0.try_into().unwrap();

    // Must use self-call pattern
    start_cheat_caller_address(account_addr, account_addr);
    account.register_session_key(session_pair.public_key, expiry, limit, zero_addr);
    stop_cheat_caller_address(account_addr);

    assert(account.is_session_key_valid(session_pair.public_key), 'Session key should be valid');
}

#[test]
#[should_panic(expected: 'Only account can call')]
fn test_register_session_key_requires_self_call() {
    let owner_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(owner_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let session_pair = StarkCurveKeyPairImpl::generate();
    let zero_addr: ContractAddress = 0.try_into().unwrap();

    // Call from OUTSIDE the account — should fail
    start_cheat_caller_address(account_addr, 0xA11CE.try_into().unwrap());
    account.register_session_key(session_pair.public_key, 9999999_u64, 0_u256, zero_addr);
    stop_cheat_caller_address(account_addr);
}

#[test]
fn test_revoke_session_key() {
    let owner_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(owner_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let session_pair = StarkCurveKeyPairImpl::generate();
    let zero_addr: ContractAddress = 0.try_into().unwrap();

    start_cheat_caller_address(account_addr, account_addr);
    account.register_session_key(session_pair.public_key, 9999999999_u64, 0_u256, zero_addr);
    assert(account.is_session_key_valid(session_pair.public_key), 'Should be valid after register');

    account.revoke_session_key(session_pair.public_key);
    stop_cheat_caller_address(account_addr);

    assert(!account.is_session_key_valid(session_pair.public_key), 'Should be invalid after revoke');
}

#[test]
fn test_session_key_invalid_after_expiry() {
    let owner_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(owner_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let session_pair = StarkCurveKeyPairImpl::generate();
    let zero_addr: ContractAddress = 0.try_into().unwrap();

    // Set block time to 1000, register key expiring at 2000
    start_cheat_block_timestamp(account_addr, 1000_u64);

    start_cheat_caller_address(account_addr, account_addr);
    account.register_session_key(session_pair.public_key, 2000_u64, 0_u256, zero_addr);
    stop_cheat_caller_address(account_addr);

    assert(account.is_session_key_valid(session_pair.public_key), 'Should be valid at t=1000');

    // Advance block time past expiry
    stop_cheat_block_timestamp(account_addr);
    start_cheat_block_timestamp(account_addr, 3000_u64);

    assert(!account.is_session_key_valid(session_pair.public_key), 'Should be invalid at t=3000');

    stop_cheat_block_timestamp(account_addr);
}

#[test]
#[should_panic(expected: 'Session key already active')]
fn test_cannot_register_duplicate_session_key() {
    let owner_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(owner_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let session_pair = StarkCurveKeyPairImpl::generate();
    let zero_addr: ContractAddress = 0.try_into().unwrap();

    start_cheat_caller_address(account_addr, account_addr);
    account.register_session_key(session_pair.public_key, 9999999999_u64, 0_u256, zero_addr);
    account.register_session_key(session_pair.public_key, 9999999999_u64, 0_u256, zero_addr); // Must fail
    stop_cheat_caller_address(account_addr);
}

#[test]
fn test_is_valid_signature_with_active_session_key() {
    let owner_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(owner_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let session_pair = StarkCurveKeyPairImpl::generate();
    let zero_addr: ContractAddress = 0.try_into().unwrap();

    start_cheat_caller_address(account_addr, account_addr);
    account.register_session_key(session_pair.public_key, 9999999999_u64, 0_u256, zero_addr);
    stop_cheat_caller_address(account_addr);

    let msg_hash: felt252 = 0xabcdef_felt252;
    let (r, s) = session_pair.sign(msg_hash).unwrap();

    // Session key signature: [session_pubkey, r, s]
    let result = account
        .is_valid_signature(msg_hash, array![session_pair.public_key, r, s]);
    assert(result == 'VALID', 'Session key sig should be valid');
}

#[test]
fn test_is_valid_signature_with_revoked_session_key() {
    let owner_pair = StarkCurveKeyPairImpl::generate();
    let account_addr = deploy_shielded_account(owner_pair.public_key, dummy_vault());
    let account = IShieldedAccountDispatcher { contract_address: account_addr };

    let session_pair = StarkCurveKeyPairImpl::generate();
    let zero_addr: ContractAddress = 0.try_into().unwrap();

    start_cheat_caller_address(account_addr, account_addr);
    account.register_session_key(session_pair.public_key, 9999999999_u64, 0_u256, zero_addr);
    account.revoke_session_key(session_pair.public_key);
    stop_cheat_caller_address(account_addr);

    let msg_hash: felt252 = 0xabcdef_felt252;
    let (r, s) = session_pair.sign(msg_hash).unwrap();

    // Revoked key should NOT validate
    let result = account
        .is_valid_signature(msg_hash, array![session_pair.public_key, r, s]);
    assert(result == 'INVALID', 'Revoked key should be INVALID');
}
