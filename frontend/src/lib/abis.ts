/** Minimal ABIs for each protocol contract — Starknet Cairo 2 ABI format */

// [H-07 Fix — March 7, 2026]
// - withdraw: added `secret` parameter (preimage proof, replaces plaintext amount check)
// - prove_collateral: added `proof` parameter (ZK proof span, empty for stub verifier)
// - get_committed_amount: REMOVED (privacy-preserving, amounts no longer stored on-chain)
export const VAULT_ABI = [
  { type: "function", name: "deposit", inputs: [{ name: "amount", type: "core::integer::u256" }, { name: "commitment", type: "core::felt252" }], outputs: [], state_mutability: "external" },
  {
    type: "function", name: "withdraw",
    inputs: [
      { name: "amount", type: "core::integer::u256" },
      { name: "secret", type: "core::felt252" },     // deposit secret for preimage check
      { name: "nullifier", type: "core::felt252" },
    ],
    outputs: [], state_mutability: "external",
  },
  {
    type: "function", name: "prove_collateral",
    inputs: [
      { name: "user", type: "core::starknet::contract_address::ContractAddress" },
      { name: "threshold", type: "core::integer::u256" },
      { name: "proof", type: "core::array::Span::<core::felt252>" }, // empty for stub
    ],
    outputs: [{ type: "core::bool" }], state_mutability: "view",
  },
  { type: "function", name: "get_commitment", inputs: [{ name: "user", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::felt252" }], state_mutability: "view" },
  { type: "function", name: "get_total_locked", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "is_nullifier_used", inputs: [{ name: "nullifier", type: "core::felt252" }], outputs: [{ type: "core::bool" }], state_mutability: "view" },
  { type: "function", name: "is_paused", inputs: [], outputs: [{ type: "core::bool" }], state_mutability: "view" },
  { type: "function", name: "get_wbtc_token", inputs: [], outputs: [{ type: "core::starknet::contract_address::ContractAddress" }], state_mutability: "view" },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "core::starknet::contract_address::ContractAddress" }, { name: "amount", type: "core::integer::u256" }], outputs: [{ type: "core::bool" }], state_mutability: "external" },
  { type: "function", name: "balance_of", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "core::starknet::contract_address::ContractAddress" }, { name: "spender", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "transfer", inputs: [{ name: "recipient", type: "core::starknet::contract_address::ContractAddress" }, { name: "amount", type: "core::integer::u256" }], outputs: [{ type: "core::bool" }], state_mutability: "external" },
] as const;

export const LENDING_ABI = [
  { type: "function", name: "borrow", inputs: [{ name: "borrow_amount", type: "core::integer::u256" }], outputs: [], state_mutability: "external" },
  { type: "function", name: "repay", inputs: [{ name: "repay_amount", type: "core::integer::u256" }], outputs: [], state_mutability: "external" },
  { type: "function", name: "get_debt", inputs: [{ name: "borrower", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_borrow_limit", inputs: [{ name: "borrower", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_ltv_ratio", inputs: [], outputs: [{ type: "core::integer::u64" }], state_mutability: "view" },
  { type: "function", name: "get_total_borrowed", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
] as const;

export const PAYMASTER_ABI = [
  { type: "function", name: "is_eligible_for_sponsorship", inputs: [{ name: "user", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::bool" }], state_mutability: "view" },
  { type: "function", name: "fund_budget", inputs: [{ name: "amount", type: "core::integer::u256" }], outputs: [], state_mutability: "external" },
  { type: "function", name: "get_remaining_budget", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_sponsorship_threshold", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_owner", inputs: [], outputs: [{ type: "core::starknet::contract_address::ContractAddress" }], state_mutability: "view" },
] as const;

export const SESSION_KEY_MANAGER_ABI = [
  { type: "function", name: "register_session", inputs: [{ name: "session_public_key", type: "core::felt252" }, { name: "expiry_timestamp", type: "core::integer::u64" }, { name: "spending_limit", type: "core::integer::u256" }, { name: "allowed_contract", type: "core::starknet::contract_address::ContractAddress" }], outputs: [], state_mutability: "external" },
  { type: "function", name: "revoke_session", inputs: [{ name: "session_public_key", type: "core::felt252" }], outputs: [], state_mutability: "external" },
  { type: "function", name: "is_valid_session", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }, { name: "session_public_key", type: "core::felt252" }], outputs: [{ type: "core::bool" }], state_mutability: "view" },
  { type: "function", name: "record_spending", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }, { name: "session_public_key", type: "core::felt252" }, { name: "amount", type: "core::integer::u256" }], outputs: [], state_mutability: "external" },
  { type: "function", name: "get_session_info", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }, { name: "session_public_key", type: "core::felt252" }], outputs: [{ type: "core::integer::u64" }, { type: "core::integer::u256" }, { type: "core::integer::u256" }, { type: "core::starknet::contract_address::ContractAddress" }, { type: "core::bool" }], state_mutability: "view" },
] as const;
