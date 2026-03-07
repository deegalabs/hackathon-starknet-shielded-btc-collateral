import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Vault,
  TrendingUp,
  Zap,
  KeyRound,
  Shield,
  ExternalLink,
} from "lucide-react";
import { clsx } from "clsx";
import { WalletButton } from "./WalletButton";
import { NETWORK, NETWORK_LABELS } from "@/lib/config";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/vault", icon: Vault, label: "Vault" },
  { to: "/lending", icon: TrendingUp, label: "Lending" },
  { to: "/paymaster", icon: Zap, label: "Paymaster" },
  { to: "/session-keys", icon: KeyRound, label: "Session Keys" },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-background text-white flex">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border flex flex-col hidden md:flex">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-btc to-stark flex items-center justify-center">
              <Shield size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">
                Shielded BTC
              </p>
              <p className="text-xs text-muted">Collateral Protocol</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                  isActive
                    ? "bg-stark/15 text-white font-medium border border-stark/20"
                    : "text-muted hover:text-white hover:bg-surface-2",
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Network badge */}
        <div className="px-4 py-4 border-t border-border">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border">
            <div
              className={clsx(
                "w-2 h-2 rounded-full",
                NETWORK === "mainnet" ? "bg-btc" : "bg-privacy",
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
            className="flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs text-muted hover:text-white transition-colors"
          >
            <ExternalLink size={11} />
            View source
          </a>
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
