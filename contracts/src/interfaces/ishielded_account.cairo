use starknet::ContractAddress;
use starknet::account::Call;

/// ShieldedAccount — SNIP-6 compatible smart account with session key support.
///
/// Implements:
///   - SNIP-6 (Account): __execute__, __validate__
///   - SNIP-5 (Signature Validation): is_valid_signature
///   - Session Keys: temporary, scoped, spending-limited delegation
///
/// Signature formats accepted by __validate__ and is_valid_signature:
///   Owner:   [sig_r, sig_s]           — Stark ECDSA with owner_public_key
///   Session: [session_pubkey, sig_r, sig_s] — Stark ECDSA with session key
///
/// Session Key lifecycle:
///   1. Owner registers key: register_session_key(pubkey, expiry, limit, allowed_contract)
///   2. DApp signs transactions using the session key
///   3. __validate__ accepts session signatures within their scope
///   4. Key expires automatically at expiry_timestamp
///   5. Owner can revoke early: revoke_session_key(pubkey)
#[starknet::interface]
pub trait IShieldedAccount<TContractState> {
    // ── SNIP-6: Account ──────────────────────────────────────────────────────

    /// Execute a multicall. Only callable by the Starknet protocol (address 0).
    fn __execute__(ref self: TContractState, calls: Array<Call>) -> Array<Span<felt252>>;

    /// Validate transaction. Returns VALIDATED or panics.
    /// Accepts owner signature [r, s] or session signature [pubkey, r, s].
    fn __validate__(ref self: TContractState, calls: Array<Call>) -> felt252;

    // ── SNIP-5: Signature Validation ─────────────────────────────────────────

    /// Returns 'VALID' if signature is valid for the given hash, else 'INVALID'.
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Array<felt252>,
    ) -> felt252;

    // ── Session Key Management ────────────────────────────────────────────────

    /// Register a new session key. Only callable by the account itself (self-call).
    ///
    /// Parameters:
    ///   session_public_key: Stark curve public key for the session
    ///   expiry_timestamp:   Unix timestamp (seconds) when this key expires
    ///   spending_limit:     Max WBTC amount (satoshis) this session can authorize (0 = unlimited)
    ///   allowed_contract:   Restricts to a specific contract (zero address = any contract)
    fn register_session_key(
        ref self: TContractState,
        session_public_key: felt252,
        expiry_timestamp: u64,
        spending_limit: u256,
        allowed_contract: ContractAddress,
    );

    /// Revoke a session key immediately. Only callable by the account itself.
    fn revoke_session_key(ref self: TContractState, session_public_key: felt252);

    /// Returns true if the session key is active, not expired, and within its spending limit.
    fn is_session_key_valid(self: @TContractState, session_public_key: felt252) -> bool;

    // ── View Functions ────────────────────────────────────────────────────────

    /// Returns the account owner's Stark-curve public key.
    fn get_owner_public_key(self: @TContractState) -> felt252;

    /// Returns the CollateralVault address linked to this account.
    fn get_vault_address(self: @TContractState) -> ContractAddress;
}
