import { useEffect } from "react";
import { CheckCircle, XCircle, Loader2, X, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import type { TxState } from "@/hooks/useVault";
import { NETWORK } from "@/lib/config";

function starkscanUrl(hash: string): string | null {
  if (NETWORK === "mainnet") return `https://starkscan.co/tx/${hash}`;
  if (NETWORK === "sepolia") return `https://sepolia.starkscan.co/tx/${hash}`;
  return null;
}

interface TxToastProps {
  tx: TxState;
  onClose: () => void;
}

export function TxToast({ tx, onClose }: TxToastProps) {
  useEffect(() => {
    if (tx.status !== "success") return;
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [tx.status, onClose]);

  if (tx.status === "idle") return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
      <div
        className={clsx(
          "flex items-start gap-3 px-4 py-3 rounded-xl border shadow-xl max-w-sm",
          tx.status === "pending" && "bg-surface-2 border-border",
          tx.status === "success" && "bg-privacy/10 border-privacy/40",
          tx.status === "error" && "bg-red-500/10 border-red-500/40",
        )}
      >
        <div className="flex-shrink-0 mt-0.5">
          {tx.status === "pending" && (
            <Loader2 size={18} className="text-stark animate-spin" />
          )}
          {tx.status === "success" && (
            <CheckCircle size={18} className="text-privacy" />
          )}
          {tx.status === "error" && (
            <XCircle size={18} className="text-red-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium">{tx.message}</p>
          {tx.hash && (() => {
            const url = starkscanUrl(tx.hash);
            return url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-stark hover:text-white font-mono mt-0.5 transition-colors"
                title={tx.hash}
              >
                Tx: {tx.hash.slice(0, 18)}…
                <ExternalLink size={10} className="flex-shrink-0" />
              </a>
            ) : (
              <p className="text-xs text-muted font-mono mt-0.5 truncate" title={tx.hash}>
                Tx: {tx.hash.slice(0, 18)}…
              </p>
            );
          })()}
        </div>
        {tx.status !== "pending" && (
          <button
            onClick={onClose}
            className="flex-shrink-0 text-muted hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
