import { useCallback, useEffect, useState } from "react";
import { cairo } from "starknet";
import { useWallet } from "@/context/WalletContext";
import { waitTx } from "@/lib/tx";
import { computeBN254Commitment } from "@/lib/zk";

export interface VaultState {
  commitment: string;
  /** BN254-field commitment stored for ZK range proofs. "0x0" if none. */
  bn254Commitment: string;
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
  bn254Commitment: "0x0",
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
    if (!contracts.vault || !contracts.wbtc) return;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const [totalLocked, isPaused] = await Promise.all([
        contracts.vault.get_total_locked(),
        contracts.vault.is_paused(),
      ]);

      let commitment = "0x0";
      let wbtcBalance = 0n;
      let wbtcAllowance = 0n;

      let bn254Commitment = "0x0";

      if (address) {
        // [H-07 Fix] get_committed_amount removed — amounts are private (commitment-only).
        const [c, bn254c, bal, allow] = await Promise.all([
          contracts.vault.get_commitment(address),
          contracts.vault.get_bn254_commitment(address),
          contracts.wbtc.balance_of(address),
          contracts.wbtc.allowance(address, contracts.vault.address),
        ]);
        commitment = `0x${BigInt(String(c)).toString(16)}`;
        bn254Commitment = `0x${BigInt(String(bn254c)).toString(16)}`;
        wbtcBalance = extractU256(bal);
        wbtcAllowance = extractU256(allow);
      }

      setState({
        commitment,
        bn254Commitment,
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
   * Deposit WBTC with dual-field Poseidon commitment.
   *
   * Computes:
   *   stark_commitment = Poseidon_Stark(amount_low, amount_high, secret) [validated on-chain]
   *   bn254_commitment = Poseidon2_BN254([amount, secret, 0, 0], t=4)[0] [for ZK range proofs]
   *
   * The `secret` (hex string) should be saved by the user — needed for future withdrawals.
   */
  const deposit = useCallback(
    async (amount: bigint, secret: bigint, commitment: bigint) => {
      if (!account || !contracts.vault || !contracts.wbtc) return;
      setTx({ status: "pending", hash: null, message: "Computing ZK commitment..." });
      try {
        // Compute BN254 Poseidon2 commitment for ZK range proofs (uses noir_js circuit)
        const secretHex = `0x${secret.toString(16).padStart(62, "0")}`;
        const bn254Commitment = await computeBN254Commitment(amount, secretHex);

        setTx({ status: "pending", hash: null, message: "Approving WBTC..." });
        const approveTx = await contracts.wbtc.invoke(
          "approve",
          [contracts.vault.address, cairo.uint256(amount)],
        );
        setTx({ status: "pending", hash: approveTx.transaction_hash, message: "Waiting approve confirmation..." });
        await waitTx(provider, approveTx.transaction_hash);
        setTx({ status: "pending", hash: approveTx.transaction_hash, message: "Depositing — confirm in wallet..." });

        // Pass both Stark and BN254 commitments to the vault
        const depositTx = await contracts.vault.invoke(
          "deposit",
          [
            cairo.uint256(amount),
            `0x${secret.toString(16)}`,
            `0x${commitment.toString(16)}`,
            bn254Commitment,
          ],
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
