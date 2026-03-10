import { type LucideIcon } from "lucide-react";
import { clsx } from "clsx";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  accent?: "btc" | "stark" | "privacy" | "default";
  loading?: boolean;
  className?: string;
}

const accentStyles = {
  btc: "border-btc/30 bg-btc/5",
  stark: "border-stark/30 bg-stark/5",
  privacy: "border-privacy/30 bg-privacy/5",
  default: "border-border bg-surface",
};

const iconStyles = {
  btc: "text-btc",
  stark: "text-stark",
  privacy: "text-privacy",
  default: "text-muted",
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = "default",
  loading = false,
  className,
}: StatCardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border p-4 transition-all hover:border-opacity-70 flex flex-col justify-between min-h-[96px]",
        accentStyles[accent],
        className,
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wide">{title}</p>
        <Icon size={16} className={clsx(iconStyles[accent], "flex-shrink-0", loading && "opacity-40")} />
      </div>
      <div>
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-5 w-2/3 rounded-md bg-white/10" />
            <div className="h-3 w-1/2 rounded-md bg-white/5" />
          </div>
        ) : (
          <>
            <p className="text-xl font-bold text-white tracking-tight leading-tight truncate">{value}</p>
            {subtitle && <p className="text-xs text-muted mt-1 leading-snug">{subtitle}</p>}
          </>
        )}
      </div>
    </div>
  );
}
