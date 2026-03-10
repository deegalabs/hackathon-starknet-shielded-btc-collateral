import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";

interface RefreshButtonProps {
  onClick: () => void;
  loading?: boolean;
}

export function RefreshButton({ onClick, loading = false }: RefreshButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="p-2 rounded-lg text-muted hover:text-white hover:bg-surface-2 border border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title="Refresh"
    >
      <RefreshCw size={15} className={clsx(loading && "animate-spin")} />
    </button>
  );
}
