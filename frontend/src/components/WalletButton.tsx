import { useState } from "react";
import { Wallet, LogOut, Loader2, Mail } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { ConnectModal } from "./ConnectModal";
import { shortAddr } from "@/lib/config";

export function WalletButton() {
  const { isConnected, isConnecting, address, walletName, connectMethod, disconnect } =
    useWallet();
  const [showModal, setShowModal] = useState(false);

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
    const isEmail = connectMethod === "email";
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border">
          {isEmail ? (
            <Mail size={13} className="text-stark flex-shrink-0" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-privacy animate-pulse-slow flex-shrink-0" />
          )}
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
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stark text-white text-sm font-medium hover:bg-stark-dim transition-colors"
      >
        <Wallet size={15} />
        Connect Wallet
      </button>

      {showModal && (
        <ConnectModal onClose={() => setShowModal(false)} />
      )}
    </>
  );
}
