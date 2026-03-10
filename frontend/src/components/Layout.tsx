import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Vault,
  Zap,
  KeyRound,
  UserCheck,
  ExternalLink,
  TrendingUp,
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

const SETTINGS_NAV = [
  { to: "/account", icon: UserCheck, label: "My Account" },
  { to: "/session-keys", icon: KeyRound, label: "Session Keys" },
];

const ECOSYSTEM_NAV = [
  { to: "/lending", icon: TrendingUp, label: "DeFi Integrations" },
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
          "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all",
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/50 select-none">
      {children}
    </p>
  );
}

/** Inline SVG logo — shield with ₿ inside, gradient orange→purple */
function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f7931a" />
          <stop offset="55%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      {/* Shield shape */}
      <path
        d="M17 2L4 7.5V17c0 7.18 5.58 13.9 13 15.5C24.42 30.9 30 24.18 30 17V7.5L17 2Z"
        fill="url(#logoGrad)"
        opacity="0.15"
      />
      <path
        d="M17 2L4 7.5V17c0 7.18 5.58 13.9 13 15.5C24.42 30.9 30 24.18 30 17V7.5L17 2Z"
        stroke="url(#logoGrad)"
        strokeWidth="1.5"
        fill="none"
      />
      {/* ₿ symbol */}
      <text
        x="17"
        y="22"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="url(#logoGrad)"
      >
        ₿
      </text>
    </svg>
  );
}

export function Layout() {
  const { connectMethod } = useWallet();
  return (
    <div className="min-h-screen bg-background text-white flex">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-border flex-col hidden md:flex">

        {/* Logo */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="leading-tight">
              <p className="text-[13px] font-bold text-white tracking-tight">
                Shielded<span className="text-btc">BTC</span>
              </p>
              <p className="text-[10px] text-muted tracking-wide">Collateral Protocol</p>
            </div>
          </div>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">

          {/* YOUR SHIELD */}
          <div>
            <SectionLabel>Your Shield</SectionLabel>
            <div className="space-y-0.5">
              {CORE_NAV.map(({ to, icon, label, end }) => (
                <NavItem key={to} to={to} icon={icon} label={label} end={end} />
              ))}
            </div>
          </div>

          {/* ACCOUNT */}
          <div>
            <SectionLabel>Account</SectionLabel>
            <div className="space-y-0.5">
              {SETTINGS_NAV.map(({ to, icon, label }) => (
                <NavItem key={to} to={to} icon={icon} label={label} />
              ))}
            </div>
          </div>

        </nav>

        {/* ECOSYSTEM — bottom, separated */}
        <div className="px-3 pb-3 border-t border-border/60 pt-3">
          <SectionLabel>Ecosystem</SectionLabel>
          <div className="space-y-0.5 mb-3">
            {ECOSYSTEM_NAV.map(({ to, icon, label }) => (
              <NavItem key={to} to={to} icon={icon} label={label} badge="DEMO" />
            ))}
          </div>
          <p className="px-3 text-[10px] text-muted/40 leading-relaxed mb-3">
            3rd-party protocols using{" "}
            <span className="font-mono">prove_collateral</span>
          </p>

          {/* ShieldedAccount badge */}
          {connectMethod === "shielded" && (
            <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-privacy/10 border border-privacy/30">
              <span className="w-1.5 h-1.5 rounded-full bg-privacy animate-pulse" />
              <span className="text-[11px] text-privacy font-medium">ShieldedAccount active</span>
            </div>
          )}

          {/* Network + source */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2 border border-border">
            <div className="flex items-center gap-2">
              <div
                className={clsx(
                  "w-1.5 h-1.5 rounded-full",
                  NETWORK === "mainnet" ? "bg-btc" : "bg-privacy animate-pulse",
                )}
              />
              <span className="text-[11px] text-muted">
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
          <div className="flex items-center gap-2 md:hidden">
            <Logo />
            <span className="text-sm font-bold">Shielded<span className="text-btc">BTC</span></span>
          </div>
          <div className="hidden md:block" />
          <WalletButton />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
