import { Wallet, LogOut, Loader2 } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { shortAddr } from "@/lib/config";

export function WalletButton() {
  const { isConnected, isConnecting, address, walletName, connect, disconnect } =
    useWallet();

  if (isConnecting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 border border-border text-muted text-sm"
      >
        <Loader2 size={15} className="animate-spin" />
        Connecting...
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border">
          <div className="w-2 h-2 rounded-full bg-privacy animate-pulse-slow" />
          <span className="text-sm text-white font-mono">{shortAddr(address)}</span>
          {walletName && (
            <span className="text-xs text-muted hidden sm:block">{walletName}</span>
          )}
        </div>
        <button
          onClick={disconnect}
          className="p-2 rounded-lg text-muted hover:text-white hover:bg-surface-2 border border-border transition-colors"
          title="Disconnect wallet"
        >
          <LogOut size={15} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stark text-white text-sm font-medium hover:bg-stark-dim transition-colors"
    >
      <Wallet size={15} />
      Connect Wallet
    </button>
  );
}
