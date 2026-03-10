import type { RpcProvider } from "starknet";

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
