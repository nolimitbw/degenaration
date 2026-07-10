"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import Ticker2 from "./Ticker2";
import Search from "./Search";
import { useIsAdmin } from "@/lib/admin";

// Load the wallet button (and its heavy Privy bundle) only on the client, after paint.
// Keeps ~800KB of signing code off the critical path so data pages open instantly.
const WalletButton = dynamic(() => import("./WalletButton"), {
  ssr: false,
  loading: () => <div className="h-8 w-28 animate-pulse rounded-md bg-edge/40" />
});

// Primary nav — always visible on desktop (Trojan-style top bar).
const PRIMARY = [
  { href: "/trenches", label: "Trenches" },
  { href: "/explorer", label: "Explorer" },
  { href: "/holdings", label: "Holdings" },
  { href: "/tracker", label: "Tracker" },
  { href: "/alpha", label: "Alpha" }
];

// Secondary surfaces grouped under a Tools dropdown.
const TOOLS = [
  { href: "/terminal", label: "Trade Terminal", desc: "Buy & sell any token instantly", icon: "▤" },
  { href: "/orders", label: "Limit Orders", desc: "Auto buy/sell at your price", icon: "◪" },
  { href: "/calls", label: "Discord Calls", desc: "Copy trades from call groups", icon: "◎" },
  { href: "/watchlist", label: "Watchlist", desc: "Your starred tokens", icon: "☆" },
  { href: "/alerts", label: "Alerts", desc: "Price & wallet notifications", icon: "◔" },
  { href: "/dashboard", label: "Portfolio", desc: "PnL and trade history", icon: "◱" },
  { href: "/apply", label: "List your server", desc: "Add your call group", icon: "▣" }
];

const ADMIN_TOOLS = [
  { href: "/admin", label: "Admin", desc: "Owner console", icon: "⚙" },
  { href: "/admin/channels", label: "Call channels", desc: "Approve Discord channels", icon: "◎" },
  { href: "/admin/commissions", label: "Commissions", desc: "Platform fee ledger", icon: "$" }
];

const SOL_MINT = "So11111111111111111111111111111111111111112";

function SolPrice() {
  const [px, setPx] = useState<number | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`/api/price?mint=${SOL_MINT}`)
        .then((r) => r.json())
        .then((d) => setPx(d?.priceUsd ?? null))
        .catch(() => {});
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-dim">
      <span className="text-toxic">◎ SOL</span>
      <span className="text-ink">{px != null ? `$${px.toFixed(2)}` : "…"}</span>
    </span>
  );
}

function ToolsMenu({ items, path }: { items: typeof TOOLS; path: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const active = items.some((i) => path === i.href);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
          active || open ? "text-toxic" : "text-dim hover:text-ink"
        }`}
      >
        Tools <span className={`text-[10px] transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-edge bg-panel p-1.5 shadow-card">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={() => setOpen(false)}
              className={`flex items-start gap-3 rounded-md px-3 py-2.5 transition hover:bg-edge/50 ${
                path === i.href ? "bg-toxic/10" : ""
              }`}
            >
              <span className={`mt-0.5 text-base ${path === i.href ? "text-toxic" : "text-dim"}`}>{i.icon}</span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${path === i.href ? "text-toxic" : "text-ink"}`}>{i.label}</span>
                <span className="block truncate text-[11px] text-dim">{i.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact link for the bottom status bar; all route to real pages.
function BottomLink({ href, label, icon, active }: { href: string; label: string; icon: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium transition ${
        active ? "text-toxic" : "text-dim hover:text-ink"
      }`}
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { admin } = useIsAdmin();
  const tools = admin ? [...TOOLS, ...ADMIN_TOOLS] : TOOLS;
  const allNav = [...PRIMARY, ...tools];

  return (
    <div className="flex min-h-screen flex-col">
      {/* top nav */}
      <header className="sticky top-0 z-40 border-b border-edge glass">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <button onClick={() => setMobileOpen(true)} className="text-lg text-dim lg:hidden" aria-label="Open menu">☰</button>
          <Link href="/trenches" className="shrink-0 text-lg font-bold tracking-tight">
            DEGEN<span className="text-toxic text-glow-toxic">ARATION</span>
          </Link>
          <nav className="hidden items-center gap-0.5 lg:flex">
            {PRIMARY.map((n) => {
              const active = path === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    active ? "text-toxic" : "text-dim hover:text-ink"
                  }`}
                >
                  {active && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-md bg-toxic/10 ring-1 ring-toxic/25" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
                  )}
                  {n.label}
                </Link>
              );
            })}
            <ToolsMenu items={tools} path={path} />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block"><Search /></div>
            <Link href="/settings" className={`hidden rounded-md border border-edge px-2 py-1.5 text-sm sm:block ${path === "/settings" ? "text-toxic" : "text-dim hover:text-ink"}`} aria-label="Settings">⚙</Link>
            <WalletButton />
          </div>
        </div>
        <Ticker2 />
      </header>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute left-0 top-0 h-full w-72 border-r border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">DEGEN<span className="text-toxic">ARATION</span></span>
              <button onClick={() => setMobileOpen(false)} className="text-dim" aria-label="Close menu">✕</button>
            </div>
            <div className="mt-3"><Search /></div>
            <nav className="mt-4 flex flex-col gap-0.5">
              {allNav.map((n) => {
                const active = path === n.href;
                return (
                  <Link key={n.href} href={n.href} onClick={() => setMobileOpen(false)}
                    className={`rounded-md px-3 py-2.5 text-sm font-medium transition ${active ? "bg-toxic/10 text-toxic" : "text-dim hover:bg-edge/40 hover:text-ink"}`}>
                    {n.label}
                  </Link>
                );
              })}
              <Link href="/settings" onClick={() => setMobileOpen(false)} className={`rounded-md px-3 py-2.5 text-sm font-medium ${path === "/settings" ? "bg-toxic/10 text-toxic" : "text-dim hover:bg-edge/40 hover:text-ink"}`}>Settings</Link>
            </nav>
          </div>
        </div>
      )}

      {/* main */}
      <motion.main
        key={path}
        initial={{ y: 8 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 pb-16 lg:px-6"
      >
        {children}
      </motion.main>

      {/* bottom status bar */}
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-edge glass">
        <div className="flex h-9 items-center gap-1 px-3 text-[11px]">
          <BottomLink href="/dashboard" label="Positions" icon="◱" active={path === "/dashboard"} />
          <BottomLink href="/alerts" label="Alerts" icon="◔" active={path === "/alerts"} />
          <BottomLink href="/tracker" label="Tracker" icon="◉" active={path === "/tracker"} />
          <BottomLink href="/trenches" label="Trenches" icon="🔥" active={path === "/trenches"} />
          <BottomLink href="/explorer" label="Explorer" icon="◎" active={path === "/explorer"} />
          <div className="ml-auto flex items-center gap-4">
            <SolPrice />
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-toxic">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-toxic" /> Connected
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
