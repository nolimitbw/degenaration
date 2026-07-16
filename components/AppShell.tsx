"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bell,
  Bot,
  ChartNoAxesCombined,
  ChevronDown,
  CircleDollarSign,
  CircleDot,
  Compass,
  Flame,
  ListOrdered,
  Menu,
  Radar,
  RadioTower,
  ServerCog,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Star,
  WalletCards,
  X,
  type LucideIcon
} from "lucide-react";
import Ticker from "./Ticker";
import Search from "./Search";

// Load the wallet button (and its heavy Privy bundle) only on the client, after paint.
// Keeps ~800KB of signing code off the critical path so data pages open instantly.
const WalletButton = dynamic(() => import("./WalletButton"), {
  ssr: false,
  loading: () => <div className="h-8 w-28 animate-pulse rounded-md bg-edge/40" />
});

const WalletStatus = dynamic(() => import("./WalletStatus"), {
  ssr: false,
  loading: () => (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-dim">
      <span className="h-1.5 w-1.5 rounded-full bg-dim/60" /> Checking
    </span>
  )
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
type ToolItem = { href: string; label: string; desc: string; icon: LucideIcon };

const TOOLS: ToolItem[] = [
  { href: "/terminal", label: "Trade Terminal", desc: "Buy and sell any token instantly", icon: SquareTerminal },
  { href: "/orders", label: "Limit Orders", desc: "Auto buy or sell at your price", icon: ListOrdered },
  { href: "/calls", label: "Discord Calls", desc: "Copy trades from call groups", icon: RadioTower },
  { href: "/watchlist", label: "Watchlist", desc: "Your starred tokens", icon: Star },
  { href: "/alerts", label: "Price Alerts", desc: "Notifications while the alerts tab is open", icon: Bell },
  { href: "/dashboard", label: "Portfolio", desc: "PnL and trade history", icon: ChartNoAxesCombined },
  { href: "/apply", label: "List your server", desc: "Add your Discord call group", icon: ServerCog }
];

const ADMIN_TOOLS: ToolItem[] = [
  { href: "/admin", label: "Admin", desc: "Owner console", icon: ShieldCheck },
  { href: "/admin/channels", label: "Call channels", desc: "Approve Discord channels", icon: Bot },
  { href: "/admin/commissions", label: "Commissions", desc: "Platform fee ledger", icon: CircleDollarSign }
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
      <span className="flex items-center gap-1 text-toxic"><CircleDot aria-hidden="true" size={12} strokeWidth={1.8} /> SOL</span>
      <span className="text-ink">{px != null ? `$${px.toFixed(2)}` : "…"}</span>
    </span>
  );
}

function isActivePath(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

function ToolsMenu({ items, path }: { items: ToolItem[]; path: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  const active = items.some((i) => isActivePath(path, i.href));
  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex min-h-11 items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
          active || open ? "text-toxic" : "text-dim hover:text-ink"
        }`}
      >
        Tools <ChevronDown aria-hidden="true" size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-edge bg-panel p-1.5 shadow-card">
          {items.map((i) => {
            const Icon = i.icon;
            return (
            <Link
              key={i.href}
              href={i.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={`flex items-start gap-3 rounded-md px-3 py-2.5 transition hover:bg-edge/50 ${
                isActivePath(path, i.href) ? "bg-toxic/10" : ""
              }`}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} className={`mt-0.5 shrink-0 ${isActivePath(path, i.href) ? "text-toxic" : "text-dim"}`} />
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${isActivePath(path, i.href) ? "text-toxic" : "text-ink"}`}>{i.label}</span>
                <span className="block truncate text-[11px] text-dim">{i.desc}</span>
              </span>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Compact link for the bottom status bar; all route to real pages.
function BottomLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex min-h-9 items-center gap-1.5 px-2 py-1 text-[11px] font-medium transition ${
        active ? "text-toxic" : "text-dim hover:text-ink"
      }`}
    >
      <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(path);
  const tools = [...TOOLS, ...ADMIN_TOOLS];
  const allNav = [...PRIMARY, ...tools];

  useEffect(() => {
    if (previousPath.current !== path) {
      setMobileOpen(false);
      mainRef.current?.focus({ preventScroll: true });
      previousPath.current = path;
    }
  }, [path]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white transition focus:translate-y-0">
        Skip to content
      </a>
      {/* top nav */}
      <header className="sticky top-0 z-40 border-b border-edge glass">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <button onClick={() => setMobileOpen(true)} className="grid h-11 w-11 place-items-center rounded-md text-dim transition hover:bg-edge/40 hover:text-ink lg:hidden" aria-label="Open menu">
            <Menu aria-hidden="true" size={21} />
          </button>
          <Link href="/trenches" className="shrink-0 text-lg font-bold tracking-tight">
            DEGEN<span className="text-brand">ARATION</span>
          </Link>
          <nav className="hidden items-center gap-0.5 lg:flex">
            {PRIMARY.map((n) => {
              const active = isActivePath(path, n.href);
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
            <Link href="/settings" className={`hidden h-11 w-11 place-items-center rounded-md border border-edge transition sm:grid ${isActivePath(path, "/settings") ? "border-toxic/40 bg-toxic/10 text-toxic" : "text-dim hover:border-toxic/50 hover:text-ink"}`} aria-label="Settings">
              <Settings aria-hidden="true" size={18} />
            </Link>
            <WalletButton />
          </div>
        </div>
        <Ticker />
      </header>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div role="dialog" aria-modal="true" aria-label="Navigation menu" className="absolute left-0 top-0 h-full w-72 border-r border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">DEGEN<span className="text-brand">ARATION</span></span>
              <button onClick={() => setMobileOpen(false)} className="grid h-11 w-11 place-items-center rounded-md text-dim transition hover:bg-edge/40 hover:text-ink" aria-label="Close menu">
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <div className="mt-3"><Search /></div>
            <nav className="mt-4 flex flex-col gap-0.5">
              {allNav.map((n) => {
                const active = isActivePath(path, n.href);
                return (
                  <Link key={n.href} href={n.href} onClick={() => setMobileOpen(false)}
                    className={`rounded-md px-3 py-2.5 text-sm font-medium transition ${active ? "bg-toxic/10 text-toxic" : "text-dim hover:bg-edge/40 hover:text-ink"}`}>
                    {n.label}
                  </Link>
                );
              })}
              <Link href="/settings" onClick={() => setMobileOpen(false)} className={`rounded-md px-3 py-2.5 text-sm font-medium ${isActivePath(path, "/settings") ? "bg-toxic/10 text-toxic" : "text-dim hover:bg-edge/40 hover:text-ink"}`}>Settings</Link>
            </nav>
          </div>
        </div>
      )}

      {/* main */}
      <motion.main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
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
          <BottomLink href="/dashboard" label="Positions" icon={WalletCards} active={isActivePath(path, "/dashboard")} />
          <BottomLink href="/alerts" label="Alerts" icon={Bell} active={isActivePath(path, "/alerts")} />
          <BottomLink href="/tracker" label="Tracker" icon={Radar} active={isActivePath(path, "/tracker")} />
          <BottomLink href="/trenches" label="Trenches" icon={Flame} active={isActivePath(path, "/trenches")} />
          <BottomLink href="/explorer" label="Explorer" icon={Compass} active={isActivePath(path, "/explorer")} />
          <div className="ml-auto flex items-center gap-4">
            <SolPrice />
            <WalletStatus />
          </div>
        </div>
      </footer>
    </div>
  );
}
