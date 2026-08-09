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
  Menu,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  WalletCards,
  X
} from "lucide-react";
import Logo from "@/components/Logo";
import ReferralCaptureCompletion from "@/components/ReferralCaptureCompletion";
import WalletRegistration from "@/components/WalletRegistration";
import { useIsAdmin } from "@/lib/admin";
import { type ThemePreference, useTheme } from "@/components/ThemeProvider";

const WalletButton = dynamic(() => import("@/components/WalletButton"), {
  ssr: false,
  loading: () => <div className="h-10 w-28 animate-pulse rounded-md bg-edge/50" />
});

const WalletStatus = dynamic(() => import("@/components/WalletStatus"), {
  ssr: false,
  loading: () => <span className="text-xs text-dim">Checking wallet</span>
});

const NAV = [
  { href: "/bots", label: "Bots", icon: Bot },
  { href: "/affiliate", label: "Affiliate", icon: ChartNoAxesCombined },
  { href: "/portfolio", label: "Portfolio", icon: WalletCards }
];

function isActivePath(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [automation, setAutomation] = useState<{ status: string; reason: string; live: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    fetch("/api/platform/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => value?.automation && setAutomation(value.automation))
      .catch(() => setAutomation(null));
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-11 w-11 place-items-center sm:h-10 sm:w-10 rounded-md border border-edge text-dim transition hover:border-gold-400/60 hover:text-ink"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell aria-hidden="true" size={17} />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-md border border-edge bg-panel p-4 shadow-2xl">
          {/* Per capability, not one global verdict. Naming a working feature beside a real
              restriction is what made the old wording harmful. */}
          <p className="text-sm font-semibold text-ink">What this workspace can do</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-dim">
            <li className="flex gap-2"><span className="text-up">Available</span> Manual swaps you confirm in your own wallet</li>
            <li className="flex gap-2"><span className="text-up">Available</span> Withdrawals and affiliate payouts</li>
            <li className="flex gap-2"><span className="text-up">Available</span> Building, editing, pausing and versioning bots</li>
            <li className="flex gap-2"><span className={automation?.live ? "text-up" : "text-gold-400"}>{automation?.status || "Checking"}</span> Bots placing trades on their own</li>
          </ul>
          {automation?.reason && <p className="mt-2 text-[11px] leading-5 text-dim">{automation.reason}</p>}
          <Link href="/bots/manage" onClick={() => setOpen(false)} className="mt-3 inline-flex text-xs font-semibold text-gold-400 hover:text-info">
            Review bot status
          </Link>
        </div>
      )}
    </div>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor }
];

