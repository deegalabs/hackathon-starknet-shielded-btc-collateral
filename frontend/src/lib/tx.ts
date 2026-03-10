import type { RpcProvider } from "starknet";

/**
 * Extract a u256 value from starknet.js response.
 * starknet.js may return u256 as { low, high } object or as a plain bigint string.
 */
export function extractU256(val: unknown): bigint {
  const obj = val as Record<string, unknown>;
  return obj?.low !== undefined ? BigInt(String(obj.low)) : BigInt(String(val));
}

/**
 * Wait for transaction with successStates + a hard timeout.
 * Prevents hooks from hanging forever when devnet is slow or a tx is reverted.
 */
export async function waitTx(
  provider: RpcProvider,
  hash: string,
  timeoutMs = 60_000,
): Promise<void> {
  await Promise.race([
    provider.waitForTransaction(hash, {
      retryInterval: 3000,
      successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Transaction timed out — check the explorer for status")),
        timeoutMs,
      ),
    ),
  ]);
}
