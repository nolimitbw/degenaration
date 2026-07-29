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
  ShieldCheck,
  WalletCards,
  X
} from "lucide-react";
import Logo from "@/components/Logo";
import ReferralCaptureCompletion from "@/components/ReferralCaptureCompletion";
import { useIsAdmin } from "@/lib/admin";
import { AUTOMATED_MAINNET_RELEASE } from "@/lib/trading-release";

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
  const ref = useRef<HTMLDivElement>(null);
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
        className="relative grid h-10 w-10 place-items-center rounded-md border border-edge text-dim transition hover:border-toxic/60 hover:text-ink"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell aria-hidden="true" size={17} />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-toxic" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-md border border-edge bg-panel p-4 shadow-2xl">
          <p className="text-sm font-semibold text-ink">Automated trading is not yet available</p>
          <p className="mt-1 text-xs leading-5 text-dim">
            {AUTOMATED_MAINNET_RELEASE.reason}
          </p>
          <Link href="/bots/manage" onClick={() => setOpen(false)} className="mt-3 inline-flex text-xs font-semibold text-toxic hover:text-cyber">
            Review bot status
          </Link>
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

  return (
    <div className="app-shell min-h-screen">
      <ReferralCaptureCompletion />

      <header className="sticky top-0 z-40 border-b border-edge bg-void/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-3 px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-md border border-edge text-dim lg:hidden"
            aria-label="Open navigation"
          >
            <Menu aria-hidden="true" size={19} />
          </button>
          <Link href="/bots" className="shrink-0" aria-label="DegenAration bots">
            <Logo />
          </Link>

          <nav className="ml-8 hidden h-full items-center gap-1 lg:flex" aria-label="Primary navigation">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActivePath(path, href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex h-full min-w-28 items-center justify-center gap-2 px-4 text-sm font-medium transition ${
                    active ? "text-ink" : "text-dim hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden="true" size={16} strokeWidth={1.8} className={active ? "text-toxic" : ""} />
                  {label}
                  {active && (
                    <motion.span
                      layoutId="app-nav-active"
                      className="absolute inset-x-3 bottom-0 h-0.5 bg-toxic"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2 font-mono text-[10px] uppercase text-dim sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-toxic" />
              Solana
              <span className="text-ink">Mainnet</span>
            </div>
            {admin && (
              <Link
                href="/admin"
                className={`grid h-10 w-10 place-items-center rounded-md border transition ${
                  isActivePath(path, "/admin") ? "border-toxic/60 bg-toxic/10 text-toxic" : "border-edge text-dim hover:text-ink"
                }`}
                aria-label="Owner console"
                title="Owner console"
              >
                <ShieldCheck aria-hidden="true" size={17} />
              </Link>
            )}
            <Notifications />
            <WalletButton />
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute left-0 top-0 h-full w-[min(88vw,340px)] border-r border-edge bg-panel p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Logo />
              <button type="button" onClick={() => setMobileOpen(false)} className="grid h-10 w-10 place-items-center rounded-md border border-edge text-dim" aria-label="Close navigation">
                <X aria-hidden="true" size={19} />
              </button>
            </div>
            <nav className="mt-8 grid gap-1">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium ${
                    isActivePath(path, href) ? "bg-toxic/10 text-ink" : "text-dim"
                  }`}
                >
                  <Icon aria-hidden="true" size={18} className={isActivePath(path, href) ? "text-toxic" : ""} />
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

      <motion.main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        key={path}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="mx-auto w-full max-w-[1680px] px-4 py-6 lg:px-6 lg:py-8"
      >
        {children}
      </motion.main>

      <footer className="border-t border-edge px-4 py-3">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-dim">
          <span>Solana Mainnet workspace</span>
        </div>
      </footer>
    </div>
  );
}
