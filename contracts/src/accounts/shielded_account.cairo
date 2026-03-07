/// ShieldedAccount — Privacy-aware Starknet smart account.
///
/// Implements SNIP-6 (Account) + SNIP-5 (Signature Validation) with:
///   - Owner authentication via Stark ECDSA (secp256k1 on the STARK curve)
///   - Session key delegation with expiry, spending limits, and contract scoping
///   - CollateralVault integration (the account knows about the user's vault)
///
/// Why Account Abstraction matters for privacy:
///   - Session keys let DApps interact with the vault without exposing
///     the owner's private key on every transaction
///   - Paymaster integration (Phase 2) enables gasless vault interactions,
///     removing the need for STRK tokens (onboarding friction)
///   - Social recovery (Phase 3) lets users regain access without seed phrases
///
/// Signature Formats:
///   Owner:   [sig_r, sig_s]                 — 2 elements
///   Session: [session_pubkey, sig_r, sig_s] — 3 elements
///
/// Self-call pattern for management functions:
///   Management functions (register/revoke session keys) require caller == contract_address.
///   This means they must be invoked through __execute__ (which validates owner sig),
///   or via start_cheat_caller_address(account, account) in tests.
#[starknet::contract(account)]
pub mod ShieldedAccount {
    use core::ecdsa::check_ecdsa_signature;
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address, get_block_timestamp,
        get_tx_info, VALIDATED,
    };
    use starknet::account::Call;
    use starknet::syscalls::call_contract_syscall;
    use starknet::SyscallResultTrait;
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess,
        StorageMapWriteAccess,
    };

    // =========================================================================
    // Session Key Data
    // =========================================================================

    /// Scoped delegation parameters for a single session key.
    #[derive(Drop, Serde, starknet::Store)]
    struct SessionKeyData {
        /// Unix timestamp (seconds) when this key stops being valid.
        expiry_timestamp: u64,
        /// Max WBTC amount (satoshis) this session can authorize. 0 = unlimited.
        spending_limit: u256,
        /// Amount already spent in this session.
        spent_this_session: u256,
        /// Restricts the session to a specific contract. Zero address = any contract.
        allowed_contract: ContractAddress,
        /// False if the key has been revoked by the owner.
        is_active: bool,
    }

    // =========================================================================
    // Storage
    // =========================================================================

    #[storage]
    struct Storage {
        /// Owner's Stark-curve public key. Validates owner-signed transactions.
        owner_public_key: felt252,
        /// CollateralVault linked to this account. Used for UX context.
        vault_address: ContractAddress,
        /// Map: session public key → session data.
        session_keys: starknet::storage::Map<felt252, SessionKeyData>,
    }

    // =========================================================================
    // Events
    // =========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SessionKeyRegistered: SessionKeyRegistered,
        SessionKeyRevoked: SessionKeyRevoked,
        TransactionExecuted: TransactionExecuted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionKeyRegistered {
        #[key]
        pub session_public_key: felt252,
        pub expiry_timestamp: u64,
        pub spending_limit: u256,
        pub allowed_contract: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionKeyRevoked {
        #[key]
        pub session_public_key: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TransactionExecuted {
        pub tx_hash: felt252,
        pub calls_count: usize,
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    #[constructor]
    fn constructor(
        ref self: ContractState, owner_public_key: felt252, vault_address: ContractAddress,
    ) {
        assert(owner_public_key != 0, 'Owner key cannot be zero');
        self.owner_public_key.write(owner_public_key);
        self.vault_address.write(vault_address);
    }

    // =========================================================================
    // SNIP-6: Account Interface
    // =========================================================================

    #[abi(embed_v0)]
    impl ShieldedAccountImpl of shielded_btc_collateral::interfaces::ishielded_account::IShieldedAccount<ContractState> {
        /// Execute a multicall. Only callable by the Starknet protocol (caller = address(0)).
        ///
        /// The protocol calls this AFTER __validate__ has authenticated the transaction.
        /// Iterates over all calls and executes them via syscall.
        fn __execute__(
            ref self: ContractState, calls: Array<Call>,
        ) -> Array<Span<felt252>> {
            // Only the Starknet protocol (address 0) can trigger __execute__
            let caller = get_caller_address();
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(caller == zero, 'Only protocol can execute');

            let tx_info = get_tx_info().unbox();
            let tx_hash = tx_info.transaction_hash;
            let calls_count = calls.len();

            let mut results: Array<Span<felt252>> = array![];
            let mut calls_span = calls.span();

            loop {
                match calls_span.pop_front() {
                    Option::None => { break; },
                    Option::Some(call) => {
                        let result = call_contract_syscall(
                            *call.to, *call.selector, *call.calldata,
                        )
                            .unwrap_syscall();
                        results.append(result);
                    },
                }
            };

            self.emit(TransactionExecuted { tx_hash, calls_count });
            results
        }

        /// Validate a transaction before execution.
        ///
        /// Checks:
        ///   1. If signature has 2 elements → try owner Stark ECDSA
        ///   2. If signature has 3 elements → try session key Stark ECDSA
        ///   3. If neither validates → panic (transaction rejected)
        fn __validate__(ref self: ContractState, calls: Array<Call>) -> felt252 {
            let tx_info = get_tx_info().unbox();
            let tx_hash = tx_info.transaction_hash;
            let signature = tx_info.signature;

            // Owner signature: [sig_r, sig_s]
            if signature.len() == 2 {
                let sig_r = *signature[0];
                let sig_s = *signature[1];
                let owner_key = self.owner_public_key.read();
                if check_ecdsa_signature(tx_hash, owner_key, sig_r, sig_s) {
                    return VALIDATED;
                }
            }

            // Session key signature: [session_pubkey, sig_r, sig_s]
            // [H-05 Fix] Pass calls.span() to enforce allowed_contract restriction.
            if signature.len() == 3 {
                let session_pubkey = *signature[0];
                let sig_r = *signature[1];
                let sig_s = *signature[2];
                if self._validate_session_sig(
                    session_pubkey, tx_hash, sig_r, sig_s, calls.span(),
                ) {
                    return VALIDATED;
                }
            }

            panic!("INVALID_SIGNATURE")
        }

        /// SNIP-5: Verify a signature off-chain.
        ///
        /// Returns 'VALID' for valid owner or session signatures, 'INVALID' otherwise.
        /// Used by DApps to verify the account can authorize a particular hash.
        fn is_valid_signature(
            self: @ContractState, hash: felt252, signature: Array<felt252>,
        ) -> felt252 {
            // Owner signature: [sig_r, sig_s]
            if signature.len() == 2 {
                let sig_r = *signature[0];
                let sig_s = *signature[1];
                let owner_key = self.owner_public_key.read();
                if check_ecdsa_signature(hash, owner_key, sig_r, sig_s) {
                    return 'VALID';
                }
            }

            // Session key signature: [session_pubkey, sig_r, sig_s]
            if signature.len() == 3 {
                let session_pubkey = *signature[0];
                let sig_r = *signature[1];
                let sig_s = *signature[2];
                let session = self.session_keys.read(session_pubkey);
                if session.is_active {
                    let current_time = get_block_timestamp();
                    if current_time <= session.expiry_timestamp {
                        if check_ecdsa_signature(hash, session_pubkey, sig_r, sig_s) {
                            return 'VALID';
                        }
                    }
                }
            }

            'INVALID'
        }

        /// Register a new session key for delegated DApp access.
        ///
        /// Must be called via the account itself (self-call through __execute__).
        /// In tests: use start_cheat_caller_address(account_addr, account_addr).
        fn register_session_key(
            ref self: ContractState,
            session_public_key: felt252,
            expiry_timestamp: u64,
            spending_limit: u256,
            allowed_contract: ContractAddress,
        ) {
            self._assert_only_self();
            assert(session_public_key != 0, 'Session key cannot be zero');
            assert(expiry_timestamp > get_block_timestamp(), 'Expiry already passed');

            let existing = self.session_keys.read(session_public_key);
            assert(!existing.is_active, 'Session key already active');

            self
                .session_keys
                .write(
                    session_public_key,
                    SessionKeyData {
                        expiry_timestamp,
                        spending_limit,
                        spent_this_session: 0_u256,
                        allowed_contract,
                        is_active: true,
                    },
                );

            self
                .emit(
                    SessionKeyRegistered {
                        session_public_key, expiry_timestamp, spending_limit, allowed_contract,
                    },
                );
        }

        /// Revoke a session key before its natural expiry.
        ///
        /// Must be called via the account itself (self-call through __execute__).
        fn revoke_session_key(ref self: ContractState, session_public_key: felt252) {
            self._assert_only_self();
            let mut session = self.session_keys.read(session_public_key);
            assert(session.is_active, 'Session key not active');
            session.is_active = false;
            self.session_keys.write(session_public_key, session);
            self.emit(SessionKeyRevoked { session_public_key });
        }

        /// Returns true if the session key is currently valid:
        ///   - is_active == true
        ///   - current_time <= expiry_timestamp
        ///   - spent_this_session < spending_limit (if limit is set)
        fn is_session_key_valid(self: @ContractState, session_public_key: felt252) -> bool {
            let session = self.session_keys.read(session_public_key);
            if !session.is_active {
                return false;
            }
            if get_block_timestamp() > session.expiry_timestamp {
                return false;
            }
            if session.spending_limit > 0_u256
                && session.spent_this_session >= session.spending_limit {
                return false;
            }
            true
        }

        fn get_owner_public_key(self: @ContractState) -> felt252 {
            self.owner_public_key.read()
        }

        fn get_vault_address(self: @ContractState) -> ContractAddress {
            self.vault_address.read()
        }
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Enforces the self-call pattern for management functions.
        ///
        /// Management functions must be invoked through the account's own __execute__,
        /// meaning the caller must be this contract address (self-call).
        /// In production: owner signs a tx with Call { to: self, selector: register..., ... }
        /// In tests: use start_cheat_caller_address(account_addr, account_addr)
        fn _assert_only_self(ref self: ContractState) {
            let caller = get_caller_address();
            let this = get_contract_address();
            assert(caller == this, 'Only account can call');
        }

        /// Validate a session key signature.
        ///
        /// Checks (in order):
        ///   1. Session is active (not revoked)
        ///   2. Not expired (current_time <= expiry_timestamp)
        ///   3. Within spending limit (spent < limit, or limit == 0 for unlimited)
        ///   4. [H-05 Fix] all calls target allowed_contract (if restriction is set)
        ///   5. Valid Stark ECDSA signature for tx_hash
        fn _validate_session_sig(
            ref self: ContractState,
            session_pubkey: felt252,
            tx_hash: felt252,
            sig_r: felt252,
            sig_s: felt252,
            calls: Span<Call>,
        ) -> bool {
            let session = self.session_keys.read(session_pubkey);
            if !session.is_active {
                return false;
            }
            if get_block_timestamp() > session.expiry_timestamp {
                return false;
            }
            if session.spending_limit > 0_u256
                && session.spent_this_session >= session.spending_limit {
                return false;
            }

            // [H-05 Fix] Enforce allowed_contract scope restriction.
            // If set, EVERY call in the transaction must target that contract.
            // This prevents a scoped session key from being abused to call
            // arbitrary contracts outside its intended scope.
            let zero: ContractAddress = 0.try_into().unwrap();
            if session.allowed_contract != zero {
                let mut calls_iter = calls;
                loop {
                    match calls_iter.pop_front() {
                        Option::None => { break; },
                        Option::Some(call) => {
                            if *call.to != session.allowed_contract {
                                return false;
                            }
                        },
                    }
                }
            }

            check_ecdsa_signature(tx_hash, session_pubkey, sig_r, sig_s)
        }
    }
}
