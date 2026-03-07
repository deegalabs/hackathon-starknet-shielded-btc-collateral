/**
 * AccountSetup — Deploy your personal ShieldedAccount on Starknet.
 *
 * The ShieldedAccount is a Cairo smart contract account built for this protocol.
 * It implements:
 *   - SNIP-6 (__execute__, __validate__, is_valid_signature)
 *   - Session Keys (SNIP-9 Outside Execution)
 *   - Paymaster integration for gasless transactions
 *
 * Once deployed, the ShieldedAccount becomes the active protocol account,
 * replacing the original signer for all vault, lending, and session key ops.
 */
import { useState } from "react";
import {
  UserCheck,
  ShieldCheck,
  KeyRound,
  Zap,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Info,
} from "lucide-react";
import { clsx } from "clsx";
import { useWallet } from "@/context/WalletContext";
import { useShieldedAccount } from "@/hooks/useShieldedAccount";
import { SHIELDED_ACCOUNT_CLASS_HASH, CONTRACTS, shortAddr } from "@/lib/config";

const FEATURES = [
  {
    icon: KeyRound,
    title: "Session Keys (SNIP-9)",
    desc: "Delegate limited permissions without exposing your main key.",
    color: "text-stark",
    bg: "bg-stark/10",
  },
  {
    icon: Zap,
    title: "Gasless Transactions",
    desc: "Paymaster sponsors gas for eligible collateral operations.",
    color: "text-btc",
    bg: "bg-btc/10",
  },
  {
    icon: ShieldCheck,
    title: "Privacy-Aware",
    desc: "Knows your CollateralVault so session keys can be scoped precisely.",
    color: "text-privacy",
    bg: "bg-privacy/10",
  },
];

const STATUS_LABELS: Record<string, string> = {
  generating_keys: "Generating Stark key pair…",
  deploying: "Submitting deploy transaction…",
  confirming: "Waiting for block inclusion…",
  done: "ShieldedAccount deployed!",
  error: "Deployment failed",
};

