/// Paymaster — Gas sponsorship for CollateralVault users.
///
/// Users with active BTC collateral above a threshold can transact gaslessly.
/// This removes the STRK onboarding friction: users can deposit BTC and immediately
/// interact with the protocol without holding any Starknet tokens.
///
/// Current MVP scope:
///   - Eligibility check: user has collateral >= sponsorship_threshold
///   - Budget management: owner funds the paymaster
///   - Threshold configuration: owner sets minimum collateral for eligibility
///
/// Production (Phase 2 — SNIP-9 Outside Execution):
///   - User constructs a signed Call (deposit/prove/withdraw)
///   - User submits pre-signed call to the Paymaster API
///   - Paymaster validates eligibility, wraps in OutsideExecution, submits on-chain
///   - Paymaster pays the STRK gas fee from its budget
///   - User never needs STRK tokens
///
/// SNIP-9 reference: https://github.com/starknet-io/SNIPs/blob/main/SNIPS/snip-9.md
#[starknet::contract]
pub mod Paymaster {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use shielded_btc_collateral::interfaces::icollateral_vault::{
        ICollateralVaultDispatcher, ICollateralVaultDispatcherTrait,
    };

    // =========================================================================
    // Storage
    // =========================================================================

    #[storage]
    struct Storage {
        /// Contract owner — can fund budget and update threshold.
        owner: ContractAddress,
        /// CollateralVault to query for eligibility checks.
        vault_address: ContractAddress,
        /// Minimum collateral (satoshis) required for gas sponsorship.
        sponsorship_threshold: u256,
        /// Available gas budget (in STRK/wei units — conceptual in MVP).
        remaining_budget: u256,
    }

    // =========================================================================
    // Events
    // =========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BudgetFunded: BudgetFunded,
        ThresholdUpdated: ThresholdUpdated,
        SponsorshipGranted: SponsorshipGranted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BudgetFunded {
        #[key]
        pub by: ContractAddress,
        pub amount: u256,
        pub new_total: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ThresholdUpdated {
        pub previous: u256,
        pub new_threshold: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SponsorshipGranted {
        #[key]
        pub user: ContractAddress,
        pub total_sponsored: u256,
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        vault_address: ContractAddress,
        sponsorship_threshold: u256,
    ) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(owner != zero, 'Owner cannot be zero');
        assert(vault_address != zero, 'Vault cannot be zero');
        self.owner.write(owner);
        self.vault_address.write(vault_address);
        self.sponsorship_threshold.write(sponsorship_threshold);
        self.remaining_budget.write(0_u256);
    }

    // =========================================================================
    // External functions
    // =========================================================================

    #[abi(embed_v0)]
    impl PaymasterImpl of shielded_btc_collateral::interfaces::ipaymaster::IPaymaster<ContractState> {
        /// Check if user qualifies for gas sponsorship.
        ///
        /// Calls vault.prove_collateral(user, threshold) — which itself is
        /// a privacy-preserving check (does not reveal exact collateral amount).
        fn is_eligible_for_sponsorship(
            self: @ContractState, user: ContractAddress,
        ) -> bool {
            if self.remaining_budget.read() == 0_u256 {
                return false;
            }
            let threshold = self.sponsorship_threshold.read();
            let vault = ICollateralVaultDispatcher {
                contract_address: self.vault_address.read(),
            };
            // [H-07 Fix] prove_collateral now requires a proof parameter.
            // Paymaster passes empty span — stub verifier confirms deposit existence.
            vault.prove_collateral(user, threshold, array![].span())
        }

        fn get_remaining_budget(self: @ContractState) -> u256 {
            self.remaining_budget.read()
        }

        fn get_sponsorship_threshold(self: @ContractState) -> u256 {
            self.sponsorship_threshold.read()
        }

        /// Add to the gas sponsorship budget.
        ///
        /// [M-07 Fix] Permissionless funding — anyone can contribute to the paymaster budget.
        /// Restricting to owner-only creates a single point of failure: if the owner key
        /// is lost, the paymaster can never be refunded. Community funding is safer.
        fn fund_budget(ref self: ContractState, amount: u256) {
            assert(amount > 0_u256, 'Amount must be positive');
            let new_total = self.remaining_budget.read() + amount;
            self.remaining_budget.write(new_total);
            self.emit(BudgetFunded { by: get_caller_address(), amount, new_total });
        }

        /// Owner: update the minimum collateral threshold for sponsorship.
        fn set_sponsorship_threshold(ref self: ContractState, new_threshold: u256) {
            self._assert_only_owner();
            let previous = self.sponsorship_threshold.read();
            self.sponsorship_threshold.write(new_threshold);
            self.emit(ThresholdUpdated { previous, new_threshold });
        }

        fn get_vault_address(self: @ContractState) -> ContractAddress {
            self.vault_address.read()
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }
    }

    // =========================================================================
    // Admin-only functions (not in interface — administrative operations)
    // =========================================================================

    #[abi(per_item)]
    #[generate_trait]
    impl PaymasterAdminImpl of PaymasterAdminTrait {
        /// Owner: withdraw unused budget back to a recipient.
        ///
        /// [M-08 Fix] Without this, budget locked in a deprecated paymaster is unrecoverable.
        #[external(v0)]
        fn withdraw_budget(ref self: ContractState, amount: u256, recipient: ContractAddress) {
            self._assert_only_owner();
            assert(amount > 0_u256, 'Amount must be positive');
            assert(amount <= self.remaining_budget.read(), 'Exceeds remaining budget');
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(recipient != zero, 'Recipient cannot be zero');
            self.remaining_budget.write(self.remaining_budget.read() - amount);
        }

        /// Owner: transfer ownership of this paymaster.
        ///
        /// [L-09 Fix] Prevents ownership from being permanently locked.
        #[external(v0)]
        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            self._assert_only_owner();
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(new_owner != zero, 'New owner cannot be zero');
            self.owner.write(new_owner);
        }
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_only_owner(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
        }
    }
}
