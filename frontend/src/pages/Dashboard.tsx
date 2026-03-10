import { Bitcoin, Lock, Zap, ShieldCheck, ArrowRight, Layers, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { StatCard } from "@/components/StatCard";
import { PageShell } from "@/components/PageShell";
import { useWallet } from "@/context/WalletContext";
import { useVault } from "@/hooks/useVault";
import { usePaymaster } from "@/hooks/usePaymaster";
import { satsToBtc, shortAddr } from "@/lib/config";

export default function Dashboard() {
  const { isConnected, address } = useWallet();
  const { state: vault } = useVault();
  const { state: paymaster } = usePaymaster();

  // [H-07 Fix] Deposit detected via commitment (not plaintext amount — amounts are private)
  const hasDeposit = vault.commitment !== "0x0" && vault.commitment !== "0x" && BigInt(vault.commitment || "0") !== 0n;

  return (
    <PageShell
      title="Dashboard"
      subtitle="Privacy-preserving BTC collateral on Starknet"
    >

      {/* Protocol overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Locked"
          value={`${satsToBtc(vault.totalLocked)} BTC`}
          subtitle="Protocol-wide vault"
          icon={Bitcoin}
          accent="btc"
        />
        <StatCard
          title="Your Collateral"
          value={hasDeposit ? "Private" : "—"}
          subtitle={hasDeposit ? "Commitment active" : "No deposit yet"}
          icon={Lock}
          accent={hasDeposit ? "privacy" : "default"}
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
        <div className="space-y-6">
          {/* Your Shield actions */}
          <div>
            <h2 className="text-xs font-semibold text-muted/60 uppercase tracking-widest mb-3">
              Your Shield
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  to: "/vault",
                  label: hasDeposit ? "Manage Vault" : "Deposit BTC",
                  desc: hasDeposit ? "View or withdraw" : "Lock BTC privately",
                  color: "btc",
                  icon: Bitcoin,
                },
                {
                  to: "/paymaster",
                  label: "Paymaster",
                  desc: "Gasless transactions",
                  color: "privacy",
                  icon: Zap,
                },
                {
                  to: "/session-keys",
                  label: "Session Keys",
                  desc: "Delegate DApp access",
                  color: "stark",
                  icon: ShieldCheck,
                },
              ].map(({ to, label, desc, color, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface hover:border-border-bright hover:bg-surface-2 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-${color}/10 flex items-center justify-center flex-shrink-0`}>
                      <Icon size={15} className={`text-${color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{label}</p>
                      <p className="text-xs text-muted mt-0.5">{desc}</p>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-muted group-hover:text-white transition-colors flex-shrink-0" />
                </Link>
              ))}
            </div>
          </div>

          {/* Ecosystem */}
          <div>
            <h2 className="text-xs font-semibold text-muted/60 uppercase tracking-widest mb-3">
              Ecosystem — DeFi Integrations
            </h2>
            <Link
              to="/lending"
              className="flex items-center justify-between p-4 rounded-xl border border-btc/20 bg-btc/5 hover:border-btc/40 hover:bg-btc/8 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-btc/15 flex items-center justify-center flex-shrink-0">
                  <Layers size={15} className="text-btc" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">MockLendingProtocol</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-btc/15 text-btc font-medium">DEMO</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Borrow using your private BTC collateral — no balance revealed
                  </p>
                </div>
              </div>
              <ArrowRight size={14} className="text-muted group-hover:text-btc transition-colors flex-shrink-0" />
            </Link>
            <p className="mt-2 text-xs text-muted/50 px-1">
              Production: zkLend, Nostra, and any protocol calling{" "}
              <span className="font-mono">prove_collateral</span> can integrate here.
            </p>
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
    </PageShell>
  );
}