function ThemeMenu() {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = THEMES.find((theme) => theme.value === preference) || THEMES[2];
  const SelectedIcon = selected.icon;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="grid h-11 w-11 place-items-center rounded-md border border-edge text-dim transition hover:border-gold-400/60 hover:text-ink sm:h-10 sm:w-10"
        aria-label={`Theme: ${selected.label}`}
        aria-expanded={open}
      >
        <SelectedIcon aria-hidden="true" size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-40 overflow-hidden rounded-md border border-edge bg-panel p-1.5 shadow-[var(--shadow-panel)]">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => { setPreference(value); setOpen(false); }}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded px-3 text-left text-xs font-medium transition ${preference === value ? "bg-gold-400/10 text-ink" : "text-dim hover:bg-surface-hover hover:text-ink"}`}
            >
              <Icon aria-hidden="true" size={15} className={preference === value ? "text-gold-400" : ""} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(path);
  const { admin } = useIsAdmin();

  useEffect(() => {
    if (previousPath.current !== path) {
      setMobileOpen(false);
      mainRef.current?.focus({ preventScroll: true });
      previousPath.current = path;
    }
  }, [path]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const section = NAV.find((item) => isActivePath(path, item.href))?.label || (isActivePath(path, "/admin") ? "Owner console" : "Workspace");

  return (
    <div className="app-shell min-h-screen lg:flex">
      <ReferralCaptureCompletion />
      <WalletRegistration />

      <aside className="app-sidebar sticky top-0 z-40 hidden h-screen w-60 shrink-0 flex-col lg:flex">
        <div className="flex h-20 items-center border-b border-edge px-6">
          <Link href="/bots" aria-label="DegenAration bots"><Logo /></Link>
        </div>
        <div className="px-4 pb-2 pt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-dim">Workspace</div>
        <nav className="grid gap-1 px-3" aria-label="Primary navigation">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(path, href);
            return (
              <Link key={href} href={href} className={`relative flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium transition ${active ? "bg-gold-400/10 text-ink" : "text-dim hover:bg-surface-hover hover:text-ink"}`}>
                {active && <motion.span layoutId="app-nav-active" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gold-400" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} className={active ? "text-gold-400" : ""} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 border-t border-edge p-4">
          <div className="rounded-md border border-edge bg-void px-3 py-3">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
              <span>Network</span><span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
            </div>
            <p className="mt-1.5 text-xs font-semibold text-ink">Solana Mainnet</p>
          </div>
          {admin && (
            <Link href="/admin" className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-xs font-medium ${isActivePath(path, "/admin") ? "bg-gold-400/10 text-ink" : "text-dim hover:bg-surface-hover hover:text-ink"}`}>
              <ShieldCheck aria-hidden="true" size={17} className={isActivePath(path, "/admin") ? "text-gold-400" : ""} /> Owner console
            </Link>
          )}
          <div className="min-w-0 px-2"><WalletStatus /></div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="app-sidebar absolute left-0 top-0 h-full w-[min(88vw,340px)] border-r border-edge p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Logo />
              <button type="button" onClick={() => setMobileOpen(false)} className="grid h-11 w-11 place-items-center sm:h-10 sm:w-10 rounded-md border border-edge text-dim" aria-label="Close navigation">
                <X aria-hidden="true" size={19} />
              </button>
            </div>
            <nav className="mt-8 grid gap-1">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium ${
                    isActivePath(path, href) ? "bg-gold-400/10 text-ink" : "text-dim"
                  }`}
                >
                  <Icon aria-hidden="true" size={18} className={isActivePath(path, href) ? "text-gold-400" : ""} />
                  {label}
                </Link>
              ))}
              {admin && (
                <Link href="/admin" className="mt-4 flex min-h-12 items-center gap-3 border-t border-edge px-3 pt-4 text-sm font-medium text-dim">
                  <ShieldCheck aria-hidden="true" size={18} />
                  Owner console
                </Link>
              )}
            </nav>
            <div className="absolute inset-x-5 bottom-5 border-t border-edge pt-4">
              <WalletStatus />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-edge bg-void/95 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center gap-2 px-4 sm:gap-3 lg:h-20 lg:px-7">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-edge text-dim lg:hidden" aria-label="Open navigation">
              <Menu aria-hidden="true" size={19} />
            </button>
            <Link href="/bots" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center lg:hidden" aria-label="DegenAration bots">
              <Logo compact className="sm:hidden" />
              <Logo className="hidden sm:inline-flex" />
            </Link>
            <div className="hidden min-w-0 lg:block">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">DegenAration desk</p>
              <p className="mt-1 text-sm font-semibold text-ink">{section}</p>
            </div>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <div className="hidden items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2 font-mono text-[9px] uppercase tracking-[0.08em] text-dim md:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-400" /> Solana <span className="text-ink">Mainnet</span>
              </div>
              <ThemeMenu />
              <Notifications />
              <WalletButton />
            </div>
          </div>
        </header>

        <motion.main ref={mainRef} id="main-content" tabIndex={-1} key={path} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-6 sm:px-5 lg:px-7 lg:py-7">
          {children}
        </motion.main>

        <footer className="border-t border-edge px-4 py-3 lg:px-7">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
            <span>DegenAration workspace</span><span>Solana Mainnet</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
