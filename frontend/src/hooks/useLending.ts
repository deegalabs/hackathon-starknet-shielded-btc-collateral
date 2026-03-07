import { useCallback, useEffect, useState } from "react";
import { cairo } from "starknet";
import { useWallet } from "@/context/WalletContext";
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
        debt = BigInt(String((debtRaw as { low: bigint }).low ?? debtRaw));
        borrowLimit = BigInt(String((limitRaw as { low: bigint }).low ?? limitRaw));
      }

      setState({
        debt,
        borrowLimit,
        ltvRatio: Number(ltvRaw),
        totalBorrowed: BigInt(String((totalRaw as { low: bigint }).low ?? totalRaw)),
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

  const borrow = useCallback(
    async (amount: bigint) => {
      if (!account || !contracts.lending) return;
      setTx({ status: "pending", hash: null, message: "Borrowing..." });
      try {
        const borrowTx = await (contracts.lending.connect(account) as typeof contracts.lending).invoke(
          "borrow",
          [cairo.uint256(amount)],
        );
        await provider.waitForTransaction(borrowTx.transaction_hash);
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
        const repayTx = await (contracts.lending.connect(account) as typeof contracts.lending).invoke(
          "repay",
          [cairo.uint256(amount)],
        );
        await provider.waitForTransaction(repayTx.transaction_hash);
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
