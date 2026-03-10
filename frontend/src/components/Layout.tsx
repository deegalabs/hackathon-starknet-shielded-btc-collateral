import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Vault,
  TrendingUp,
  Zap,
  KeyRound,
  Shield,
  UserCheck,
  ExternalLink,
  Layers,
} from "lucide-react";
import { clsx } from "clsx";
import { WalletButton } from "./WalletButton";
import { useWallet } from "@/context/WalletContext";
import { NETWORK, NETWORK_LABELS } from "@/lib/config";

const CORE_NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/vault", icon: Vault, label: "Vault" },
  { to: "/paymaster", icon: Zap, label: "Paymaster" },
];

const ECOSYSTEM_NAV = [
  { to: "/lending", icon: TrendingUp, label: "DeFi Integrations" },
];

const SETTINGS_NAV = [
  { to: "/account", icon: UserCheck, label: "My Account" },
  { to: "/session-keys", icon: KeyRound, label: "Session Keys" },
];

function NavItem({
  to,
  icon: Icon,
  label,
  end,
  badge,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
  badge?: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all group",
          isActive
            ? "bg-stark/15 text-white font-medium border border-stark/20"
            : "text-muted hover:text-white hover:bg-surface-2",
        )
      }
    >
      <span className="flex items-center gap-3">
        <Icon size={16} />
        {label}
      </span>
      {badge && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-btc/15 text-btc font-medium">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

export function Layout() {
  const { connectMethod } = useWallet();
  return (
    <div className="min-h-screen bg-background text-white flex">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border flex-col hidden md:flex">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-btc via-stark to-privacy flex items-center justify-center shadow-lg">
              <Shield size={17} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight tracking-tight">
                Shielded BTC
              </p>
              <p className="text-[11px] text-muted">Collateral Protocol</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">

          {/* Zone 1 — Your Shield */}
          <div>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
              Your Shield
            </p>
            <div className="space-y-0.5">
              {CORE_NAV.map(({ to, icon, label, end }) => (
                <NavItem key={to} to={to} icon={icon} label={label} end={end} />
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border/50" />

          {/* Zone 2 — Ecosystem */}
          <div>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
              Ecosystem
            </p>
            <div className="space-y-0.5">
              {ECOSYSTEM_NAV.map(({ to, icon, label }) => (
                <NavItem key={to} to={to} icon={icon} label={label} badge="DEMO" />
              ))}
            </div>
            <p className="px-3 mt-2 text-[10px] text-muted/50 leading-relaxed">
              3rd-party protocols using{" "}
              <span className="font-mono">prove_collateral</span>
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-border/50" />

          {/* Zone 3 — Settings */}
          <div>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
              Account
            </p>
            <div className="space-y-0.5">
              {SETTINGS_NAV.map(({ to, icon, label }) => (
                <NavItem key={to} to={to} icon={icon} label={label} />
              ))}
            </div>
          </div>

        </nav>

        {/* Footer */}
        <div className="px-4 pb-4 border-t border-border space-y-2 pt-3">
          {/* ShieldedAccount active badge */}
          {connectMethod === "shielded" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-privacy/10 border border-privacy/30">
              <Shield size={12} className="text-privacy" />
              <span className="text-xs text-privacy font-medium">
                ShieldedAccount active
              </span>
            </div>
          )}

          {/* Network + links */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2 border border-border">
            <div className="flex items-center gap-2">
              <div
                className={clsx(
                  "w-2 h-2 rounded-full",
                  NETWORK === "mainnet" ? "bg-btc" : "bg-privacy animate-pulse",
                )}
              />
              <span className="text-xs text-muted">
                {NETWORK_LABELS[NETWORK] ?? NETWORK}
              </span>
            </div>
            <a
              href="https://github.com/deegalabs/hackathon-starknet-shielded-btc-collateral"
              target="_blank"
              rel="noopener noreferrer"
              title="View source"
              className="text-muted hover:text-white transition-colors"
            >
              <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-6 flex-shrink-0">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 md:hidden">
            <Shield size={18} className="text-btc" />
            <span className="text-sm font-semibold">Shielded BTC</span>
          </div>
          {/* Desktop breadcrumb placeholder */}
          <div className="hidden md:block" />
          <WalletButton />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
