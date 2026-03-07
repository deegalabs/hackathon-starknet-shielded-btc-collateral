import { hash, stark } from "starknet";

/**
 * Compute Poseidon(amount.low, amount.high, secret)
 * Mirrors Cairo's poseidon_hash_span([amount.low, amount.high, secret])
 */
export function computeCommitment(amount: bigint, secret: bigint): bigint {
  const low = amount & 0xffffffffffffffffffffffffffffffffn;
  const high = amount >> 128n;
  return BigInt(hash.computePoseidonHashOnElements([low, high, secret]));
}

/**
 * Compute Poseidon(commitment, withdraw_secret)
 * Mirrors Cairo's poseidon_hash_span([commitment, withdraw_secret])
 */
export function computeNullifier(
  commitment: bigint,
  withdrawSecret: bigint,
): bigint {
  return BigInt(
    hash.computePoseidonHashOnElements([commitment, withdrawSecret]),
  );
}

/** Generate a cryptographically secure random felt252 for use as a secret */
export function generateSecret(): bigint {
  return BigInt(stark.randomAddress());
}

/** Format a felt252 for display (truncated hex) */
export function shortHash(value: bigint): string {
  const hex = `0x${value.toString(16)}`;
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 8)}...${hex.slice(-6)}`;
}

/** Full hex representation of a felt252 */
export function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
