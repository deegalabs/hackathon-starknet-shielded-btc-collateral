use starknet::ContractAddress;

/// External interface of the CollateralVault.
/// Other DeFi protocols integrate by calling prove_collateral.
#[starknet::interface]
pub trait ICollateralVault<TContractState> {
    /// Deposit WBTC privately.
    /// The actual amount is hidden behind a Poseidon commitment.
    /// commitment = Poseidon(amount_low, amount_high, secret)
    /// Reverts if the caller already has an active commitment (H-01 fix).
    fn deposit(ref self: TContractState, amount: u256, commitment: felt252);

    /// Prove that a user's committed collateral meets or exceeds a threshold.
    /// MVP: compares stored plaintext amount against threshold (H-02 fix).
    /// Production: requires a valid STARK range proof (amount stays hidden).
    fn prove_collateral(
        self: @TContractState, user: ContractAddress, threshold: u256,
    ) -> bool;

    /// Withdraw WBTC using a nullifier to prevent double-spending.
    /// nullifier = Poseidon(commitment, withdraw_secret)
    /// Reverts if: nullifier used, no active commitment, or amount mismatch.
    fn withdraw(ref self: TContractState, amount: u256, nullifier: felt252);

    /// Returns the stored commitment for a user (0 if none).
    fn get_commitment(self: @TContractState, user: ContractAddress) -> felt252;

    /// Returns the deposited amount for a user (0 if none).
    /// MVP only: in production this is hidden and verified via ZK proof.
    fn get_committed_amount(self: @TContractState, user: ContractAddress) -> u256;

    /// Returns the total WBTC locked in the vault.
    fn get_total_locked(self: @TContractState) -> u256;

    /// Returns the WBTC token contract address.
    fn get_wbtc_token(self: @TContractState) -> ContractAddress;

    /// Returns true if a nullifier has already been used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}
