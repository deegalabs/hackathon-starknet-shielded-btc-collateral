import { Link } from "react-router-dom";
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  KeyRound,
  Lock,
  ExternalLink,
  Bitcoin,
  Eye,
  EyeOff,
  GitBranch,
} from "lucide-react";

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="landingLogoGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f7931a" />
          <stop offset="55%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <path
        d="M17 2L4 7.5V17c0 7.18 5.58 13.9 13 15.5C24.42 30.9 30 24.18 30 17V7.5L17 2Z"
        fill="url(#landingLogoGrad)"
        opacity="0.15"
      />
      <path
        d="M17 2L4 7.5V17c0 7.18 5.58 13.9 13 15.5C24.42 30.9 30 24.18 30 17V7.5L17 2Z"
        stroke="url(#landingLogoGrad)"
        strokeWidth="1.5"
        fill="none"
      />
      <text
        x="17" y="22"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="url(#landingLogoGrad)"
      >
        ₿
      </text>
    </svg>
  );
}

const FEATURES = [
  {
    icon: Lock,
    color: "btc",
    title: "Private Vault",
    desc: "Deposit BTC using a Poseidon commitment — only the hash goes on-chain. Nobody can read your balance.",
  },
  {
    icon: Zap,
    color: "stark",
    title: "Gas Sponsorship",
    desc: "Eligible depositors get their transaction fees paid. No STRK needed to interact with the protocol.",
  },
  {
    icon: KeyRound,
    color: "privacy",
    title: "Session Keys (SNIP-9)",
    desc: "Delegate limited access to DApps with spending limits and expiry. Your main key never leaves your wallet.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Deposit BTC",
    desc: "Lock your WBTC in the vault. A Poseidon(amount, secret) commitment is recorded — no plaintext on-chain.",
    color: "text-btc",
    border: "border-btc/30",
    bg: "bg-btc/5",
  },
  {
    step: "02",
    title: "Prove Solvency",
    desc: "DeFi protocols call prove_collateral(you, threshold) — they verify you're solvent without learning your balance.",
    color: "text-stark",
    border: "border-stark/30",
    bg: "bg-stark/5",
  },
  {
    step: "03",
    title: "Access DeFi",
    desc: "Borrow, use gasless transactions, and delegate session keys — all while your exact balance stays private.",
    color: "text-privacy",
    border: "border-privacy/30",
    bg: "bg-privacy/5",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-white">

      {/* Nav */}
      <header className="border-b border-border/60 sticky top-0 z-50 bg-background/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-[15px] font-bold tracking-tight">
              Shielded<span className="text-btc">BTC</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/deegalabs/hackathon-starknet-shielded-btc-collateral"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors"
            >
              <GitBranch size={14} />
              GitHub
            </a>
            <Link
              to="/app"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stark text-white text-sm font-medium hover:bg-stark-dim transition-colors"
            >
              Launch App
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-stark/5 blur-3xl" />
          <div className="absolute top-20 left-1/4 w-[300px] h-[300px] rounded-full bg-btc/5 blur-3xl" />
          <div className="absolute top-10 right-1/4 w-[250px] h-[250px] rounded-full bg-privacy/5 blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-stark/30 bg-stark/10 text-stark text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-stark animate-pulse" />
            Built on Starknet · Cairo 2 · Account Abstraction
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            BTC Collateral.
            <br />
            <span className="bg-gradient-to-r from-btc via-stark to-privacy bg-clip-text text-transparent">
              Without Revealing Your Balance.
            </span>
          </h1>

          <p className="text-lg text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
            Lock BTC behind a{" "}
            <span className="text-white font-mono text-sm">Poseidon</span> commitment.
            Access DeFi lending, gasless transactions, and session keys —
            while your deposit amount stays{" "}
            <span className="text-privacy font-medium">completely private</span>.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/app"
              className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-stark text-white font-semibold text-sm hover:bg-stark-dim transition-all shadow-lg shadow-stark/20"
            >
              Launch App
              <ArrowRight size={16} />
            </Link>
            <a
              href="https://github.com/deegalabs/hackathon-starknet-shielded-btc-collateral"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-8 py-3.5 rounded-xl border border-border bg-surface text-muted hover:text-white hover:border-border-bright transition-all text-sm font-medium"
            >
              <ExternalLink size={14} />
              View Source
            </a>
          </div>
        </div>
      </section>

      {/* Problem vs Solution */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Problem */}
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-7">
            <div className="flex items-center gap-2 mb-4">
              <Eye size={18} className="text-red-400" />
              <p className="text-sm font-semibold text-red-400 uppercase tracking-wider">
                Traditional Lending
              </p>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">
              Your balance is public
            </h3>
            <ul className="space-y-2.5 text-sm text-muted">
              {[
                "Deposit amount stored as plaintext on-chain",
                "Anyone can track your collateral position",
                "Protocols know your exact solvency threshold",
                "Wallet address links to real-world identity",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 flex-shrink-0">✗</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Solution */}
          <div className="rounded-2xl border border-privacy/20 bg-privacy/5 p-7">
            <div className="flex items-center gap-2 mb-4">
              <EyeOff size={18} className="text-privacy" />
              <p className="text-sm font-semibold text-privacy uppercase tracking-wider">
                ShieldedBTC
              </p>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">
              Only a hash goes on-chain
            </h3>
            <ul className="space-y-2.5 text-sm text-muted">
              {[
                "Poseidon(amount, secret) commitment — zero plaintext",
                "Protocols verify solvency without reading balance",
                "Nullifier prevents double-spend without exposing data",
                "Session keys limit DApp access with spending caps",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="text-privacy mt-0.5 flex-shrink-0">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold text-muted/60 uppercase tracking-widest mb-3">
            How it works
          </p>
          <h2 className="text-3xl font-bold text-white">
            Three steps to private DeFi
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map(({ step, title, desc, color, border, bg }) => (
            <div key={step} className={`rounded-2xl border p-7 ${border} ${bg}`}>
              <p className={`text-4xl font-black mb-4 ${color} opacity-40`}>{step}</p>
              <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
              <p className="text-sm text-muted leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold text-muted/60 uppercase tracking-widest mb-3">
            Protocol components
          </p>
          <h2 className="text-3xl font-bold text-white">
            Everything you need, nothing exposed
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {FEATURES.map(({ icon: Icon, color, title, desc }) => {
            const styles: Record<string, { icon: string; bg: string; border: string }> = {
              btc:     { icon: "text-btc",     bg: "bg-btc/10",     border: "border-btc/20" },
              stark:   { icon: "text-stark",   bg: "bg-stark/10",   border: "border-stark/20" },
              privacy: { icon: "text-privacy", bg: "bg-privacy/10", border: "border-privacy/20" },
            };
            const s = styles[color];
            return (
              <div
                key={title}
                className="rounded-2xl border border-border bg-surface p-7 hover:border-border-bright transition-colors"
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-5 ${s.bg} border ${s.border}`}>
                  <Icon size={20} className={s.icon} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-muted leading-relaxed">{desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Tech stack strip */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="rounded-2xl border border-border bg-surface p-8">
          <p className="text-xs font-semibold text-muted/60 uppercase tracking-widest text-center mb-8">
            Technical Architecture
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {[
              { label: "Smart Contracts", value: "Cairo 2", sub: "Starknet-native" },
              { label: "Privacy Primitive", value: "Poseidon Hash", sub: "ZK-friendly" },
              { label: "Account Model", value: "SNIP-6 / SNIP-9", sub: "Account Abstraction" },
              { label: "Verification", value: "prove_collateral", sub: "On-chain proof" },
            ].map(({ label, value, sub }) => (
              <div key={label}>
                <p className="text-xs text-muted mb-1">{label}</p>
                <p className="text-sm font-bold text-white font-mono">{value}</p>
                <p className="text-[11px] text-muted/60 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <div className="relative rounded-2xl border border-stark/20 bg-stark/5 p-12 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-stark/8 blur-3xl rounded-full" />
          </div>
          <div className="relative">
            <ShieldCheck size={40} className="text-stark mx-auto mb-5 opacity-80" />
            <h2 className="text-3xl font-extrabold text-white mb-3">
              Ready to shield your BTC?
            </h2>
            <p className="text-muted mb-8 max-w-md mx-auto text-sm leading-relaxed">
              Connect your Argent X or Braavos wallet and deposit in under 60 seconds.
              No centralized custody. No balance exposure.
            </p>
            <Link
              to="/app"
              className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-stark text-white font-semibold hover:bg-stark-dim transition-all shadow-xl shadow-stark/20 text-sm"
            >
              <Bitcoin size={16} />
              Launch App
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <p className="text-sm font-bold">Shielded<span className="text-btc">BTC</span></p>
              <p className="text-[11px] text-muted">Privacy-preserving BTC collateral on Starknet</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted">
            <a
              href="https://github.com/deegalabs/hackathon-starknet-shielded-btc-collateral"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <ExternalLink size={11} />
              Open Source
            </a>
            <span>·</span>
            <span>Starknet Hackathon 2025</span>
            <span>·</span>
            <a
              href="https://www.starknet.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Starknet
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
