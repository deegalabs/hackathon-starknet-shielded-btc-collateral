/// SessionKeyManager — Standalone session key registry infrastructure primitive.
///
/// Any Starknet smart account can delegate session key management to this
/// contract, decoupling key registry logic from account implementation.
///
/// Why this is an infrastructure primitive:
///   - Any account (ShieldedAccount, OZ Account, custom) can use this registry
///   - DeFi protocols can verify session keys here without knowing the account type
///   - One shared registry → no duplicated key management code across accounts
///   - Upgradeable: accounts can switch to a new SessionKeyManager without touching
///     their own contract
///
/// Key management is scoped per account address:
///   storage key = (account_address, session_public_key) → SessionKeyData
#[starknet::contract]
pub mod SessionKeyManager {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{StorageMapReadAccess, StorageMapWriteAccess};

    // =========================================================================
    // Session Key Data
    // =========================================================================

    #[derive(Drop, Serde, starknet::Store)]
    struct SessionKeyData {
        expiry_timestamp: u64,
        spending_limit: u256,
        spent: u256,
        allowed_contract: ContractAddress,
        is_active: bool,
    }

    // =========================================================================
    // Storage
    // =========================================================================

    #[storage]
    struct Storage {
        /// sessions[(account, session_pubkey)] → SessionKeyData
        sessions: starknet::storage::Map<(ContractAddress, felt252), SessionKeyData>,
    }

    // =========================================================================
    // Events
    // =========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SessionRegistered: SessionRegistered,
        SessionRevoked: SessionRevoked,
        SpendingRecorded: SpendingRecorded,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionRegistered {
        #[key]
        pub account: ContractAddress,
        #[key]
        pub session_public_key: felt252,
        pub expiry_timestamp: u64,
        pub spending_limit: u256,
        pub allowed_contract: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionRevoked {
        #[key]
        pub account: ContractAddress,
        #[key]
        pub session_public_key: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SpendingRecorded {
        #[key]
        pub account: ContractAddress,
        #[key]
        pub session_public_key: felt252,
        pub amount: u256,
        pub total_spent: u256,
    }

    // =========================================================================
    // External functions
    // =========================================================================

    #[abi(embed_v0)]
    impl SessionKeyManagerImpl of shielded_btc_collateral::interfaces::isession_key_manager::ISessionKeyManager<ContractState> {
        /// Register a session key for the caller's account.
        fn register_session(
            ref self: ContractState,
            session_public_key: felt252,
            expiry_timestamp: u64,
            spending_limit: u256,
            allowed_contract: ContractAddress,
        ) {
            let account = get_caller_address();
            assert(session_public_key != 0, 'Session key cannot be zero');
            assert(expiry_timestamp > get_block_timestamp(), 'Expiry already passed');

            let existing = self.sessions.read((account, session_public_key));
            assert(!existing.is_active, 'Session key already active');

            self
                .sessions
                .write(
                    (account, session_public_key),
                    SessionKeyData {
                        expiry_timestamp,
                        spending_limit,
                        spent: 0_u256,
                        allowed_contract,
                        is_active: true,
                    },
                );

            self
                .emit(
                    SessionRegistered {
                        account,
                        session_public_key,
                        expiry_timestamp,
                        spending_limit,
                        allowed_contract,
                    },
                );
        }

        /// Revoke a session key. Only the registering account can revoke.
        fn revoke_session(ref self: ContractState, session_public_key: felt252) {
            let account = get_caller_address();
            let mut session = self.sessions.read((account, session_public_key));
            assert(session.is_active, 'Session key not active');
            session.is_active = false;
            self.sessions.write((account, session_public_key), session);
            self.emit(SessionRevoked { account, session_public_key });
        }

        /// Returns true if the session key is valid for the given account.
        fn is_valid_session(
            self: @ContractState, account: ContractAddress, session_public_key: felt252,
        ) -> bool {
            let session = self.sessions.read((account, session_public_key));
            if !session.is_active {
                return false;
            }
            if get_block_timestamp() > session.expiry_timestamp {
                return false;
            }
            if session.spending_limit > 0_u256 && session.spent >= session.spending_limit {
                return false;
            }
            true
        }

        /// Record spending against a session key's limit.
        ///
        /// [H-07 Fix] Only the account itself can record spending for its session keys.
        /// This prevents griefing attacks where an attacker calls record_spending(victim, ...)
        /// to exhaust a victim's session key spending limits without any actual transaction.
        ///
        /// In production: the ShieldedAccount calls this from within __execute__ after
        /// validating a session-key-signed transaction.
        fn record_spending(
            ref self: ContractState,
            account: ContractAddress,
            session_public_key: felt252,
            amount: u256,
        ) {
            assert(get_caller_address() == account, 'Unauthorized: not account');
            let mut session = self.sessions.read((account, session_public_key));
            assert(session.is_active, 'Session key not active');
            assert(get_block_timestamp() <= session.expiry_timestamp, 'Session expired');

            if session.spending_limit > 0_u256 {
                let new_spent = session.spent + amount;
                assert(new_spent <= session.spending_limit, 'Spending limit exceeded');
                session.spent = new_spent;
                self.sessions.write((account, session_public_key), session);

                self
                    .emit(
                        SpendingRecorded {
                            account, session_public_key, amount, total_spent: new_spent,
                        },
                    );
            }
        }

        /// Returns full session details.
        fn get_session_info(
            self: @ContractState, account: ContractAddress, session_public_key: felt252,
        ) -> (u64, u256, u256, ContractAddress, bool) {
            let session = self.sessions.read((account, session_public_key));
            (
                session.expiry_timestamp,
                session.spending_limit,
                session.spent,
                session.allowed_contract,
                session.is_active,
            )
        }
    }
}