export default function AccountSetup() {
  const { account, address, provider, switchToShieldedAccount } = useWallet();
  const { status, error, txHash, info, deploy, clear } = useShieldedAccount();
  const [showPrivKey, setShowPrivKey] = useState(false);

  const isClassHashMissing = !SHIELDED_ACCOUNT_CLASS_HASH;
  const isDeploying =
    status === "generating_keys" ||
    status === "deploying" ||
    status === "confirming";

  async function handleDeploy() {
    if (!account) return;
    await deploy(account, provider, (shieldedAcc, addr) => {
      switchToShieldedAccount(shieldedAcc, addr);
    });
  }

  // ── Already deployed ─────────────────────────────────────────────────────
  if (info && status !== "error") {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-white">My ShieldedAccount</h1>
          <p className="text-muted text-sm mt-1">
            Your personal Cairo smart account for the Shielded BTC protocol.
          </p>
        </div>

        {/* Success banner */}
        <div className="flex items-start gap-4 p-5 rounded-xl bg-privacy/10 border border-privacy/30">
          <CheckCircle2 size={24} className="text-privacy flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white">Account active</p>
            <p className="text-sm text-muted mt-0.5">
              All vault, lending, and session key operations now use your
              ShieldedAccount.
            </p>
          </div>
        </div>

        {/* Details card */}
        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
          <Row label="Address" value={info.address} mono copyable />
          <Row label="Public Key" value={info.publicKey} mono copyable />
          <Row
            label="Vault Linked"
            value={info.vaultAddress ? shortAddr(info.vaultAddress) : "Not set"}
            mono
          />
          <Row
            label="Deployed"
            value={new Date(info.deployedAt).toLocaleString()}
          />
        </div>

        {/* Session key note */}
        <div className="flex gap-3 p-4 rounded-xl bg-surface border border-border">
          <Info size={16} className="text-stark flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted">
            The private key is stored only in your browser's{" "}
            <span className="text-white">sessionStorage</span> and is cleared when
            you close the tab. Go to{" "}
            <span className="text-stark">Session Keys</span> to create delegated
            keys with spending limits.
          </p>
        </div>

        <button
          onClick={() => {
            clear();
          }}
          className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw size={13} />
          Reset (deploy new account)
        </button>
      </div>
    );
  }

  // ── Deploy flow ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Create Protocol Account</h1>
        <p className="text-muted text-sm mt-1">
          Deploy your personal{" "}
          <span className="text-stark font-medium">ShieldedAccount</span> — a
          Cairo smart contract account with session keys and paymaster integration.
        </p>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {FEATURES.map(({ icon: Icon, title, desc, color, bg }) => (
          <div
            key={title}
            className="p-4 rounded-xl bg-surface border border-border space-y-2"
          >
            <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
              <Icon size={16} className={color} />
            </div>
            <p className="text-sm font-medium text-white">{title}</p>
            <p className="text-xs text-muted leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Config warning */}
      {isClassHashMissing && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-yellow-300 font-medium">Class hash not configured</p>
            <p className="text-muted mt-1">
              Declare the ShieldedAccount contract first:
            </p>
            <pre className="mt-2 p-2 rounded bg-black/40 text-xs text-muted overflow-x-auto">
              {`cd contracts\nscarb build\nsncast --account devnet declare \\\n  --contract-name ShieldedAccount`}
            </pre>
            <p className="text-muted mt-2">
              Then set{" "}
              <code className="text-yellow-300">VITE_SHIELDED_ACCOUNT_CLASS_HASH</code>{" "}
              in <code className="text-yellow-300">frontend/.env</code>.
            </p>
          </div>
        </div>
      )}

      {/* Wallet required */}
      {!account && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-surface border border-border">
          <UserCheck size={16} className="text-muted flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted">
            Connect a wallet first (top-right button). Your signer account will
            pay for the deployment — the ShieldedAccount becomes your protocol
            account afterwards.
          </p>
        </div>
      )}

      {/* Deployment info box */}
      {account && !isClassHashMissing && (
        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
          <Row label="Signer (pays gas)" value={address ?? "—"} mono />
          <Row
            label="Contract"
            value="ShieldedAccount (Cairo 2)"
            sub="constructor(owner_public_key, vault_address)"
          />
          <Row
            label="Vault linked"
            value={CONTRACTS.VAULT ? shortAddr(CONTRACTS.VAULT) : "Not set (set VITE_VAULT_ADDRESS)"}
            mono
          />
          <Row
            label="Key storage"
            value="sessionStorage (cleared on tab close)"
          />
        </div>
      )}

      {/* In-progress / error state */}
      {isDeploying && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-stark/10 border border-stark/30">
          <Loader2 size={18} className="text-stark animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-white">
              {STATUS_LABELS[status]}
            </p>
            {txHash && (
              <p className="text-xs text-muted mt-0.5 font-mono truncate">
                tx: {shortAddr(txHash)}
              </p>
            )}
          </div>
        </div>
      )}

      {status === "error" && error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-red-300 font-medium">Deployment failed</p>
            <p className="text-muted mt-1 font-mono text-xs break-all">{error}</p>
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleDeploy}
          disabled={!account || isClassHashMissing || isDeploying}
          className={clsx(
            "flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-sm transition-all",
            account && !isClassHashMissing && !isDeploying
              ? "bg-stark hover:bg-stark/90 text-white"
              : "bg-surface text-muted cursor-not-allowed border border-border",
          )}
        >
          {isDeploying ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Deploying…
            </>
          ) : (
            <>
              <ShieldCheck size={15} />
              Deploy ShieldedAccount
              <ArrowRight size={14} />
            </>
          )}
        </button>

        <a
          href="https://github.com/deegalabs/hackathon-starknet-shielded-btc-collateral/blob/main/contracts/src/accounts/shielded_account.cairo"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors"
        >
          <ExternalLink size={12} />
          View contract source
        </a>
      </div>

      {/* Security note */}
      <div className="p-4 rounded-xl bg-surface border border-border">
        <p className="text-xs text-muted leading-relaxed">
          <span className="text-white font-medium">Privacy architecture:</span>{" "}
          The generated Stark private key never leaves your browser. Session keys
          derived from it have scoped permissions (contract, spending limit, expiry)
          so even if compromised they cannot drain the full vault. In production,
          this key should be managed via a passkey or hardware wallet.
        </p>
      </div>
    </div>
  );
}

// ── Utility row component ────────────────────────────────────────────────────

function Row({
  label,
  value,
  mono = false,
  sub,
  copyable = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  sub?: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <span className="text-sm text-muted flex-shrink-0 pt-0.5">{label}</span>
      <div className="text-right min-w-0">
        <button
          onClick={copyable ? copy : undefined}
          className={clsx(
            "text-sm text-white break-all",
            mono && "font-mono text-xs",
            copyable && "hover:text-stark transition-colors cursor-pointer",
          )}
        >
          {copied ? "Copied!" : value}
        </button>
        {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
