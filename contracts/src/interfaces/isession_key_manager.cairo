use starknet::ContractAddress;

/// Standalone session key registry — composable infrastructure primitive.
///
/// Any Starknet smart account can delegate session key management to this
/// contract, decoupling key registry logic from account logic.
///
/// Use cases:
///   - DApps register temporary keys for streamlined UX (no wallet popup per tx)
///   - Protocols verify session keys without implementing key management
///   - Shared key registry reduces code duplication across account implementations
///
/// Session key data returned by get_session_info:
///   (expiry_timestamp, spending_limit, spent, allowed_contract, is_active)
#[starknet::interface]
pub trait ISessionKeyManager<TContractState> {
    /// Register a session key for the caller's account.
    ///
    ///   session_public_key: Stark curve public key
    ///   expiry_timestamp:   Unix seconds expiry
    ///   spending_limit:     Max amount authorized (0 = unlimited)
    ///   allowed_contract:   Restrict to a contract (zero = any)
    fn register_session(
        ref self: TContractState,
        session_public_key: felt252,
        expiry_timestamp: u64,
        spending_limit: u256,
        allowed_contract: ContractAddress,
    );

    /// Revoke a session key. Only the account that registered it can revoke.
    fn revoke_session(ref self: TContractState, session_public_key: felt252);

    /// Returns true if the session is registered, active, and not expired.
    fn is_valid_session(
        self: @TContractState, account: ContractAddress, session_public_key: felt252,
    ) -> bool;

    /// Record spending against a session key limit.
    /// Reverts if the spending limit would be exceeded.
    fn record_spending(
        ref self: TContractState,
        account: ContractAddress,
        session_public_key: felt252,
        amount: u256,
    );

    /// Returns full session key details.
    /// Returns: (expiry_timestamp, spending_limit, spent, allowed_contract, is_active)
    fn get_session_info(
        self: @TContractState, account: ContractAddress, session_public_key: felt252,
    ) -> (u64, u256, u256, ContractAddress, bool);
}
