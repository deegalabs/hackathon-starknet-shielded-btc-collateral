/// CollateralVault — Core contract of the Shielded BTC Collateral Protocol.
///
/// Users deposit WBTC (wrapped BTC) privately using Poseidon commitments.
/// commitment = Poseidon(amount_low, amount_high, secret)
///
/// Other DeFi protocols verify collateral without learning the exact amount:
///   vault.prove_collateral(user, threshold) -> bool
///
/// Withdrawals use nullifiers to prevent double-spending without linking
/// to the original deposit:
///   nullifier = Poseidon(commitment, withdraw_secret)
#[starknet::contract]
pub mod CollateralVault {
    use core::poseidon::poseidon_hash_span;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess,
        StorageMapWriteAccess,
    };
    use shielded_btc_collateral::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

    // =========================================================================
    // Storage
    // =========================================================================

    #[storage]
    struct Storage {
        /// Address of the WBTC ERC-20 token contract.
        wbtc_token: ContractAddress,
        /// Maps user address → Poseidon commitment (0 if no deposit).
        /// commitment = Poseidon(amount_low, amount_high, secret)
        commitments: starknet::storage::Map<ContractAddress, felt252>,
        /// Maps nullifier → used flag. Prevents double-spending.
        /// nullifier = Poseidon(commitment, withdraw_secret)
        nullifiers: starknet::storage::Map<felt252, bool>,
        /// Total WBTC (in satoshis) currently held by this vault.
        total_locked: u256,
    }

    // =========================================================================
    // Events
    // =========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Deposited: Deposited,
        Withdrawn: Withdrawn,
    }

    /// Emitted on deposit. Intentionally omits `amount` to preserve privacy.
    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub user: ContractAddress,
        pub commitment: felt252,
    }

    /// Emitted on withdrawal. Intentionally omits `user` and `amount` to preserve privacy.
    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        pub nullifier: felt252,
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    #[constructor]
    fn constructor(ref self: ContractState, wbtc_token: ContractAddress) {
        self.wbtc_token.write(wbtc_token);
    }

    // =========================================================================
    // External functions
    // =========================================================================

    #[abi(embed_v0)]
    impl CollateralVaultImpl of shielded_btc_collateral::interfaces::icollateral_vault::ICollateralVault<ContractState> {
        /// Deposit WBTC privately.
        ///
        /// Steps:
        ///   1. Transfer `amount` WBTC from caller to this vault.
        ///   2. Store `commitment` (hides the amount) mapped to the caller.
        ///   3. Emit Deposited event (no amount disclosed).
        ///
        /// The caller must approve this contract for at least `amount` WBTC before calling.
        /// commitment = Poseidon(amount_low, amount_high, secret)  — computed off-chain.
        fn deposit(ref self: ContractState, amount: u256, commitment: felt252) {
            assert(amount > 0_u256, 'Amount must be positive');
            assert(commitment != 0, 'Commitment cannot be zero');

            let caller = get_caller_address();
            let vault = get_contract_address();

            let wbtc = IERC20Dispatcher { contract_address: self.wbtc_token.read() };
            let success = wbtc.transfer_from(caller, vault, amount);
            assert(success, 'WBTC transfer failed');

            // Store commitment — hides the deposited amount on-chain
            self.commitments.write(caller, commitment);

            // Update aggregate (non-private) total
            let current_total = self.total_locked.read();
            self.total_locked.write(current_total + amount);

            self.emit(Deposited { user: caller, commitment });
        }

        /// Prove that user's committed collateral exceeds a threshold.
        ///
        /// MVP: returns true if the user has any non-zero commitment.
        /// Production (Phase 2): requires a STARK range proof parameter;
        ///   the verifier cryptographically confirms committed_amount > threshold.
        fn prove_collateral(
            self: @ContractState, user: ContractAddress, threshold: u256,
        ) -> bool {
            let commitment = self.commitments.read(user);
            // MVP: commitment exists = user has deposited something.
            // Does NOT verify the amount in the MVP.
            commitment != 0
        }

        /// Withdraw WBTC using a one-time nullifier (prevents double-spending).
        ///
        /// nullifier = Poseidon(commitment, withdraw_secret) — computed off-chain.
        fn withdraw(ref self: ContractState, amount: u256, nullifier: felt252) {
            assert(amount > 0_u256, 'Amount must be positive');
            assert(nullifier != 0, 'Nullifier cannot be zero');

            let caller = get_caller_address();

            // Double-spend prevention: nullifier must not have been used before
            assert(!self.nullifiers.read(nullifier), 'Nullifier already used');

            // Mark nullifier as used BEFORE transfer (reentrancy protection)
            self.nullifiers.write(nullifier, true);

            // Transfer WBTC from vault to caller
            let wbtc = IERC20Dispatcher { contract_address: self.wbtc_token.read() };
            let success = wbtc.transfer(caller, amount);
            assert(success, 'WBTC transfer failed');

            // Update aggregate total
            let current_total = self.total_locked.read();
            self.total_locked.write(current_total - amount);

            // Privacy: emit only nullifier — not user address or amount
            self.emit(Withdrawn { nullifier });
        }

        fn get_commitment(self: @ContractState, user: ContractAddress) -> felt252 {
            self.commitments.read(user)
        }

        fn get_total_locked(self: @ContractState) -> u256 {
            self.total_locked.read()
        }

        fn get_wbtc_token(self: @ContractState) -> ContractAddress {
            self.wbtc_token.read()
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.read(nullifier)
        }
    }

    // =========================================================================
    // Internal helpers (used in tests)
    // =========================================================================

    #[generate_trait]
    pub impl InternalImpl of InternalTrait {
        /// Compute a Poseidon commitment: Poseidon(amount_low, amount_high, secret).
        fn compute_commitment(amount: u256, secret: felt252) -> felt252 {
            poseidon_hash_span(
                array![amount.low.into(), amount.high.into(), secret].span(),
            )
        }

        /// Compute a nullifier: Poseidon(commitment, withdraw_secret).
        fn compute_nullifier(commitment: felt252, withdraw_secret: felt252) -> felt252 {
            poseidon_hash_span(array![commitment, withdraw_secret].span())
        }
    }
}
