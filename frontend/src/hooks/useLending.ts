import { useCallback, useEffect, useState } from "react";
import { cairo } from "starknet";
import { useWallet } from "@/context/WalletContext";
import { waitTx, extractU256 } from "@/lib/tx";
import { generateRangeProof, isZKSupported } from "@/lib/zk";
import type { TxState } from "./useVault";

export interface LendingState {
  debt: bigint;
  borrowLimit: bigint;
  ltvRatio: number;
  totalBorrowed: bigint;
  isLoading: boolean;
  error: string | null;
}


export function useLending() {
  const { account, address, contracts, provider } = useWallet();
  const [state, setState] = useState<LendingState>({
    debt: 0n,
    borrowLimit: 0n,
    ltvRatio: 70,
    totalBorrowed: 0n,
    isLoading: false,
    error: null,
  });
  const [tx, setTx] = useState<TxState>({ status: "idle", hash: null, message: null });

  const refresh = useCallback(async () => {
    if (!contracts.lending) return;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const [ltvRaw, totalRaw] = await Promise.all([
        contracts.lending.get_ltv_ratio(),
        contracts.lending.get_total_borrowed(),
      ]);

      let debt = 0n;
      let borrowLimit = 0n;
      if (address) {
        const [debtRaw, limitRaw] = await Promise.all([
          contracts.lending.get_debt(address),
          contracts.lending.get_borrow_limit(address),
        ]);
        debt = extractU256(debtRaw);
        borrowLimit = extractU256(limitRaw);
      }

      setState({
        debt,
        borrowLimit,
        ltvRatio: Number(ltvRaw),
        totalBorrowed: extractU256(totalRaw),
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load lending data",
      }));
    }
  }, [address, contracts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Borrow against private BTC collateral.
   *
   * If `secret` and `bn254Commitment` are provided AND ZK is supported in this browser,
   * generates a real UltraKeccakZKHonk range proof off-chain and passes it to the
   * lending contract. The contract forwards it to vault.prove_collateral().
   *
   * Fallback (MVP): if no ZK params provided, passes an empty proof span → stub verifier.
   *
   * @param amount          - Amount to borrow in satoshis
   * @param secret          - Deposit secret (hex, 0x-prefixed) — for ZK proof generation
   * @param bn254Commitment - BN254 commitment from vault state — used as public input
   * @param threshold       - Required collateral threshold (= amount * 100 / ltv_ratio)
   */
  const borrow = useCallback(
    async (
      amount: bigint,
      secret?: string,
      bn254Commitment?: string,
      threshold?: bigint,
    ) => {
      if (!account || !contracts.lending) return;

      let proofCalldata: string[] = [];

      // Generate ZK range proof if params are available
      if (
        secret &&
        bn254Commitment &&
        bn254Commitment !== "0x0" &&
        threshold !== undefined &&
        isZKSupported()
      ) {
        setTx({ status: "pending", hash: null, message: "Generating ZK proof... (this takes ~5–10s)" });
        try {
          const { calldata } = await generateRangeProof(
            amount,
            secret,
            bn254Commitment,
            threshold,
          );
          proofCalldata = calldata;
          setTx({ status: "pending", hash: null, message: "ZK proof generated. Sending borrow transaction..." });
        } catch (zkErr) {
          console.warn("ZK proof generation failed, falling back to stub:", zkErr);
          setTx({ status: "pending", hash: null, message: "Sending borrow transaction (stub mode)..." });
        }
      } else {
        setTx({ status: "pending", hash: null, message: "Borrowing..." });
      }

      try {
        // Pass proof calldata (or empty array for stub mode) to the lending contract
        const borrowTx = await contracts.lending.invoke("borrow", [
          cairo.uint256(amount),
          proofCalldata,
        ]);
        setTx({ status: "pending", hash: borrowTx.transaction_hash, message: "Waiting borrow confirmation..." });
        await waitTx(provider, borrowTx.transaction_hash);
        setTx({ status: "success", hash: borrowTx.transaction_hash, message: "Borrow confirmed!" });
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Borrow failed";
        setTx({ status: "error", hash: null, message: msg });
      }
    },
    [account, contracts, provider, refresh],
  );

  const repay = useCallback(
    async (amount: bigint) => {
      if (!account || !contracts.lending) return;
      setTx({ status: "pending", hash: null, message: "Repaying..." });
      try {
        const repayTx = await contracts.lending.invoke("repay", [cairo.uint256(amount)]);
        setTx({ status: "pending", hash: repayTx.transaction_hash, message: "Repaying..." });
        await waitTx(provider, repayTx.transaction_hash);
        setTx({ status: "success", hash: repayTx.transaction_hash, message: "Repay confirmed!" });
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Repay failed";
        setTx({ status: "error", hash: null, message: msg });
      }
    },
    [account, contracts, provider, refresh],
  );

  const resetTx = useCallback(() => {
    setTx({ status: "idle", hash: null, message: null });
  }, []);

  return { state, tx, borrow, repay, refresh, resetTx };
}
