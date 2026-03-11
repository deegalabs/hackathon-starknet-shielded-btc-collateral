import { useCallback, useEffect, useState } from "react";
import { cairo, type RpcProvider } from "starknet";
import { useWallet } from "@/context/WalletContext";
import { waitTx, toUserFriendlyError } from "@/lib/tx";

const WAIT_OPTIONS = { retryInterval: 4000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] as const };
const WAIT_TIMEOUT_MS = 300_000; // 5 min (Sepolia can be slow)

/** Same as commit 57818d2: provider.waitForTransaction. Fallback to waitTx if RPC is incompatible. */
async function waitForTxWithTimeout(
  provider: RpcProvider,
  hash: string,
  fallbackWaitTx: (provider: RpcProvider, h: string) => Promise<void>,
): Promise<void> {
  try {
    await Promise.race([
      // RpcProvider.waitForTransaction options may differ by starknet.js version; cast for compatibility
      (provider as { waitForTransaction: (h: string, opts: unknown) => Promise<unknown> }).waitForTransaction(hash, WAIT_OPTIONS).then(() => {}),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Transaction timed out — check the explorer for status")), WAIT_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    await fallbackWaitTx(provider, hash);
  }
}

export interface VaultState {
  commitment: string;
  totalLocked: bigint;
  isPaused: boolean;
  wbtcBalance: bigint;
  wbtcAllowance: bigint;
  isLoading: boolean;
  error: string | null;
}

export interface TxState {
  status: "idle" | "pending" | "pending_step2" | "success" | "error";
  hash: string | null;
  message: string | null;
}

const INITIAL_STATE: VaultState = {
  commitment: "0x0",
  totalLocked: 0n,
  isPaused: false,
  wbtcBalance: 0n,
  wbtcAllowance: 0n,
  isLoading: false,
  error: null,
};

function extractU256(val: unknown): bigint {
  const obj = val as Record<string, unknown>;
  return obj?.low !== undefined ? BigInt(String(obj.low)) : BigInt(String(val));
}

export function useVault() {
  const { account, address, contracts, provider } = useWallet();
  const [state, setState] = useState<VaultState>(INITIAL_STATE);
  const [tx, setTx] = useState<TxState>({ status: "idle", hash: null, message: null });

  const refresh = useCallback(async () => {
    // Protocol-wide data (Total Locked, isPaused) only needs vault — works without wallet connected
    if (!contracts.vault) return;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const [totalLocked, isPaused] = await Promise.all([
        contracts.vault.get_total_locked(),
        contracts.vault.is_paused(),
      ]);

      let commitment = "0x0";
      let wbtcBalance = 0n;
      let wbtcAllowance = 0n;

      if (address && contracts.wbtc) {
        // [H-07 Fix] get_committed_amount removed — amounts are private (commitment-only).
        const [c, bal, allow] = await Promise.all([
          contracts.vault.get_commitment(address),
          contracts.wbtc.balance_of(address),
          contracts.wbtc.allowance(address, contracts.vault.address),
        ]);
        commitment = `0x${BigInt(String(c)).toString(16)}`;
        wbtcBalance = extractU256(bal);
        wbtcAllowance = extractU256(allow);
      }

      setState({
        commitment,
        totalLocked: extractU256(totalLocked),
        isPaused: Boolean(isPaused),
        wbtcBalance,
        wbtcAllowance,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load vault data",
      }));
    }
  }, [address, contracts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Step 1: Approve WBTC. After confirmation, UI must show "Step 2" button; the second tx
   * runs only on user click so the wallet gets a user gesture and shows the popup.
   */
  const depositStep1 = useCallback(
    async (amount: bigint, _secret: bigint, _commitment: bigint) => {
      if (!account || !contracts.vault || !contracts.wbtc) return;
      setTx({ status: "pending", hash: null, message: "Approving WBTC..." });
      try {
        const approveTx = await contracts.wbtc.invoke(
          "approve",
          [contracts.vault.address, cairo.uint256(amount)],
        );
        setTx({ status: "pending", hash: approveTx.transaction_hash, message: "Step 1/2 — Waiting approve confirmation (may take ~1 min on Sepolia)..." });
        await waitForTxWithTimeout(provider, approveTx.transaction_hash, waitTx);
        setTx({ status: "pending_step2", hash: null, message: "Step 1 done. Click below to confirm deposit (Step 2)." });
      } catch (err) {
        setTx({ status: "error", hash: null, message: toUserFriendlyError(err) || "Deposit failed" });
      }
    },
    [account, contracts, provider],
  );

  /**
   * Step 2: Deposit (vault.invoke). Call this when user clicks "Confirm deposit (Step 2)".
   * Running from a click ensures the wallet popup opens (user gesture).
   */
  const depositStep2 = useCallback(
    async (amount: bigint, secret: bigint, commitment: bigint) => {
      if (!account || !contracts.vault) return;
      setTx({ status: "pending", hash: null, message: "Step 2/2 — Confirm deposit in wallet..." });
      try {
        const depositTx = await contracts.vault.invoke(
          "deposit",
          [cairo.uint256(amount), `0x${secret.toString(16)}`, `0x${commitment.toString(16)}`],
        );
        setTx({ status: "pending", hash: depositTx.transaction_hash, message: "Waiting deposit confirmation..." });
        await waitForTxWithTimeout(provider, depositTx.transaction_hash, waitTx);
        setTx({ status: "success", hash: depositTx.transaction_hash, message: "Deposit confirmed!" });
        await refresh();
      } catch (err) {
        setTx({ status: "error", hash: null, message: toUserFriendlyError(err) || "Deposit failed" });
      }
    },
    [account, contracts, provider, refresh],
  );

  /** One-call deposit (step1 + step2): use depositStep1 then have user click for step2. */
  const deposit = useCallback(
    async (amount: bigint, secret: bigint, commitment: bigint) => {
      await depositStep1(amount, secret, commitment);
    },
    [depositStep1],
  );

  /**
   * [H-07 Fix] withdraw now requires the deposit `secret` for on-chain preimage verification.
   * The contract validates: Poseidon(amount_low, amount_high, secret) == stored_commitment
   * and Poseidon(commitment, secret) == nullifier.
   *
   * The `secret` is the same value used during deposit. It must be kept private by the user.
   */
  const withdraw = useCallback(
    async (amount: bigint, secret: bigint, nullifier: bigint) => {
      if (!account || !contracts.vault) return;
      setTx({ status: "pending", hash: null, message: "Withdrawing — confirm in wallet..." });
      try {
        const withdrawTx = await contracts.vault.invoke(
          "withdraw",
          [
            cairo.uint256(amount),
            `0x${secret.toString(16)}`,    // deposit secret for preimage check
            `0x${nullifier.toString(16)}`,
          ],
        );
        setTx({ status: "pending", hash: withdrawTx.transaction_hash, message: "Waiting withdrawal confirmation..." });
        await waitTx(provider, withdrawTx.transaction_hash);
        setTx({ status: "success", hash: withdrawTx.transaction_hash, message: "Withdrawal confirmed!" });
        await refresh();
      } catch (err) {
        setTx({ status: "error", hash: null, message: toUserFriendlyError(err) || "Withdrawal failed" });
      }
    },
    [account, contracts, provider, refresh],
  );

  const resetTx = useCallback(() => {
    setTx({ status: "idle", hash: null, message: null });
  }, []);

  return { state, tx, deposit, depositStep1, depositStep2, withdraw, refresh, resetTx };
}
