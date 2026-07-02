"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import WalletButton from "./WalletButton";
import Ticker2 from "./Ticker2";
import Search from "./Search";
import NetworkToggle from "./NetworkToggle";

const NAV = [
  { href: "/trenches", label: "Trenches", icon: "🔥" },
  { href: "/explorer", label: "Explorer", icon: "◎" },
  { href: "/tracker", label: "Wallet Tracker", icon: "◉" },
  { href: "/holdings", label: "Holdings", icon: "◈" },
  { href: "/watchlist", label: "Watchlist", icon: "☆" },
  { href: "/alerts", label: "Alerts", icon: "◔" },
  { href: "/dashboard", label: "Portfolio", icon: "◱" },
  { href: "/wallet", label: "Wallet", icon: "◈" },
  { href: "/alpha", label: "Alpha", icon: "★" },
  { href: "/calls", label: "Discord Calls", icon: "◎" },
  { href: "/terminal", label: "Terminal", icon: "▤" },
  { href: "/orders", label: "Limit Orders", icon: "◪" },
  { href: "/apply", label: "List your server", icon: "▣" },
  { href: "/admin", label: "Admin", icon: "⚙" },
  { href: "/admin/commissions", label: "Commissions", icon: "$" },
  { href: "/settings", label: "Settings", icon: "⚙" }
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-edge glass px-4 py-6 transition-transform md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <Link href="/" className="px-2 text-lg font-bold">
          DEGEN<span className="text-toxic text-glow-toxic">ARATION</span>
        </Link>
        <nav className="mt-10 flex flex-col gap-1">
          {NAV.map((n) => {
            const active = path === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                  active ? "text-toxic" : "text-dim hover:bg-edge/40 hover:text-white"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-md bg-toxic/10 ring-1 ring-toxic/30"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <span>{n.icon}</span> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-md border border-edge bg-void p-3">
          <p className="font-mono text-[11px] text-toxic">● live</p>
          <p className="mt-1 text-xs text-dim/80">Non-custodial · your keys, your coins.</p>
        </div>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="min-h-screen w-full md:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-edge glass px-5">
          <div className="flex items-center gap-2">
            <button onClick={() => setMobileOpen(true)} className="text-lg text-dim md:hidden" aria-label="menu">☰</button>
            <NetworkToggle />
          </div>
          <div className="flex items-center gap-3">
            <Search />
            <WalletButton />
          </div>
        </header>
        <Ticker2 />
        <motion.main
          key={path}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="p-5 md:p-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
