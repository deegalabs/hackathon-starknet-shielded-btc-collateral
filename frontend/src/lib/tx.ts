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
 *
 * Timeout is 5 min by default — Sepolia can be slow.
 * successStates includes both finality and execution states for starknet.js v9 compatibility.
 */
export async function waitTx(
  provider: RpcProvider,
  hash: string,
  timeoutMs = 300_000,
): Promise<void> {
  await Promise.race([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider.waitForTransaction(hash, {
      retryInterval: 4000,
      successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1", "SUCCEEDED"] as any,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Transaction timed out — check the explorer for status")),
        timeoutMs,
      ),
    ),
  ]);
}
