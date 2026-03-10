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
  WifiOff,
  Droplets,
} from "lucide-react";
import { clsx } from "clsx";
import { useWallet } from "@/context/WalletContext";
import { useShieldedAccount } from "@/hooks/useShieldedAccount";
import { SHIELDED_ACCOUNT_CLASS_HASH, CONTRACTS, NETWORK, RPC_URL, shortAddr } from "@/lib/config";
import { PageShell } from "@/components/PageShell";

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
  const { account, address, provider, connectMethod, switchToShieldedAccount } = useWallet();
  const { status, error, txHash, info, deploy, clear } = useShieldedAccount();
  const [showPrivKey, setShowPrivKey] = useState(false);

  const isClassHashMissing = !SHIELDED_ACCOUNT_CLASS_HASH;
  const isDeploying =
    status === "generating_keys" ||
    status === "deploying" ||
    status === "confirming";

  const [faucetStatus, setFaucetStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleFaucet() {
    if (!address || NETWORK !== "devnet") return;
    setFaucetStatus("loading");
    try {
      // Mint 0.5 ETH + 0.5 STRK via devnet faucet
      await Promise.all([
        fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "devnet_mint", params: { address, amount: 500000000000000000, unit: "WEI" }, id: 1 }),
        }),
        fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "devnet_mint", params: { address, amount: 500000000000000000, unit: "FRI" }, id: 2 }),
        }),
      ]);
      setFaucetStatus("done");
    } catch {
      setFaucetStatus("error");
    }
  }

  // Web wallet (email/Argent Web) uses Argent's own RPC — it cannot reach
  // localhost:5050. The ShieldedAccount class is only declared on the local
  // devnet, so deploying via web wallet will always fail.
  const isWebWalletOnDevnet =
    connectMethod === "email" && NETWORK === "devnet";

  const canDeploy =
    !!account && !isClassHashMissing && !isDeploying && !isWebWalletOnDevnet;

  async function handleDeploy() {
    if (!account || isWebWalletOnDevnet) return;
    await deploy(account, provider, (shieldedAcc, addr) => {
      switchToShieldedAccount(shieldedAcc, addr);
    });
  }

  // ── Already deployed ─────────────────────────────────────────────────────
  if (info && status !== "error") {
    return (
      <PageShell
        title="My ShieldedAccount"
        subtitle="Your personal Cairo smart account for the Shielded BTC protocol."
      >

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
      </PageShell>
    );
  }

  // ── Deploy flow ──────────────────────────────────────────────────────────
  return (
    <PageShell
      title="Create Protocol Account"
      subtitle="Deploy your personal ShieldedAccount — a Cairo smart contract account with session keys and paymaster integration."
    >

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

      {/* Web wallet + devnet incompatibility warning */}
      {isWebWalletOnDevnet && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <WifiOff size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-red-300 font-medium">
              Argent Web Wallet cannot access the local devnet
            </p>
            <p className="text-muted mt-1">
              The email wallet routes transactions through Argent&apos;s
              infrastructure (Sepolia/mainnet), but the{" "}
              <code className="text-red-300">ShieldedAccount</code> contract is
              only declared on <code className="text-red-300">localhost:5050</code>.
            </p>
            <p className="text-muted mt-2">
              For the local devnet demo, use the{" "}
              <span className="text-white font-medium">Argent X</span> or{" "}
              <span className="text-white font-medium">Braavos</span> extension
              configured with network{" "}
              <code className="text-white">http://localhost:5050</code>.
            </p>
          </div>
        </div>
      )}

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

      {/* Devnet faucet — only shown on devnet when wallet is connected */}
      {account && NETWORK === "devnet" && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-surface border border-border">
          <div className="flex items-center gap-3">
            <Droplets size={16} className="text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-white">Devnet Faucet</p>
              <p className="text-xs text-muted mt-0.5">
                Mint 0.5 ETH + 0.5 STRK to pay for deploy gas
              </p>
            </div>
          </div>
          <button
            onClick={handleFaucet}
            disabled={faucetStatus === "loading"}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0",
              faucetStatus === "done"
                ? "bg-privacy/20 text-privacy border border-privacy/30"
                : faucetStatus === "error"
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30",
            )}
          >
            {faucetStatus === "loading" ? (
              <><Loader2 size={11} className="animate-spin" /> Mintando…</>
            ) : faucetStatus === "done" ? (
              <><CheckCircle2 size={11} /> Funded!</>
            ) : faucetStatus === "error" ? (
              "Erro"
            ) : (
              <><Droplets size={11} /> Fund Account</>
            )}
          </button>
        </div>
      )}

      {/* CTA */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleDeploy}
          disabled={!canDeploy}
          className={clsx(
            "flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-sm transition-all",
            canDeploy
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
    </PageShell>
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
