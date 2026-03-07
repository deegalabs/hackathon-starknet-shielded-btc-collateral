import { useCallback, useEffect, useState } from "react";
import { cairo } from "starknet";
import { useWallet } from "@/context/WalletContext";

export interface VaultState {
  commitment: string;       // hex felt252 or "0x0"
  committedAmount: bigint;  // satoshis
  totalLocked: bigint;      // vault-wide total
  isPaused: boolean;
  wbtcBalance: bigint;      // user's WBTC balance
  wbtcAllowance: bigint;    // current vault allowance
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
  committedAmount: 0n,
  totalLocked: 0n,
  isPaused: false,
  wbtcBalance: 0n,
  wbtcAllowance: 0n,
  isLoading: false,
  error: null,
};

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
      let committedAmount = 0n;
      let wbtcBalance = 0n;
      let wbtcAllowance = 0n;

      if (address) {
        const [c, ca, bal, allow] = await Promise.all([
          contracts.vault.get_commitment(address),
          contracts.vault.get_committed_amount(address),
          contracts.wbtc.balance_of(address),
          contracts.wbtc.allowance(address, contracts.vault.address),
        ]);
        commitment = `0x${BigInt(String(c)).toString(16)}`;
        committedAmount = BigInt(String((ca as { low: bigint }).low ?? ca));
        wbtcBalance = BigInt(String((bal as { low: bigint }).low ?? bal));
        wbtcAllowance = BigInt(String((allow as { low: bigint }).low ?? allow));
      }

      setState({
        commitment,
        committedAmount,
        totalLocked: BigInt(String((totalLocked as { low: bigint }).low ?? totalLocked)),
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

  const deposit = useCallback(
    async (amount: bigint, commitment: bigint) => {
      if (!account || !contracts.vault || !contracts.wbtc) return;
      setTx({ status: "pending", hash: null, message: "Approving WBTC..." });
      try {
        // Step 1: Approve
        const approveTx = await (contracts.wbtc.connect(account) as typeof contracts.wbtc).invoke(
          "approve",
          [contracts.vault.address, cairo.uint256(amount)],
        );
        await provider.waitForTransaction(approveTx.transaction_hash);
        setTx({ status: "pending", hash: approveTx.transaction_hash, message: "Depositing..." });

        // Step 2: Deposit
        const depositTx = await (contracts.vault.connect(account) as typeof contracts.vault).invoke(
          "deposit",
          [cairo.uint256(amount), `0x${commitment.toString(16)}`],
        );
        await provider.waitForTransaction(depositTx.transaction_hash);
        setTx({ status: "success", hash: depositTx.transaction_hash, message: "Deposit confirmed!" });
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Deposit failed";
        setTx({ status: "error", hash: null, message: msg });
      }
    },
    [account, contracts, provider, refresh],
  );

  const withdraw = useCallback(
    async (amount: bigint, nullifier: bigint) => {
      if (!account || !contracts.vault) return;
      setTx({ status: "pending", hash: null, message: "Withdrawing..." });
      try {
        const withdrawTx = await (contracts.vault.connect(account) as typeof contracts.vault).invoke(
          "withdraw",
          [cairo.uint256(amount), `0x${nullifier.toString(16)}`],
        );
        await provider.waitForTransaction(withdrawTx.transaction_hash);
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
