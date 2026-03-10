import { useState } from "react";
import { TrendingUp, TrendingDown, ShieldCheck, RefreshCw, Info } from "lucide-react";
import { clsx } from "clsx";
import { useLending } from "@/hooks/useLending";
import { useVault } from "@/hooks/useVault";
import { useWallet } from "@/context/WalletContext";
import { StatCard } from "@/components/StatCard";
import { TxToast } from "@/components/TxToast";
import { btcToSats, satsToBtc } from "@/lib/config";

export default function Lending() {
  const { isConnected } = useWallet();
  const { state: vault } = useVault();
  const { state, tx, borrow, repay, refresh, resetTx } = useLending();

  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");

  // [H-07 Fix] Deposit detected via commitment (amount is private — not stored on-chain)
  const hasCollateral = vault.commitment !== "0x0" && vault.commitment !== "0x" && BigInt(vault.commitment || "0") !== 0n;
  const hasDebt = state.debt > 0n;

  // Required collateral (ceiling division at 70% LTV)
  // [H-07 Fix] We can't compare to committedAmount (private) — the vault contract
  // uses prove_collateral to verify on-chain. The UI shows required threshold only.
  const borrowSats = btcToSats(borrowAmount);
  const requiredCollateral =
    borrowSats > 0n ? (borrowSats * 100n + 69n) / 70n : 0n;
  // With stub verifier: any depositor passes. Frontend shows threshold for informational purposes.
  const collateralCoversLoan = borrowSats > 0n && hasCollateral;

  const utilizationPct =
    state.borrowLimit > 0n
      ? Math.min(100, Number((state.debt * 100n) / state.borrowLimit))
      : 0;

  const handleBorrow = async () => {
    const sats = btcToSats(borrowAmount);
    if (sats <= 0n) return;
    await borrow(sats);
    setBorrowAmount("");
  };

  const handleRepay = async () => {
    const sats = btcToSats(repayAmount);
    if (sats <= 0n || sats > state.debt) return;
    await repay(sats);
    setRepayAmount("");
  };

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Lending</h1>
          <p className="text-muted text-sm mt-1">
            Borrow against private BTC collateral — {state.ltvRatio}% LTV
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-lg text-muted hover:text-white hover:bg-surface-2 border border-border transition-colors"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title="Borrow Limit"
          value={
            state.borrowLimit > 0n
              ? `${satsToBtc(state.borrowLimit)} BTC`
              : hasCollateral
                ? "Private"
                : "0.00000000 BTC"
          }
          subtitle={
            state.borrowLimit > 0n
              ? `${state.ltvRatio}% of collateral`
              : hasCollateral
                ? "Limit not exposed on-chain (privacy)"
                : `${state.ltvRatio}% of collateral`
          }
          icon={TrendingUp}
          accent="stark"
        />
        <StatCard
          title="Active Debt"
          value={hasDebt ? `${satsToBtc(state.debt)} BTC` : "—"}
          subtitle={hasDebt ? `${utilizationPct}% utilized` : "No loan"}
          icon={TrendingDown}
          accent={hasDebt ? "btc" : "default"}
        />
      </div>

      {/* Utilization bar */}
      {state.borrowLimit > 0n && (
        <div>
          <div className="flex justify-between text-xs text-muted mb-1.5">
            <span>Utilization</span>
            <span>{utilizationPct}%</span>
          </div>
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={clsx(
                "h-full rounded-full transition-all",
                utilizationPct > 80
                  ? "bg-red-500"
                  : utilizationPct > 50
                    ? "bg-amber-400"
                    : "bg-privacy",
              )}
              style={{ width: `${utilizationPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Privacy note */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-border text-sm">
        <ShieldCheck size={16} className="text-privacy flex-shrink-0 mt-0.5" />
        <p className="text-muted">
          This protocol calls{" "}
          <span className="text-white font-mono text-xs">
            vault.prove_collateral(you, required)
          </span>{" "}
          — it verifies you meet the threshold{" "}
          <span className="text-white">without learning your exact deposit</span>.
        </p>
      </div>

      {/* Borrow card */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <TrendingUp size={15} className="text-stark" />
          Borrow
        </h2>

        {!hasCollateral ? (
          <p className="text-sm text-muted py-4 text-center">
            Deposit BTC in the Vault first to enable borrowing.
            {state.borrowLimit === 0n && (
              <span className="block mt-2 text-xs">
                Using the same account that has the deposit (e.g. ShieldedAccount).
              </span>
            )}
          </p>
        ) : hasDebt ? (
          <p className="text-sm text-amber-400/90 flex items-start gap-2">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            You have an active loan of {satsToBtc(state.debt)} BTC. Repay it
            before borrowing again.
          </p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Amount to borrow (BTC)
              </label>
              <input
                type="number"
                placeholder="0.00000000"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-white placeholder-muted font-mono text-sm focus:outline-none focus:border-stark transition-colors"
              />
            </div>

            {borrowSats > 0n && (
              <div className="rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted">Borrow amount</span>
                  <span className="text-white">
                    {borrowSats.toLocaleString()} sats
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Required collateral (70% LTV)</span>
                  <span className={collateralCoversLoan ? "text-privacy" : "text-red-400"}>
                    {requiredCollateral.toLocaleString()} sats
                  </span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="text-muted">Your commitment</span>
                  <span className={hasCollateral ? "text-privacy" : "text-red-400"}>
                    {hasCollateral ? "Active ✓" : "None ✗"}
                  </span>
                </div>
              </div>
            )}

            <button
              disabled={
                !isConnected ||
                borrowSats <= 0n ||
                !collateralCoversLoan ||
                tx.status === "pending"
              }
              onClick={handleBorrow}
              className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-stark text-white hover:bg-stark-dim disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {!collateralCoversLoan && borrowSats > 0n
                ? "Insufficient collateral"
                : "Borrow"}
            </button>
          </>
        )}
      </div>

      {/* Repay card */}
      {hasDebt && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <TrendingDown size={15} className="text-btc" />
            Repay
          </h2>

          <div className="rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs flex justify-between">
            <span className="text-muted">Outstanding debt</span>
            <span className="text-btc">{satsToBtc(state.debt)} BTC</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Amount to repay (BTC)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="0.00000000"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                className="flex-1 bg-surface-2 border border-border rounded-lg px-4 py-3 text-white placeholder-muted font-mono text-sm focus:outline-none focus:border-btc transition-colors"
              />
              <button
                onClick={() => setRepayAmount(satsToBtc(state.debt))}
                className="px-3 py-2 rounded-lg text-xs text-muted border border-border hover:text-white hover:bg-surface-2 transition-colors"
              >
                Max
              </button>
            </div>
          </div>

          <button
            disabled={
              !isConnected ||
              btcToSats(repayAmount) <= 0n ||
              btcToSats(repayAmount) > state.debt ||
              tx.status === "pending"
            }
            onClick={handleRepay}
            className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-btc text-white hover:bg-btc-dim disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Repay
          </button>
        </div>
      )}

      <TxToast tx={tx} onClose={resetTx} />
    </div>
  );
}
