/// MockLendingProtocol — Composability demonstration for the CollateralVault.
///
/// Shows how any DeFi lending protocol integrates with private BTC collateral:
///   1. User deposits WBTC into CollateralVault (private, commitment-based)
///   2. User calls borrow(amount) on this protocol
///   3. This contract calls vault.prove_collateral(user, required_collateral)
///   4. The vault returns true/false WITHOUT revealing the deposited amount
///   5. If proof passes → loan is recorded; collateral stays private
///
/// LTV (Loan-to-Value) example at 70%:
///   User deposits 10 BTC (private)
///   User requests loan of 7 BTC equivalent
///   Required collateral = 7 * 100 / 70 ≈ 10 BTC
///   prove_collateral(user, 10 BTC) → true (10 >= 10) → loan approved
///
/// MVP note: this contract only tracks debt records (no real token transfers).
/// Integration: See docs/integration.md for production integration patterns.
#[starknet::contract]
pub mod MockLendingProtocol {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess,
        StorageMapWriteAccess,
    };
    use shielded_btc_collateral::interfaces::icollateral_vault::{
        ICollateralVaultDispatcher, ICollateralVaultDispatcherTrait,
    };

    // =========================================================================
    // Constants
    // =========================================================================

    /// LTV ratio numerator: 70% → borrow up to 70% of collateral value.
    const LTV_RATIO: u64 = 70;
    const LTV_DENOMINATOR: u64 = 100;

    // =========================================================================
    // Storage
    // =========================================================================

    #[storage]
    struct Storage {
        /// CollateralVault used for proof verification.
        vault_address: ContractAddress,
        /// Maps borrower → outstanding debt (in BTC satoshis).
        debts: starknet::storage::Map<ContractAddress, u256>,
        /// Total debt outstanding across all borrowers.
        total_borrowed: u256,
    }

    // =========================================================================
    // Events
    // =========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Borrowed: Borrowed,
        Repaid: Repaid,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Borrowed {
        #[key]
        pub borrower: ContractAddress,
        pub borrow_amount: u256,
        /// The collateral threshold that was proven — not the exact amount deposited.
        pub proven_threshold: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Repaid {
        #[key]
        pub borrower: ContractAddress,
        pub repay_amount: u256,
        pub remaining_debt: u256,
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    #[constructor]
    fn constructor(ref self: ContractState, vault_address: ContractAddress) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(vault_address != zero, 'Vault cannot be zero');
        self.vault_address.write(vault_address);
    }

    // =========================================================================
    // External functions
    // =========================================================================

    #[abi(embed_v0)]
    impl MockLendingProtocolImpl of shielded_btc_collateral::interfaces::ilending_protocol::ILendingProtocol<ContractState> {
        /// Borrow against private BTC collateral.
        ///
        /// Required collateral = borrow_amount * LTV_DENOMINATOR / LTV_RATIO
        /// At 70% LTV: borrow 7 BTC → need to prove 10 BTC collateral.
        ///
        /// The vault's prove_collateral DOES NOT reveal the exact amount deposited —
        /// it only confirms the deposited amount is >= required_collateral.
        fn borrow(ref self: ContractState, borrow_amount: u256) {
            assert(borrow_amount > 0_u256, 'Borrow amount must be positive');

            let borrower = get_caller_address();

            // One active loan at a time (simplified for demo)
            assert(self.debts.read(borrower) == 0_u256, 'Active debt exists');

            // [M-09 Fix] Ceiling division for required collateral — protects the protocol.
            // Floor division (borrow * 100 / 70) rounds DOWN, under-collateralizing small loans.
            // Ceiling division (borrow * 100 + 69) / 70) rounds UP, always conservative.
            // Example: borrow 1 satoshi → floor=1, ceiling=2 (correct: need 2 at 70% LTV)
            let required_collateral = (borrow_amount * LTV_DENOMINATOR.into()
                + (LTV_RATIO - 1).into())
                / LTV_RATIO.into();

            // Privacy-preserving collateral check — vault does NOT reveal exact amount.
            // [H-07 Fix] prove_collateral now accepts a proof parameter.
            // MVP: empty span → stub verifier returns commitment != 0 (deposit existence).
            // Production: user-supplied STARK range proof for threshold enforcement.
            let vault = ICollateralVaultDispatcher {
                contract_address: self.vault_address.read(),
            };
            let has_collateral = vault.prove_collateral(borrower, required_collateral, array![].span());
            assert(has_collateral, 'Insufficient BTC collateral');

            // Record the debt
            self.debts.write(borrower, borrow_amount);
            let new_total = self.total_borrowed.read() + borrow_amount;
            self.total_borrowed.write(new_total);

            // In production: transfer loan token (stablecoin/USDC) to borrower here
            self
                .emit(
                    Borrowed {
                        borrower, borrow_amount, proven_threshold: required_collateral,
                    },
                );
        }

        /// Repay borrowed amount (partial or full repayment supported).
        fn repay(ref self: ContractState, repay_amount: u256) {
            assert(repay_amount > 0_u256, 'Repay amount must be positive');

            let borrower = get_caller_address();
            let current_debt = self.debts.read(borrower);
            assert(current_debt > 0_u256, 'No active debt');
            assert(repay_amount <= current_debt, 'Repay exceeds debt');

            let remaining = current_debt - repay_amount;
            self.debts.write(borrower, remaining);

            let current_total = self.total_borrowed.read();
            self.total_borrowed.write(current_total - repay_amount);

            self.emit(Repaid { borrower, repay_amount, remaining_debt: remaining });
        }

        fn get_debt(self: @ContractState, borrower: ContractAddress) -> u256 {
            self.debts.read(borrower)
        }

        /// Calculate maximum borrowable amount.
        ///
        /// [H-07 Fix] Cannot determine exact borrow limit without knowing the deposited amount.
        /// In the commitment-only privacy model, the exact amount is hidden.
        ///
        /// Returns 0 — privacy-preserving and honest about the stub limitation.
        ///
        /// Production path: The user's ZK range proof would encode the borrow limit
        /// directly (e.g., prove amount is in range [min, max] to bound the limit).
        /// This would require a specialized circuit beyond the MVP scope.
        ///
        /// For UX purposes, the frontend can prompt the user to input their amount
        /// off-chain (client-side only, never sent to the contract).
        fn get_borrow_limit(self: @ContractState, borrower: ContractAddress) -> u256 {
            let vault = ICollateralVaultDispatcher {
                contract_address: self.vault_address.read(),
            };
            // Check if user has any active deposit at all
            if !vault.prove_collateral(borrower, 1_u256, array![].span()) {
                return 0_u256;
            }
            // Privacy-preserving: return 0 to avoid exposing the amount.
            // Production: derive from ZK range proof circuit output.
            0_u256
        }

        fn get_ltv_ratio(self: @ContractState) -> u64 {
            LTV_RATIO
        }

        fn get_vault_address(self: @ContractState) -> ContractAddress {
            self.vault_address.read()
        }

        fn get_total_borrowed(self: @ContractState) -> u256 {
            self.total_borrowed.read()
        }
    }
}
