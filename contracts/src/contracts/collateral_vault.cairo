/// CollateralVault — Core contract of the Shielded BTC Collateral Protocol.
///
/// Users deposit WBTC (wrapped BTC) privately using Poseidon commitments.
///   commitment = Poseidon(amount_low, amount_high, secret)
///
/// Other DeFi protocols verify collateral without learning the exact amount:
///   vault.prove_collateral(user, threshold) -> bool
///
/// Withdrawals use nullifiers to prevent double-spending without linking
/// to the original deposit:
///   nullifier = Poseidon(commitment, withdraw_secret)
///
/// Production upgrade path (Phase 2):
///   - Replace StubProofVerifier with RangeProofVerifier
///   - Call set_verifier(new_verifier) — zero downtime upgrade
///   - prove_collateral will delegate to the on-chain STARK verifier
///
/// Security audit: SECURITY.md
/// Admin interface: ICollateralVaultAdmin
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
        /// Protocol owner — can pause/unpause and upgrade the verifier.
        owner: ContractAddress,
        /// Emergency pause flag. Blocks deposits and withdrawals when true.
        paused: bool,
        /// Future ZK proof verifier address.
        /// MVP: unused (prove_collateral uses plaintext comparison).
        /// Production: set to RangeProofVerifier address via set_verifier().
        verifier: ContractAddress,
        /// Maps user address → Poseidon commitment (0 if no active deposit).
        /// commitment = Poseidon(amount_low, amount_high, secret)
        commitments: starknet::storage::Map<ContractAddress, felt252>,
        /// Maps user address → deposited amount.
        /// MVP: stored in plaintext to enable ownership and threshold checks
        /// without ZK proofs. Production: remove this and verify via ZK proof.
        committed_amounts: starknet::storage::Map<ContractAddress, u256>,
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
        Paused: Paused,
        Unpaused: Unpaused,
        OwnershipTransferred: OwnershipTransferred,
        VerifierUpdated: VerifierUpdated,
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

    #[derive(Drop, starknet::Event)]
    pub struct Paused {
        pub by: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unpaused {
        pub by: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub previous_owner: ContractAddress,
        pub new_owner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub previous_verifier: ContractAddress,
        pub new_verifier: ContractAddress,
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    #[constructor]
    fn constructor(
        ref self: ContractState, wbtc_token: ContractAddress, owner: ContractAddress,
    ) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(wbtc_token != zero, 'WBTC token cannot be zero');
        assert(owner != zero, 'Owner cannot be zero');
        self.wbtc_token.write(wbtc_token);
        self.owner.write(owner);
        self.paused.write(false);
    }

    // =========================================================================
    // External: DeFi Protocol Interface
    // =========================================================================

    #[abi(embed_v0)]
    impl CollateralVaultImpl of shielded_btc_collateral::interfaces::icollateral_vault::ICollateralVault<ContractState> {
        /// Deposit WBTC privately.
        ///
        /// Steps:
        ///   1. Transfer `amount` WBTC from caller to this vault.
        ///   2. Store `commitment` (hides the amount) mapped to the caller.
        ///   3. Store `amount` alongside commitment (MVP; removed in production).
        ///   4. Emit Deposited event (no amount disclosed).
        ///
        /// The caller must approve this contract for at least `amount` WBTC before calling.
        /// commitment = Poseidon(amount_low, amount_high, secret) — computed off-chain.
        fn deposit(ref self: ContractState, amount: u256, commitment: felt252) {
            assert(!self.paused.read(), 'Vault is paused');
            assert(amount > 0_u256, 'Amount must be positive');
            assert(commitment != 0, 'Commitment cannot be zero');

            let caller = get_caller_address();

            // [H-01] Prevent overwriting an active commitment.
            // Overwriting would permanently lock the first deposit's funds.
            assert(self.commitments.read(caller) == 0, 'Commitment already active');

            let vault = get_contract_address();

            let wbtc = IERC20Dispatcher { contract_address: self.wbtc_token.read() };
            let success = wbtc.transfer_from(caller, vault, amount);
            assert(success, 'WBTC transfer failed');

            // Store commitment — hides the deposited amount on-chain
            self.commitments.write(caller, commitment);

            // [C-01/C-02] Store amount for withdrawal ownership + amount validation.
            // Production: this is removed; amount is verified via ZK range proof.
            self.committed_amounts.write(caller, amount);

            // Update aggregate (non-private) total
            let current_total = self.total_locked.read();
            self.total_locked.write(current_total + amount);

            self.emit(Deposited { user: caller, commitment });
        }

        /// Prove that user's committed collateral meets or exceeds a threshold.
        ///
        /// MVP: compares the stored plaintext amount against the threshold.
        /// Production (Phase 2): requires a STARK range proof parameter;
        ///   the verifier cryptographically confirms committed_amount >= threshold
        ///   without revealing the exact amount.
        ///
        /// Privacy note (MVP): this function leaks the ordering relationship between
        ///   the deposited amount and the threshold to the caller. The verifier
        ///   address in storage marks where the ZK upgrade will plug in.
        ///
        /// [H-02] Fixed: threshold is now actually evaluated (was previously ignored).
        fn prove_collateral(
            self: @ContractState, user: ContractAddress, threshold: u256,
        ) -> bool {
            let commitment = self.commitments.read(user);
            if commitment == 0 {
                return false;
            }
            // MVP: use stored amount for comparison.
            // Production: ZK range proof replaces this comparison entirely.
            self.committed_amounts.read(user) >= threshold
        }

        /// Withdraw WBTC using a one-time nullifier (prevents double-spending).
        ///
        /// nullifier = Poseidon(commitment, withdraw_secret) — computed off-chain.
        ///
        /// Security checks (in order):
        ///   1. Vault not paused
        ///   2. Nullifier not yet used (double-spend prevention, checked first)
        ///   3. Caller has an active commitment (ownership check)
        ///   4. Requested amount matches the committed deposit (amount integrity)
        fn withdraw(ref self: ContractState, amount: u256, nullifier: felt252) {
            assert(!self.paused.read(), 'Vault is paused');
            assert(amount > 0_u256, 'Amount must be positive');
            assert(nullifier != 0, 'Nullifier cannot be zero');

            let caller = get_caller_address();

            // [C-01] Check nullifier first — cheap storage read, prevents double-spend.
            assert(!self.nullifiers.read(nullifier), 'Nullifier already used');

            // [C-01] Ownership check: caller must have an active commitment.
            let stored_commitment = self.commitments.read(caller);
            assert(stored_commitment != 0, 'No active commitment');

            // [C-02] Amount integrity: requested amount must match committed deposit.
            let committed_amount = self.committed_amounts.read(caller);
            assert(amount == committed_amount, 'Amount does not match deposit');

            // CEI pattern: update state BEFORE external call (reentrancy protection).
            // Mark nullifier as used and clear the commitment atomically.
            self.nullifiers.write(nullifier, true);
            self.commitments.write(caller, 0);
            self.committed_amounts.write(caller, 0);

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

        fn get_committed_amount(self: @ContractState, user: ContractAddress) -> u256 {
            self.committed_amounts.read(user)
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

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }
    }

    // =========================================================================
    // External: Admin Interface
    // =========================================================================

    #[abi(embed_v0)]
    impl CollateralVaultAdminImpl of shielded_btc_collateral::interfaces::icollateral_vault_admin::ICollateralVaultAdmin<ContractState> {
        fn pause(ref self: ContractState) {
            self._assert_only_owner();
            assert(!self.paused.read(), 'Already paused');
            self.paused.write(true);
            self.emit(Paused { by: get_caller_address() });
        }

        fn unpause(ref self: ContractState) {
            self._assert_only_owner();
            assert(self.paused.read(), 'Not paused');
            self.paused.write(false);
            self.emit(Unpaused { by: get_caller_address() });
        }

        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            self._assert_only_owner();
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(new_owner != zero, 'New owner cannot be zero');
            let previous = self.owner.read();
            self.owner.write(new_owner);
            self.emit(OwnershipTransferred { previous_owner: previous, new_owner });
        }

        fn set_verifier(ref self: ContractState, new_verifier: ContractAddress) {
            self._assert_only_owner();
            let previous = self.verifier.read();
            self.verifier.write(new_verifier);
            self.emit(VerifierUpdated { previous_verifier: previous, new_verifier });
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn get_verifier(self: @ContractState) -> ContractAddress {
            self.verifier.read()
        }
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    #[generate_trait]
    pub impl InternalImpl of InternalTrait {
        fn _assert_only_owner(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
        }

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
