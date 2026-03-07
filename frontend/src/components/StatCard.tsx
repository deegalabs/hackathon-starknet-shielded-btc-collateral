import { type LucideIcon } from "lucide-react";
import { clsx } from "clsx";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  accent?: "btc" | "stark" | "privacy" | "default";
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
  className,
}: StatCardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border p-5 transition-all hover:border-opacity-60",
        accentStyles[accent],
        className,
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-muted">{title}</p>
        <Icon size={18} className={iconStyles[accent]} />
      </div>
      <p className="text-2xl font-semibold text-white tracking-tight">{value}</p>
      {subtitle && <p className="text-xs text-muted mt-1">{subtitle}</p>}
    </div>
  );
}
