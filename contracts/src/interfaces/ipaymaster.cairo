use starknet::ContractAddress;

/// Paymaster — enables gasless transactions for CollateralVault users.
///
/// Users who have deposited BTC collateral above a threshold can have their
/// gas fees sponsored by this contract. This removes the friction of needing
/// STRK for gas when interacting with the vault.
///
/// Production integration (Phase 2):
///   - Implement SNIP-9 (Outside Execution) on the Paymaster
///   - Paymaster signs and submits pre-authorized transactions on behalf of users
///   - Gas cost is covered from the paymaster's STRK budget
///
/// MVP scope:
///   - Eligibility checking (is_eligible_for_sponsorship)
///   - Budget management (fund_budget, get_remaining_budget)
///   - Threshold configuration (set_sponsorship_threshold)
///   - Actual gas payment execution: Phase 2
#[starknet::interface]
pub trait IPaymaster<TContractState> {
    /// Returns true if the user has sufficient collateral for gas sponsorship.
    /// Checks: vault.prove_collateral(user, sponsorship_threshold)
    fn is_eligible_for_sponsorship(
        self: @TContractState, user: ContractAddress,
    ) -> bool;

    /// Returns the remaining gas budget (in wei/STRK units).
    fn get_remaining_budget(self: @TContractState) -> u256;

    /// Returns the minimum collateral threshold for eligibility.
    fn get_sponsorship_threshold(self: @TContractState) -> u256;

    /// Fund the paymaster's gas budget. Permissionless — anyone can contribute.
    fn fund_budget(ref self: TContractState, amount: u256);

    /// Owner: update the minimum collateral threshold for sponsorship.
    fn set_sponsorship_threshold(ref self: TContractState, new_threshold: u256);

    /// Returns the vault address used for collateral eligibility checks.
    fn get_vault_address(self: @TContractState) -> ContractAddress;

    /// Returns the paymaster owner address.
    fn get_owner(self: @TContractState) -> ContractAddress;
}
