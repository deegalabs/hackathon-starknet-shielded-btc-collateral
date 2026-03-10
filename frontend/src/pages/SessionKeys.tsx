import { useState } from "react";
import {
  KeyRound,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Clock,
  RefreshCw,
  Copy,
  CheckCircle,
  Wallet,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { clsx } from "clsx";
import { useSessionKeys, type SessionKeyInfo } from "@/hooks/useSessionKeys";
import { useWallet } from "@/context/WalletContext";
import { WalletButton } from "@/components/WalletButton";
import { TxToast } from "@/components/TxToast";
import { shortAddr, satsToBtc } from "@/lib/config";
import { CONTRACTS } from "@/lib/config";

export default function SessionKeys() {
  const { isConnected } = useWallet();
  const { tx, generateKeyPair, registerSession, revokeSession, getSessionInfo, resetTx } =
    useSessionKeys();

  const [showRegister, setShowRegister] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<{
    privateKey: string;
    publicKey: string;
  } | null>(null);
  const [showPrivKey, setShowPrivKey] = useState(false);
  const [spendingLimit, setSpendingLimit] = useState("0.001");
  const [expiryDays, setExpiryDays] = useState("7");
  const [allowedContract, setAllowedContract] = useState(CONTRACTS.VAULT || "");

  const [lookupKey, setLookupKey] = useState("");
  const [sessionInfo, setSessionInfo] = useState<SessionKeyInfo | null>(null);
  const [lookupAttempted, setLookupAttempted] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** Store last registered public key for copy / Lookup / Revoke later */
  const [lastRegisteredPubKey, setLastRegisteredPubKey] = useState<string | null>(null);

  const hasSkm = Boolean(CONTRACTS.SESSION_KEY_MANAGER);

  const handleGenerate = () => {
    setGeneratedKey(generateKeyPair());
  };

  const handleRegister = async () => {
    if (!generatedKey) return;
    const expiryTs = Math.floor(Date.now() / 1000) + Number(expiryDays) * 86400;
    const limitSats = BigInt(Math.round(parseFloat(spendingLimit) * 1e8));
    const ok = await registerSession(
      generatedKey.publicKey,
      expiryTs,
      limitSats,
      allowedContract || "0x0",
    );
    if (ok) {
      setLastRegisteredPubKey(generatedKey.publicKey);
      setShowRegister(false);
      setGeneratedKey(null);
    }
  };

  const handleLookup = async () => {
    if (!lookupKey) return;
    setLookupAttempted(true);
    const info = await getSessionInfo(lookupKey);
    setSessionInfo(info);
  };

  const handleRevoke = async (pubKey: string) => {
    await revokeSession(pubKey);
    setSessionInfo(null);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <PageShell
      title="Session Keys"
      subtitle="Delegate limited DApp access without sharing your main private key"
    >

      {/* How it works */}
      <div className="rounded-xl border border-stark/20 bg-stark/5 p-4 text-sm">
        <p className="text-muted leading-relaxed">
          <span className="text-white font-medium">Account Abstraction (SNIP-9):</span>{" "}
          Register a temporary session key with a spending limit, expiry, and
          optional contract restriction. DApps sign with this key — your main key stays safe.
        </p>
      </div>

      {!hasSkm && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          Session Key Manager contract is not configured. Register and Lookup will not work until
          VITE_SESSION_KEY_MANAGER_ADDRESS is set.
        </div>
      )}

      {!isConnected && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <div className="w-11 h-11 rounded-full bg-stark/10 border border-stark/20 flex items-center justify-center mx-auto mb-4">
            <Wallet size={20} className="text-stark" />
          </div>
          <h3 className="text-sm font-semibold text-white mb-1">
            Connect your wallet to manage session keys
          </h3>
          <p className="text-xs text-muted max-w-xs mx-auto mb-5">
            You need an active connection to register, look up, or revoke session keys.
          </p>
          <div className="flex justify-center">
            <WalletButton />
          </div>
        </div>
      )}

      {/* Last registered key — for copy / Lookup / Revoke */}
      {lastRegisteredPubKey && (
        <div className="rounded-xl border border-privacy/30 bg-privacy/5 p-4">
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            Last registered key — save for Lookup / Revoke
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-white truncate flex-1">
              {shortAddr(lastRegisteredPubKey)}
            </span>
            <button
              onClick={() => copyToClipboard(lastRegisteredPubKey, "last")}
              className="text-muted hover:text-white"
              title="Copy full public key"
            >
              {copied === "last" ? (
                <CheckCircle size={14} className="text-privacy" />
              ) : (
                <Copy size={14} />
              )}
            </button>
            <button
              onClick={async () => {
                setLookupKey(lastRegisteredPubKey);
                setLookupAttempted(true);
                const info = await getSessionInfo(lastRegisteredPubKey);
                setSessionInfo(info);
              }}
              className="text-xs text-stark hover:text-white"
            >
              Use in Lookup
            </button>
          </div>
          <p className="text-xs text-muted mt-2">
            If you lose the public key, the session expires after the configured days; revoke requires the public key.
          </p>
        </div>
      )}

      {/* Register new key */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <button
          onClick={() => setShowRegister(!showRegister)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-white hover:bg-surface-2 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Plus size={15} className="text-stark" />
            Register New Session Key
          </span>
          <span className="text-muted text-xs">{showRegister ? "▲" : "▼"}</span>
        </button>

        {showRegister && (
          <div className="px-5 pb-5 space-y-4 border-t border-border">
            {/* Generate key pair */}
            <div className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  Session Key Pair
                </label>
                <button
                  onClick={handleGenerate}
                  className="text-xs text-stark hover:text-white transition-colors"
                >
                  Generate new key pair
                </button>
              </div>

              {generatedKey ? (
                <div className="space-y-2">
                  {/* Public key */}
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-2 border border-border">
                    <span className="text-xs text-muted w-16 flex-shrink-0">Public</span>
                    <span className="text-xs text-white font-mono flex-1 truncate">
                      {shortAddr(generatedKey.publicKey)}
                    </span>
                    <button
                      onClick={() => copyToClipboard(generatedKey.publicKey, "pub")}
                      className="text-muted hover:text-white"
                    >
                      {copied === "pub" ? (
                        <CheckCircle size={13} className="text-privacy" />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  </div>
                  {/* Private key */}
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-2 border border-amber-500/30">
                    <span className="text-xs text-muted w-16 flex-shrink-0">Private</span>
                    <span className="text-xs text-amber-400 font-mono flex-1 truncate">
                      {showPrivKey ? generatedKey.privateKey : "••••••••••••••••"}
                    </span>
                    <button
                      onClick={() => setShowPrivKey(!showPrivKey)}
                      className="text-muted hover:text-white"
                    >
                      {showPrivKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      onClick={() => copyToClipboard(generatedKey.privateKey, "priv")}
                      className="text-muted hover:text-white"
                    >
                      {copied === "priv" ? (
                        <CheckCircle size={13} className="text-privacy" />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-amber-400/80">
                    ⚠ Save the private key — it cannot be recovered
                  </p>
                </div>
              ) : (
                <div className="text-center py-6 border border-dashed border-border rounded-lg">
                  <KeyRound size={24} className="text-muted mx-auto mb-2" />
                  <p className="text-xs text-muted">
                    Click "Generate new key pair" to create a session key
                  </p>
                </div>
              )}
            </div>

            {/* Spending limit */}
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Spending Limit (BTC)
              </label>
              <input
                type="number"
                value={spendingLimit}
                onChange={(e) => setSpendingLimit(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-stark transition-colors"
              />
            </div>

            {/* Expiry */}
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Expiry (days from now)
              </label>
              <input
                type="number"
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-stark transition-colors"
              />
            </div>

            {/* Allowed contract */}
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Allowed Contract (0x0 = any)
              </label>
              <input
                type="text"
                value={allowedContract}
                onChange={(e) => setAllowedContract(e.target.value)}
                placeholder="0x..."
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-stark transition-colors"
              />
              <p className="text-xs text-muted mt-1">
                Restrict this session key to interact only with this contract (e.g., the Vault)
              </p>
            </div>

            <button
              disabled={
                !isConnected ||
                !generatedKey ||
                tx.status === "pending"
              }
              onClick={handleRegister}
              className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-stark text-white hover:bg-stark-dim disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {!isConnected ? "Connect wallet" : "Register Session Key"}
            </button>
          </div>
        )}
      </div>

      {/* Lookup / revoke */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <RefreshCw size={15} className="text-muted" />
          Look Up Session Key
        </h2>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Session public key (0x...)"
            value={lookupKey}
            onChange={(e) => setLookupKey(e.target.value)}
            className="flex-1 bg-surface-2 border border-border rounded-lg px-4 py-3 text-white placeholder-muted font-mono text-xs focus:outline-none focus:border-stark transition-colors"
          />
          <button
            onClick={handleLookup}
            disabled={!lookupKey || !isConnected}
            className="px-4 py-2 rounded-lg text-sm bg-surface-2 border border-border text-white hover:bg-border disabled:opacity-40 transition-colors"
          >
            Lookup
          </button>
        </div>

        {lookupAttempted && !sessionInfo && (
          <div className="rounded-xl border border-border bg-surface-2 p-4 text-center text-sm text-muted">
            Session key not found. Check the public key or register one first.
          </div>
        )}
        {sessionInfo && (
          <div
            className={clsx(
              "rounded-xl border p-4 space-y-3",
              sessionInfo.isValid && sessionInfo.isActive
                ? "border-privacy/30 bg-privacy/5"
                : "border-red-500/30 bg-red-500/5",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted uppercase tracking-wider">
                Session Info
              </span>
              <span
                className={clsx(
                  "text-xs px-2 py-0.5 rounded-full",
                  sessionInfo.isValid && sessionInfo.isActive
                    ? "bg-privacy/20 text-privacy"
                    : "bg-red-500/20 text-red-400",
                )}
              >
                {sessionInfo.isValid && sessionInfo.isActive ? "Active" : "Inactive / Revoked"}
              </span>
            </div>

            <div className="space-y-2 font-mono text-xs">
              <InfoRow
                label="Expiry"
                value={
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {new Date(sessionInfo.expiryTimestamp * 1000).toLocaleString()}
                  </span>
                }
              />
              <InfoRow
                label="Spending limit"
                value={`${satsToBtc(sessionInfo.spendingLimit)} BTC`}
              />
              <InfoRow
                label="Spent"
                value={`${satsToBtc(sessionInfo.spent)} BTC`}
              />
              <InfoRow
                label="Allowed contract"
                value={
                  sessionInfo.allowedContract === "0x0" ||
                  sessionInfo.allowedContract === "0"
                    ? "Any contract"
                    : shortAddr(sessionInfo.allowedContract)
                }
              />
            </div>

            {sessionInfo.isActive && (
              <button
                onClick={() => handleRevoke(sessionInfo.pubKey)}
                disabled={tx.status === "pending"}
                className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
              >
                <Trash2 size={13} />
                Revoke this session key
              </button>
            )}
          </div>
        )}
      </div>

      <TxToast tx={tx} onClose={resetTx} />
    </PageShell>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
