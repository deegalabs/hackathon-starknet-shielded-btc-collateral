import { Bitcoin, Lock, TrendingUp, Zap, ShieldCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { StatCard } from "@/components/StatCard";
import { useWallet } from "@/context/WalletContext";
import { useVault } from "@/hooks/useVault";
import { useLending } from "@/hooks/useLending";
import { usePaymaster } from "@/hooks/usePaymaster";
import { satsToBtc, shortAddr } from "@/lib/config";

export default function Dashboard() {
  const { isConnected, address } = useWallet();
  const { state: vault } = useVault();
  const { state: lending } = useLending();
  const { state: paymaster } = usePaymaster();

  const hasDeposit = vault.committedAmount > 0n;
  const utilizationPct =
    lending.borrowLimit > 0n
      ? Number((lending.debt * 100n) / lending.borrowLimit)
      : 0;

  return (
    <div className="max-w-5xl space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-muted text-sm mt-1">
          Privacy-preserving BTC collateral on Starknet
        </p>
      </div>

      {/* Protocol overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Locked"
          value={`${satsToBtc(vault.totalLocked)} BTC`}
          subtitle="Protocol-wide vault"
          icon={Bitcoin}
          accent="btc"
        />
        <StatCard
          title="Your Collateral"
          value={hasDeposit ? `${satsToBtc(vault.committedAmount)} BTC` : "—"}
          subtitle={hasDeposit ? "Active commitment" : "No deposit yet"}
          icon={Lock}
          accent={hasDeposit ? "privacy" : "default"}
        />
        <StatCard
          title="Your Debt"
          value={lending.debt > 0n ? `${satsToBtc(lending.debt)} BTC` : "—"}
          subtitle={
            lending.debt > 0n
              ? `${utilizationPct}% of limit used`
              : "No active loan"
          }
          icon={TrendingUp}
          accent={lending.debt > 0n ? "stark" : "default"}
        />
        <StatCard
          title="Gas Sponsorship"
          value={paymaster.isEligible ? "Eligible ✓" : "Not eligible"}
          subtitle={
            paymaster.remainingBudget > 0n
              ? `Budget: ${paymaster.remainingBudget.toLocaleString()} units`
              : "No budget available"
          }
          icon={Zap}
          accent={paymaster.isEligible ? "privacy" : "default"}
        />
      </div>

      {/* Privacy banner */}
      <div className="rounded-xl border border-privacy/20 bg-privacy/5 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-privacy/10 border border-privacy/20 flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={20} className="text-privacy" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">
              How Privacy Works
            </h3>
            <p className="text-sm text-muted leading-relaxed">
              Your deposit amount is <span className="text-white">never stored on-chain</span>.
              Instead, a <span className="text-privacy font-mono text-xs">Poseidon(amount, secret)</span> commitment hash is recorded.
              DeFi protocols verify you meet a threshold <span className="text-white">without learning your exact balance</span>.
            </p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      {isConnected ? (
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                to: "/vault",
                label: hasDeposit ? "Manage Vault" : "Deposit BTC",
                desc: hasDeposit ? "View or withdraw" : "Start earning",
                color: "btc",
              },
              {
                to: "/lending",
                label: lending.debt > 0n ? "Manage Loan" : "Borrow",
                desc: lending.debt > 0n ? "Repay debt" : "Use collateral",
                color: "stark",
              },
              {
                to: "/paymaster",
                label: "Paymaster",
                desc: "Gasless transactions",
                color: "privacy",
              },
              {
                to: "/session-keys",
                label: "Session Keys",
                desc: "Delegate DApp access",
                color: "default",
              },
            ].map(({ to, label, desc, color }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface hover:border-border-bright hover:bg-surface-2 transition-all group"
              >
                <div>
                  <p className={`text-sm font-medium text-${color === "default" ? "white" : color}`}>
                    {label}
                  </p>
                  <p className="text-xs text-muted mt-0.5">{desc}</p>
                </div>
                <ArrowRight
                  size={14}
                  className="text-muted group-hover:text-white transition-colors"
                />
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-stark/10 border border-stark/20 flex items-center justify-center mx-auto mb-4">
            <Lock size={22} className="text-stark" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            Connect your wallet to get started
          </h3>
          <p className="text-sm text-muted max-w-sm mx-auto">
            Connect Argent X or Braavos to deposit WBTC, prove collateral, and
            access DeFi without revealing your balance.
          </p>
          {address && (
            <p className="mt-3 text-xs text-muted font-mono">{shortAddr(address)}</p>
          )}
        </div>
      )}
    </div>
  );
}
