import { useState, useEffect } from "react";
import {
  Bitcoin,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { clsx } from "clsx";
import { useVault } from "@/hooks/useVault";
import { useWallet } from "@/context/WalletContext";
import { StatCard } from "@/components/StatCard";
import { TxToast } from "@/components/TxToast";
import {
  computeCommitment,
  computeNullifier,
  generateSecret,
  shortHash,
  toHex,
} from "@/lib/crypto";
import { btcToSats, satsToBtc } from "@/lib/config";

type Tab = "deposit" | "withdraw";

export default function Vault() {
  const { isConnected } = useWallet();
  const { state, tx, deposit, withdraw, refresh, resetTx } = useVault();

  const [tab, setTab] = useState<Tab>("deposit");

  // Deposit form
  const [depositAmount, setDepositAmount] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [commitment, setCommitment] = useState<bigint | null>(null);

  // Withdraw form
  const [withdrawSecret, setWithdrawSecret] = useState("");
  const [showWithdrawSecret, setShowWithdrawSecret] = useState(false);
  const [nullifier, setNullifier] = useState<bigint | null>(null);

  const [showProofDetails, setShowProofDetails] = useState(false);

  // Live commitment preview
  useEffect(() => {
    const sats = btcToSats(depositAmount);
    const sec = secret ? BigInt(secret) : null;
    if (sats > 0n && sec !== null) {
      try {
        setCommitment(computeCommitment(sats, sec));
      } catch {
        setCommitment(null);
      }
    } else {
      setCommitment(null);
    }
  }, [depositAmount, secret]);

  // Live nullifier preview
  useEffect(() => {
    const storedCommitment =
      state.commitment !== "0x0" ? BigInt(state.commitment) : null;
    const sec = withdrawSecret ? BigInt(withdrawSecret) : null;
    if (storedCommitment && sec !== null) {
      try {
        setNullifier(computeNullifier(storedCommitment, sec));
      } catch {
        setNullifier(null);
      }
    } else {
      setNullifier(null);
    }
  }, [withdrawSecret, state.commitment]);

  const handleGenerateSecret = () => {
    setSecret(toHex(generateSecret()));
  };

  const handleDeposit = async () => {
    const sats = btcToSats(depositAmount);
    if (sats <= 0n || !commitment) return;
    await deposit(sats, commitment);
  };

  const handleWithdraw = async () => {
    if (!nullifier || state.committedAmount === 0n) return;
    await withdraw(state.committedAmount, nullifier);
  };

  const hasDeposit = state.committedAmount > 0n;

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Vault</h1>
          <p className="text-muted text-sm mt-1">
            Deposit & withdraw with Poseidon commitment privacy
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-lg text-muted hover:text-white hover:bg-surface-2 border border-border transition-colors"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title="Your Collateral"
          value={hasDeposit ? `${satsToBtc(state.committedAmount)} BTC` : "—"}
          subtitle={hasDeposit ? "Active commitment" : "No deposit"}
          icon={Bitcoin}
          accent={hasDeposit ? "btc" : "default"}
        />
        <StatCard
          title="Total Locked"
          value={`${satsToBtc(state.totalLocked)} BTC`}
          subtitle="Protocol-wide"
          icon={Lock}
          accent="privacy"
        />
      </div>

      {/* Paused warning */}
      {state.isPaused && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
          <AlertTriangle size={16} />
          Vault is currently paused by the admin. Deposits and withdrawals are disabled.
        </div>
      )}

      {/* Tabs */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="flex border-b border-border">
          {(["deposit", "withdraw"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "flex-1 py-3 text-sm font-medium capitalize transition-colors",
                tab === t
                  ? "text-white bg-surface-2 border-b-2 border-btc"
                  : "text-muted hover:text-white",
              )}
            >
              {t === "deposit" ? (
                <span className="flex items-center justify-center gap-2">
                  <Lock size={14} /> Deposit
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Unlock size={14} /> Withdraw
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {tab === "deposit" && (
            <>
              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                  Amount (BTC)
                </label>
                <input
                  type="number"
                  placeholder="0.00000000"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-white placeholder-muted font-mono text-sm focus:outline-none focus:border-btc transition-colors"
                />
                {depositAmount && (
                  <p className="text-xs text-muted mt-1">
                    = {btcToSats(depositAmount).toLocaleString()} satoshis
                  </p>
                )}
              </div>

              {/* Secret */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-muted uppercase tracking-wider">
                    Secret (private — save this!)
                  </label>
                  <button
                    onClick={handleGenerateSecret}
                    className="text-xs text-stark hover:text-white transition-colors"
                  >
                    Generate random
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    placeholder="0x..."
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-white placeholder-muted font-mono text-sm focus:outline-none focus:border-stark transition-colors pr-10"
                  />
                  <button
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white"
                  >
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-xs text-amber-400/80 mt-1">
                  ⚠ Store your secret safely — you need it to withdraw
                </p>
              </div>

              {/* Live commitment preview — the KEY privacy UX moment */}
              <div
                className={clsx(
                  "rounded-xl border p-4 transition-all",
                  commitment
                    ? "border-privacy/30 bg-privacy/5"
                    : "border-border bg-surface-2",
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck
                      size={15}
                      className={commitment ? "text-privacy" : "text-muted"}
                    />
                    <span className="text-xs font-medium text-muted uppercase tracking-wider">
                      Poseidon Commitment Preview
                    </span>
                  </div>
                  {commitment && (
                    <span className="text-xs bg-privacy/20 text-privacy px-2 py-0.5 rounded-full">
                      PRIVATE
                    </span>
                  )}
                </div>

                <div className="space-y-2 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">amount (hidden)</span>
                    <span className="text-amber-400">
                      {depositAmount
                        ? `${btcToSats(depositAmount).toLocaleString()} sats`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">secret (hidden)</span>
                    <span className="text-amber-400">
                      {secret ? "•••••••••••" : "—"}
                    </span>
                  </div>
                  <div className="border-t border-border/50 pt-2 flex justify-between">
                    <span className="text-muted">
                      commitment = Poseidon(↑)
                    </span>
                    <span className="text-privacy">
                      {commitment ? shortHash(commitment) : "—"}
                    </span>
                  </div>
                </div>

                {commitment && (
                  <p className="text-xs text-muted mt-3">
                    Only this hash goes on-chain.{" "}
                    <span className="text-white">
                      Nobody can learn your deposit amount from it.
                    </span>
                  </p>
                )}
              </div>

              <button
                disabled={
                  !isConnected ||
                  !commitment ||
                  state.isPaused ||
                  state.committedAmount > 0n ||
                  tx.status === "pending"
                }
                onClick={handleDeposit}
                className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-btc text-white hover:bg-btc-dim disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state.committedAmount > 0n
                  ? "Active commitment exists — withdraw first"
                  : !isConnected
                    ? "Connect wallet to deposit"
                    : "Deposit & Commit"}
              </button>
            </>
          )}

          {tab === "withdraw" && (
            <>
              {!hasDeposit ? (
                <div className="text-center py-8">
                  <Lock size={32} className="text-muted mx-auto mb-3" />
                  <p className="text-sm text-muted">No active commitment.</p>
                  <p className="text-xs text-muted mt-1">
                    Make a deposit first.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-2 font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted">Committed amount</span>
                      <span className="text-btc">
                        {satsToBtc(state.committedAmount)} BTC
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted">Your commitment</span>
                      <button
                        onClick={() => setShowProofDetails(!showProofDetails)}
                        className="flex items-center gap-1 text-muted hover:text-white"
                      >
                        {shortHash(BigInt(state.commitment))}
                        {showProofDetails ? (
                          <ChevronUp size={11} />
                        ) : (
                          <ChevronDown size={11} />
                        )}
                      </button>
                    </div>
                    {showProofDetails && (
                      <div className="text-muted break-all pt-1 border-t border-border">
                        {state.commitment}
                      </div>
                    )}
                  </div>

                  {/* Withdraw secret */}
                  <div>
                    <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                      Withdraw Secret
                    </label>
                    <div className="relative">
                      <input
                        type={showWithdrawSecret ? "text" : "password"}
                        placeholder="0x... (the secret you used when depositing, or a new withdraw secret)"
                        value={withdrawSecret}
                        onChange={(e) => setWithdrawSecret(e.target.value)}
                        className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-white placeholder-muted font-mono text-xs focus:outline-none focus:border-stark transition-colors pr-10"
                      />
                      <button
                        onClick={() =>
                          setShowWithdrawSecret(!showWithdrawSecret)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white"
                      >
                        {showWithdrawSecret ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Nullifier preview */}
                  <div
                    className={clsx(
                      "rounded-xl border p-4 transition-all",
                      nullifier
                        ? "border-stark/30 bg-stark/5"
                        : "border-border bg-surface-2",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck
                        size={15}
                        className={nullifier ? "text-stark" : "text-muted"}
                      />
                      <span className="text-xs font-medium text-muted uppercase tracking-wider">
                        One-Time Nullifier
                      </span>
                    </div>
                    <div className="font-mono text-xs space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted">commitment</span>
                        <span className="text-privacy">
                          {shortHash(BigInt(state.commitment))}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">withdraw_secret</span>
                        <span className="text-amber-400">
                          {withdrawSecret ? "•••••••••" : "—"}
                        </span>
                      </div>
                      <div className="border-t border-border/50 pt-2 flex justify-between">
                        <span className="text-muted">
                          nullifier = Poseidon(↑)
                        </span>
                        <span className="text-stark">
                          {nullifier ? shortHash(nullifier) : "—"}
                        </span>
                      </div>
                    </div>
                    {nullifier && (
                      <p className="text-xs text-muted mt-3">
                        This nullifier is burned after use —{" "}
                        <span className="text-white">
                          double-spend is impossible.
                        </span>
                      </p>
                    )}
                  </div>

                  <button
                    disabled={
                      !isConnected ||
                      !nullifier ||
                      state.isPaused ||
                      tx.status === "pending"
                    }
                    onClick={handleWithdraw}
                    className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-stark text-white hover:bg-stark-dim disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {!isConnected ? "Connect wallet" : "Withdraw BTC"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <TxToast tx={tx} onClose={resetTx} />
    </div>
  );
}
