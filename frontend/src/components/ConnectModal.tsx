import { X, Mail, Wallet, ExternalLink, Loader2 } from "lucide-react";
import { useWallet } from "@/context/WalletContext";

interface ConnectModalProps {
  onClose: () => void;
}

export function ConnectModal({ onClose }: ConnectModalProps) {
  const { connectExtension, connectEmail, isConnecting } = useWallet();

  const handleEmail = async () => {
    await connectEmail();
    onClose();
  };

  const handleExtension = async () => {
    await connectExtension();
    onClose();
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-white">Connect a Wallet</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-surface-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* Email / Web Wallet — primary option for BTC users */}
          <button
            onClick={handleEmail}
            disabled={isConnecting}
            className="w-full flex items-center gap-4 px-4 py-4 rounded-xl border border-stark/40 bg-stark/10 hover:bg-stark/20 hover:border-stark/60 transition-all group disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-stark/20 flex items-center justify-center flex-shrink-0">
              {isConnecting ? (
                <Loader2 size={20} className="text-stark animate-spin" />
              ) : (
                <Mail size={20} className="text-stark" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">Continue with Email</p>
              <p className="text-xs text-muted mt-0.5">
                Argent Web Wallet · No extension needed
              </p>
            </div>
            <span className="text-xs bg-privacy/20 text-privacy px-2 py-0.5 rounded-full flex-shrink-0">
              Recommended
            </span>
          </button>

          {/* Explanation for BTC users */}
          <p className="text-xs text-muted px-1 leading-relaxed">
            New to Starknet? Use your email to create a{" "}
            <span className="text-white">smart contract account</span> — Starknet's
            native Account Abstraction. No seed phrase required to get started.
          </p>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted">or use a browser extension</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Extension wallets */}
          <button
            onClick={handleExtension}
            disabled={isConnecting}
            className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl border border-border bg-surface-2 hover:border-border-bright hover:bg-surface transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-border flex items-center justify-center flex-shrink-0">
              <Wallet size={18} className="text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Browser Wallet</p>
              <p className="text-xs text-muted mt-0.5">
                Argent X, Braavos, OKX Wallet
              </p>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex items-center justify-center gap-1">
          <p className="text-xs text-muted">
            New to Starknet?
          </p>
          <a
            href="https://www.argent.xyz/argent-x/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-stark hover:text-white transition-colors flex items-center gap-1"
          >
            Get Argent X <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
}
