use starknet::ContractAddress;

/// Admin interface for CollateralVault.
///
/// Separated from ICollateralVault so DeFi integrators only need to import
/// the public interface. Admin functions are owner-gated.
///
/// Upgrade path: call set_verifier(range_proof_verifier_address) when Phase 2
/// range proof circuit is ready — no changes to ICollateralVault required.
#[starknet::interface]
pub trait ICollateralVaultAdmin<TContractState> {
    /// Pause deposits and withdrawals. Emergency circuit-breaker.
    /// Only callable by the owner.
    fn pause(ref self: TContractState);

    /// Resume normal operations after pause.
    /// Only callable by the owner.
    fn unpause(ref self: TContractState);

    /// Transfer ownership to a new address.
    /// Only callable by the current owner. Cannot be zero address.
    fn transfer_ownership(ref self: TContractState, new_owner: ContractAddress);

    /// Set the ZK proof verifier address.
    /// MVP: verifier is stored but not yet called.
    /// Production: prove_collateral will delegate to this contract.
    fn set_verifier(ref self: TContractState, new_verifier: ContractAddress);

    /// Returns the current owner address.
    fn get_owner(self: @TContractState) -> ContractAddress;

    /// Returns the current ZK verifier address (zero if not yet set).
    fn get_verifier(self: @TContractState) -> ContractAddress;
}
