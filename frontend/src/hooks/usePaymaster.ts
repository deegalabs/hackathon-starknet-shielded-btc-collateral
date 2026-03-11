import { useCallback, useEffect, useState } from "react";
import { cairo } from "starknet";
import { useWallet } from "@/context/WalletContext";
import { waitTx, extractU256, toUserFriendlyError } from "@/lib/tx";
import type { TxState } from "./useVault";

export interface PaymasterState {
  isEligible: boolean;
  remainingBudget: bigint;
  threshold: bigint;
  isLoading: boolean;
  error: string | null;
}


export function usePaymaster() {
  const { account, address, contracts, provider } = useWallet();
  const [state, setState] = useState<PaymasterState>({
    isEligible: false,
    remainingBudget: 0n,
    threshold: 0n,
    isLoading: false,
    error: null,
  });
  const [tx, setTx] = useState<TxState>({ status: "idle", hash: null, message: null });

  const refresh = useCallback(async () => {
    if (!contracts.paymaster) return;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const [budgetRaw, thresholdRaw] = await Promise.all([
        contracts.paymaster.get_remaining_budget(),
        contracts.paymaster.get_sponsorship_threshold(),
      ]);

      let isEligible = false;
      if (address) {
        isEligible = Boolean(
          await contracts.paymaster.is_eligible_for_sponsorship(address),
        );
      }

      setState({
        isEligible,
        remainingBudget: extractU256(budgetRaw),
        threshold: extractU256(thresholdRaw),
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load paymaster data",
      }));
    }
  }, [address, contracts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fundBudget = useCallback(
    async (amount: bigint) => {
      if (!account || !contracts.paymaster) return;
      setTx({ status: "pending", hash: null, message: "Funding budget..." });
      try {
        const fundTx = await contracts.paymaster.invoke("fund_budget", [cairo.uint256(amount)]);
        await waitTx(provider, fundTx.transaction_hash);
        setTx({ status: "success", hash: fundTx.transaction_hash, message: "Budget funded!" });
        await refresh();
      } catch (err) {
        setTx({ status: "error", hash: null, message: toUserFriendlyError(err) || "Fund budget failed" });
      }
    },
    [account, contracts, provider, refresh],
  );

  const resetTx = useCallback(() => {
    setTx({ status: "idle", hash: null, message: null });
  }, []);

  return { state, tx, fundBudget, refresh, resetTx };
}
