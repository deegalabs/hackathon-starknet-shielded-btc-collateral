import { useState } from "react";
import { Zap, CheckCircle, XCircle, Users, ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { usePaymaster } from "@/hooks/usePaymaster";
import { useVault } from "@/hooks/useVault";
import { useWallet } from "@/context/WalletContext";
import { StatCard } from "@/components/StatCard";
import { TxToast } from "@/components/TxToast";
import { btcToSats, satsToBtc } from "@/lib/config";

export default function Paymaster() {
  const { isConnected } = useWallet();
  const { state: vault } = useVault();
  const { state, tx, fundBudget, refresh, resetTx } = usePaymaster();

  const [fundAmount, setFundAmount] = useState("");

  const handleFund = async () => {
    const sats = btcToSats(fundAmount);
    if (sats <= 0n) return;
    await fundBudget(sats);
    setFundAmount("");
  };

  // [H-07 Fix] Deposit detected via commitment (amount is private)
  const hasCollateral = vault.commitment !== "0x0" && vault.commitment !== "0x" && BigInt(vault.commitment || "0") !== 0n;
  // Threshold check: on-chain, vault.prove_collateral delegates to verifier (stub: commitment != 0)
  // Frontend: show eligibility based on commitment existence (mirrors stub behavior)
  const meetsThreshold = hasCollateral && state.threshold > 0n;

  // Threshold display: convert from raw u256 sats to BTC string, capped at sane value
  const thresholdBtc = (() => {
    if (state.threshold <= 0n) return "—";
    // If threshold is unreasonably large (> 21M BTC in sats = 2_100_000_000_000_000)
    // treat as not configured and show a short label
    const MAX_BTC_SATS = 2_100_000_000_000_000n;
    if (state.threshold > MAX_BTC_SATS) return "Any deposit";
    return `${satsToBtc(state.threshold)} BTC`;
  })();

  // Eligibility reason for "not eligible" state
  const ineligibleReason = (() => {
    if (!isConnected) return "Connect your wallet first.";
    if (!hasCollateral) return "Deposit BTC in the Vault to activate your commitment.";
    if (!meetsThreshold) return "Your commitment doesn't meet the sponsorship threshold yet.";
    if (state.remainingBudget === 0n) return "Gas budget is empty — fund the budget below or wait for a sponsor.";
    return null;
  })();

  return (
    <PageShell
      title="Paymaster"
      subtitle="Gasless transactions for qualifying users"
      action={<RefreshButton onClick={refresh} loading={state.isLoading} />}
    >

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          title="Gas Budget"
          value={state.remainingBudget.toLocaleString()}
          subtitle="STRK units remaining"
          icon={Zap}
          accent="stark"
          loading={state.isLoading}
        />
        <StatCard
          title="Sponsorship Threshold"
          value={thresholdBtc}
          subtitle="Minimum collateral required"
          icon={Users}
          accent="privacy"
          loading={state.isLoading}
        />
        <StatCard
          title="Your Status"
          value={state.isEligible ? "Eligible ✓" : "Not eligible"}
          subtitle={
            state.isEligible
              ? "Gas fees sponsored"
              : hasCollateral
                ? "Check budget / threshold"
                : "Deposit BTC first"
          }
          icon={ShieldCheck}
          accent={state.isEligible ? "privacy" : "default"}
          loading={state.isLoading}
        />
      </div>

      {/* Eligibility status */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-white mb-4">
          Your Eligibility
        </h2>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-sm text-muted">Wallet connected</span>
            <StatusIcon ok={isConnected} />
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-sm text-muted">Has active commitment</span>
            <StatusIcon ok={hasCollateral} />
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border gap-2">
            <span className="text-sm text-muted truncate">
              Meets threshold
              {thresholdBtc !== "Any deposit" && (
                <span className="ml-1 font-mono text-xs">({thresholdBtc})</span>
              )}
            </span>
            <StatusIcon ok={meetsThreshold} />
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted">Budget available</span>
            <StatusIcon ok={state.remainingBudget > 0n} />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
          {state.isEligible ? (
            <>
              <CheckCircle size={18} className="text-privacy" />
              <div>
                <p className="text-sm font-medium text-privacy">
                  Eligible for gas sponsorship
                </p>
                <p className="text-xs text-muted">
                  Protocol will cover your transaction fees
                </p>
              </div>
            </>
          ) : (
            <>
              <XCircle size={18} className="text-amber-400/80" />
              <div>
                <p className="text-sm font-medium text-white">
                  {state.remainingBudget === 0n && hasCollateral && meetsThreshold
                    ? "Eligible — awaiting gas budget"
                    : "Not eligible yet"}
                </p>
                <p className="text-xs text-muted">
                  {ineligibleReason}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fund budget */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Fund Gas Budget</h2>
          <p className="text-xs text-muted mt-1">
            Anyone can contribute — the protocol uses this to sponsor eligible users
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
            Amount (satoshis)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="1000000"
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              className="flex-1 bg-surface-2 border border-border rounded-lg px-4 py-3 text-white placeholder-muted font-mono text-sm focus:outline-none focus:border-stark transition-colors"
            />
          </div>
        </div>

        <button
          disabled={
            !isConnected ||
            btcToSats(fundAmount) <= 0n ||
            tx.status === "pending"
          }
          onClick={handleFund}
          className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-stark text-white hover:bg-stark-dim disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {!isConnected ? "Connect wallet" : "Fund Budget"}
        </button>
      </div>

      <TxToast tx={tx} onClose={resetTx} />
    </PageShell>
  );
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle size={16} className="text-privacy" />
  ) : (
    <XCircle size={16} className="text-muted" />
  );
}
