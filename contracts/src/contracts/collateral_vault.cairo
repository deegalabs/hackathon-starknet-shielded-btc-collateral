/// CollateralVault — Core contract of the Shielded BTC Collateral Protocol.
///
/// Users deposit WBTC (wrapped BTC) privately using Poseidon commitments.
///   commitment = Poseidon(amount_low, amount_high, secret)
///
/// Other DeFi protocols verify collateral WITHOUT learning the exact amount:
///   vault.prove_collateral(user, threshold, proof) -> bool
///
/// Withdrawals require knowledge of the deposit preimage (amount + secret),
/// preventing unauthorized withdrawals while keeping amounts private:
///   nullifier = Poseidon(commitment, secret)
///
/// Privacy model (H-07 fix — March 7, 2026):
///   - NO plaintext `committed_amounts` storage (removed)
///   - prove_collateral delegates to on-chain verifier (stub in MVP)
///   - withdraw verifies Poseidon preimage on-chain
///   - No amount is ever stored or emitted in plaintext
///
/// Production upgrade path (Phase 2):
///   - Replace StubProofVerifier with RangeProofVerifier
///   - Call set_verifier(new_verifier) — zero downtime upgrade
///   - prove_collateral will delegate to the on-chain STARK verifier
///
/// Security audit: SECURITY.md (v2.0, H-07 fix applied)
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
    use shielded_btc_collateral::interfaces::iproof_verifier::{
        IProofVerifierDispatcher, IProofVerifierDispatcherTrait,
    };

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
        /// ZK proof verifier address.
        /// MVP: StubProofVerifier (returns commitment != 0, no threshold check).
        /// Production: RangeProofVerifier — validates STARK range proof on-chain.
        /// Set via set_verifier() admin call. Zero address = use commitment-only fallback.
        verifier: ContractAddress,
        /// Maps user address → Poseidon commitment (0 if no active deposit).
        /// commitment = Poseidon(amount_low, amount_high, secret)
        ///
        /// [H-07 Fix] This is the ONLY amount-related field stored on-chain.
        /// No plaintext `committed_amounts` map exists — amounts stay private.
        commitments: starknet::storage::Map<ContractAddress, felt252>,
        /// Maps nullifier → used flag. Prevents double-spending.
        /// nullifier = Poseidon(commitment, secret)
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
        ///   3. Emit Deposited event (commitment only — no amount disclosed).
        ///
        /// The caller must approve this contract for at least `amount` WBTC before calling.
        /// commitment = Poseidon(amount_low, amount_high, secret) — computed off-chain.
        ///
        /// [H-07 Fix] Amount is NOT stored in plaintext. Only the Poseidon commitment is kept.
        fn deposit(ref self: ContractState, amount: u256, commitment: felt252) {
            assert(!self.paused.read(), 'Vault is paused');
            assert(amount > 0_u256, 'Amount must be positive');
            assert(commitment != 0, 'Commitment cannot be zero');

            let caller = get_caller_address();

            // [H-01] Prevent overwriting an active commitment.
            assert(self.commitments.read(caller) == 0, 'Commitment already active');

            let vault = get_contract_address();
            let wbtc = IERC20Dispatcher { contract_address: self.wbtc_token.read() };
            let success = wbtc.transfer_from(caller, vault, amount);
            assert(success, 'WBTC transfer failed');

            // [H-07 Fix] Store commitment only — amount stays private.
            self.commitments.write(caller, commitment);

            let current_total = self.total_locked.read();
            self.total_locked.write(current_total + amount);

            self.emit(Deposited { user: caller, commitment });
        }

        /// Prove that a user's committed collateral meets or exceeds a threshold.
        ///
        /// [H-07 Fix] Delegates to the on-chain verifier — never reads a plaintext amount.
        ///
        /// MVP behavior (verifier not set or StubProofVerifier):
        ///   Returns `commitment != 0` — confirms deposit existence, not exact threshold.
        ///   NOTE: The stub does NOT enforce the threshold; that requires production verifier.
        ///
        /// Production behavior (RangeProofVerifier):
        ///   Validates the STARK proof that committed_amount >= threshold,
        ///   without revealing the exact amount.
        ///
        /// `proof` parameter: empty span for stub, STARK proof bytes for production.
        fn prove_collateral(
            self: @ContractState,
            user: ContractAddress,
            threshold: u256,
            proof: Span<felt252>,
        ) -> bool {
            let commitment = self.commitments.read(user);
            if commitment == 0 {
                return false;
            }

            let verifier_addr = self.verifier.read();
            let zero: ContractAddress = 0.try_into().unwrap();

            if verifier_addr == zero {
                // No verifier configured: fall back to commitment-existence check.
                // This confirms the user has an active deposit (commitment != 0).
                // Threshold enforcement requires calling set_verifier() with a real verifier.
                return true;
            }

            let verifier = IProofVerifierDispatcher { contract_address: verifier_addr };
            verifier.verify_range_proof(commitment, threshold, proof)
        }

        /// Withdraw WBTC using cryptographic preimage proof.
        ///
        /// The caller must supply the original `secret` used during deposit.
        /// The contract verifies on-chain:
        ///   1. Poseidon(amount_low, amount_high, secret) == stored_commitment
        ///   2. nullifier == Poseidon(commitment, secret)
        ///
        /// This ensures:
        ///   - Only the original depositor (who knows `secret`) can withdraw.
        ///   - The exact amount is verified cryptographically, NOT via plaintext storage.
        ///   - The nullifier cannot be forged independently of commitment + secret.
        ///
        /// [H-07 Fix] Amount integrity is now cryptographic (preimage), not plaintext.
        ///
        /// Security checks (in order):
        ///   1. Vault not paused
        ///   2. Nullifier not yet used (double-spend prevention, cheap read first)
        ///   3. Caller has an active commitment (ownership check)
        ///   4. Preimage check: Poseidon(amount, secret) == commitment (amount integrity)
        ///   5. Nullifier validity: Poseidon(commitment, secret) == nullifier (forgery prevention)
        fn withdraw(ref self: ContractState, amount: u256, secret: felt252, nullifier: felt252) {
            assert(!self.paused.read(), 'Vault is paused');
            assert(amount > 0_u256, 'Amount must be positive');
            assert(nullifier != 0, 'Nullifier cannot be zero');

            let caller = get_caller_address();

            // [C-01] Nullifier check first — cheap storage read, prevents double-spend.
            assert(!self.nullifiers.read(nullifier), 'Nullifier already used');

            // [C-01] Ownership check: caller must have an active commitment.
            let stored_commitment = self.commitments.read(caller);
            assert(stored_commitment != 0, 'No active commitment');

            // [H-07 Fix / C-02] Cryptographic preimage check:
            // The caller must know the secret used during deposit.
            // Poseidon(amount_low, amount_high, secret) must match stored commitment.
            let expected_commitment = InternalImpl::compute_commitment(amount, secret);
            assert(expected_commitment == stored_commitment, 'Invalid preimage');

            // Nullifier validity: prevents using an arbitrary nullifier to front-run withdrawals.
            // The nullifier must be Poseidon(commitment, secret).
            let expected_nullifier = InternalImpl::compute_nullifier(stored_commitment, secret);
            assert(expected_nullifier == nullifier, 'Invalid nullifier');

            // CEI pattern: update state BEFORE external call (reentrancy protection).
            self.nullifiers.write(nullifier, true);
            self.commitments.write(caller, 0);

            let wbtc = IERC20Dispatcher { contract_address: self.wbtc_token.read() };
            let success = wbtc.transfer(caller, amount);
            assert(success, 'WBTC transfer failed');

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

        /// Compute a nullifier: Poseidon(commitment, secret).
        fn compute_nullifier(commitment: felt252, secret: felt252) -> felt252 {
            poseidon_hash_span(array![commitment, secret].span())
        }
    }
}
