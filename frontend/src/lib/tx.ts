import type { RpcProvider } from "starknet";

/**
 * Map raw RPC/validation errors to short, user-friendly messages.
 * Handles "Resources bounds (...) exceed balance (0)" and long RPC payloads.
 */
export function toUserFriendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  // Insufficient balance for gas — often the *sending* account has 0 STRK (e.g. ShieldedAccount)
  if (lower.includes("exceed balance (0)") || (lower.includes("resources bounds") && lower.includes("balance"))) {
    return "Insufficient STRK for gas. The account that signs this tx has 0 balance — if you use a ShieldedAccount, send STRK to that address; otherwise fund your wallet.";
  }
  if (lower.includes("account validation failed") && lower.includes("balance")) {
    return "Insufficient STRK for gas. Fund the account that is signing the transaction (check if you are using a different account, e.g. ShieldedAccount).";
  }

  // Long RPC payload — show only the last sentence or a short summary
  if (lower.includes("rpc:") && lower.includes("addinvoketransaction")) {
    const match = raw.match(/Account validation failed[^"]*"([^"]+)"/);
    if (match) return `Transaction failed: ${match[1]}`;
    const balanceMatch = raw.match(/exceed balance \((\d+)\)/);
    if (balanceMatch) {
      return "Insufficient STRK for gas. The signing account has no balance for fees.";
    }
    return "Transaction rejected by the network. Check that your account has enough STRK for gas.";
  }

  return raw.length > 200 ? `${raw.slice(0, 180)}…` : raw;
}

/**
 * Extract a u256 value from starknet.js response.
 * starknet.js may return u256 as { low, high } object or as a plain bigint string.
 */
export function extractU256(val: unknown): bigint {
  const obj = val as Record<string, unknown>;
  return obj?.low !== undefined ? BigInt(String(obj.low)) : BigInt(String(val));
}

/**
 * Poll getTransactionReceipt until the tx reaches a final state.
 *
 * Uses manual polling instead of waitForTransaction to avoid incompatibilities
 * between starknet.js v9 (expects RPC 0.10.0) and nodes running RPC 0.9.0
 * (e.g. cartridge.gg), where waitForTransaction throws on state mismatches.
 *
 * Accepted terminal states: ACCEPTED_ON_L2, ACCEPTED_ON_L1, SUCCEEDED.
 * Error terminal states: REJECTED, REVERTED.
 * Timeout: 5 min by default (Sepolia can be slow).
 */
export async function waitTx(
  provider: RpcProvider,
  hash: string,
  timeoutMs = 300_000,
  retryInterval = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receipt = await (provider as any).getTransactionReceipt(hash);
      const finalityStatus: string =
        receipt?.finality_status ?? receipt?.status ?? "";
      const executionStatus: string = receipt?.execution_status ?? "";

      const accepted =
        finalityStatus === "ACCEPTED_ON_L2" ||
        finalityStatus === "ACCEPTED_ON_L1" ||
        executionStatus === "SUCCEEDED";

      const failed =
        finalityStatus === "REJECTED" ||
        executionStatus === "REVERTED";

      if (accepted) return;
      if (failed) {
        const reason: string = receipt?.revert_reason ?? "unknown";
        throw new Error(`Transaction failed: ${reason}`);
      }
    } catch (err) {
      // Re-throw real errors; ignore "not found yet" errors
      if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        const notFound =
          msg.includes("not found") ||
          msg.includes("transaction hash not found") ||
          msg.includes("25:") ||
          msg.includes("pending");
        if (!notFound) throw err;
      }
    }

    await new Promise((r) => setTimeout(r, retryInterval));
  }

  throw new Error("Transaction timed out — check the explorer for status");
}
