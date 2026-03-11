import { useCallback, useEffect, useState } from "react";
import { cairo } from "starknet";
import { useWallet } from "@/context/WalletContext";
import { waitTx } from "@/lib/tx";

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
  status: "idle" | "pending" | "success" | "error";
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
   * Deposit WBTC with on-chain Poseidon commitment validation.
   * The contract validates: compute_commitment(amount, secret) == commitment
   * This removes trust in frontend hash computation — the Cairo contract enforces it.
   */
  const deposit = useCallback(
    async (amount: bigint, secret: bigint, commitment: bigint) => {
      if (!account || !contracts.vault || !contracts.wbtc) return;
      setTx({ status: "pending", hash: null, message: "Approving WBTC..." });
      try {
        const approveTx = await contracts.wbtc.invoke(
          "approve",
          [contracts.vault.address, cairo.uint256(amount)],
        );
        setTx({ status: "pending", hash: approveTx.transaction_hash, message: "Step 1/2 — Waiting approve confirmation (may take ~1 min on Sepolia)..." });
        await waitTx(provider, approveTx.transaction_hash);
        setTx({ status: "pending", hash: null, message: "Step 2/2 — Confirm deposit in wallet..." });

        // On-chain validation: secret + commitment passed so Cairo can verify Poseidon(amount, secret) == commitment
        const depositTx = await contracts.vault.invoke(
          "deposit",
          [cairo.uint256(amount), `0x${secret.toString(16)}`, `0x${commitment.toString(16)}`],
        );

        setTx({ status: "pending", hash: depositTx.transaction_hash, message: "Waiting deposit confirmation..." });
        await waitTx(provider, depositTx.transaction_hash);
        setTx({ status: "success", hash: depositTx.transaction_hash, message: "Deposit confirmed!" });
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Deposit failed";
        setTx({ status: "error", hash: null, message: msg });
      }
    },
    [account, contracts, provider, refresh],
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
        const msg = err instanceof Error ? err.message : "Withdrawal failed";
        setTx({ status: "error", hash: null, message: msg });
      }
    },
    [account, contracts, provider, refresh],
  );

  const resetTx = useCallback(() => {
    setTx({ status: "idle", hash: null, message: null });
  }, []);

  return { state, tx, deposit, withdraw, refresh, resetTx };
}
