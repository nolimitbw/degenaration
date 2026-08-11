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
  loading: () => <span className="t-label text-dim">Checking wallet</span>
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
        className="relative grid h-11 w-11 place-items-center rounded-md text-dim transition hover:bg-[color:var(--rule)] hover:text-ink sm:h-9 sm:w-9"
        aria-label="Status"
        aria-expanded={open}
      >
        <Bell aria-hidden="true" size={17} strokeWidth={1.7} />
        <span className="absolute right-2.5 top-2.5 h-[5px] w-[5px] rounded-full bg-gold-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[19rem] rounded-lg border border-[color:var(--rule-strong)] bg-panel p-4 shadow-[var(--shadow-panel)]">
          {/* Per capability, not one global verdict. Naming a working feature beside a real
              restriction is what made the old wording harmful. */}
          <p className="t-body font-medium text-ink">What you can do right now</p>
          <ul className="mt-3 space-y-2 t-meta leading-5 text-dim">
            <Capability ready>Swap from your own wallet</Capability>
            <Capability ready>Withdraw funds and take payouts</Capability>
            <Capability ready>Build, edit and pause bots</Capability>
            <Capability ready={Boolean(automation?.live)}>Let bots trade on their own</Capability>
          </ul>
          {automation?.reason && <p className="mt-3 t-label leading-5 text-[color:var(--text-muted)]">{automation.reason}</p>}
          <Link href="/bots/manage" onClick={() => setOpen(false)} className="mt-3 inline-flex t-meta font-medium text-gold-400">
            Go to my bots
          </Link>
        </div>
      )}
    </div>
  );
}

/** A capability line: a dot carries the state, so the row reads as prose rather than a table. */
function Capability({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full ${ready ? "bg-up" : "bg-gold-400"}`} aria-hidden="true" />
      <span className={ready ? "text-dim" : "text-ink"}>{children}</span>
      <span className="sr-only">{ready ? " — available" : " — not available yet"}</span>
    </li>
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
        className="grid h-11 w-11 place-items-center rounded-md text-dim transition hover:bg-[color:var(--rule)] hover:text-ink sm:h-9 sm:w-9"
        aria-label={`Theme: ${selected.label}`}
        aria-expanded={open}
      >
        <SelectedIcon aria-hidden="true" size={17} strokeWidth={1.7} />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-40 overflow-hidden rounded-lg border border-[color:var(--rule-strong)] bg-panel p-1.5 shadow-[var(--shadow-panel)]">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => { setPreference(value); setOpen(false); }}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded px-3 text-left t-meta transition ${preference === value ? "font-medium text-ink" : "text-dim hover:text-ink"}`}
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.7} className={preference === value ? "text-ink" : "text-[color:var(--text-muted)]"} />
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

      {/* The rail carries three destinations and the account. It had also carried a
          "Workspace" heading above a three-item list, and a bordered card restating
          "Solana Mainnet" — a fact the header pill and the footer were each stating as
          well. One screen said mainnet three times and said nothing else about it. */}
      <aside className="app-sidebar sticky top-0 z-40 hidden h-screen w-[232px] shrink-0 flex-col lg:flex">
        <div className="flex h-[72px] items-center px-6">
          <Link href="/bots" aria-label="DegenAration bots"><Logo /></Link>
        </div>
        <nav className="grid gap-0.5 px-3 pt-4" aria-label="Primary navigation">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(path, href);
            return (
              <Link key={href} href={href} className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 t-body transition ${active ? "font-medium text-ink" : "text-dim hover:text-ink"}`}>
                {active && <motion.span layoutId="app-nav-active" className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-gold-400" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <Icon aria-hidden="true" size={17} strokeWidth={1.7} className={active ? "text-ink" : "text-[color:var(--text-muted)]"} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-1 p-3">
          {admin && (
            <Link href="/admin" className={`flex min-h-11 items-center gap-3 rounded-md px-3 t-body ${isActivePath(path, "/admin") ? "font-medium text-ink" : "text-dim hover:text-ink"}`}>
              <ShieldCheck aria-hidden="true" size={17} strokeWidth={1.7} className={isActivePath(path, "/admin") ? "text-ink" : "text-[color:var(--text-muted)]"} /> Owner console
            </Link>
          )}
          <div className="min-w-0 border-t border-[color:var(--rule)] px-3 pt-3"><WalletStatus /></div>
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
              <button type="button" onClick={() => setMobileOpen(false)} className="grid h-11 w-11 place-items-center rounded-md text-dim" aria-label="Close navigation">
                <X aria-hidden="true" size={19} />
              </button>
            </div>
            <nav className="mt-8 grid gap-0.5">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = isActivePath(path, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex min-h-12 items-center gap-3 rounded-md px-3 t-body ${active ? "font-medium text-ink" : "text-dim"}`}
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.7} className={active ? "text-ink" : "text-[color:var(--text-muted)]"} />
                    {label}
                  </Link>
                );
              })}
              {admin && (
                <Link href="/admin" className="mt-4 flex min-h-12 items-center gap-3 border-t border-[color:var(--rule)] px-3 pt-4 t-body text-dim">
                  <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.7} className="text-[color:var(--text-muted)]" />
                  Owner console
                </Link>
              )}
            </nav>
            <div className="absolute inset-x-5 bottom-5 border-t border-[color:var(--rule)] pt-4">
              <WalletStatus />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* The desktop bar carried an eyebrow reading "DegenAration desk" over the section
            name — both restating the rail two inches to the left. What belongs here is the
            account, so that is all it holds. */}
        <header className="sticky top-0 z-30 border-b border-[color:var(--rule)] bg-void/90 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-[1560px] items-center gap-2 px-4 sm:gap-3 lg:h-[72px] lg:px-8">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-dim transition hover:text-ink lg:hidden" aria-label="Open navigation">
              <Menu aria-hidden="true" size={19} />
            </button>
            <Link href="/bots" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center lg:hidden" aria-label="DegenAration bots">
              <Logo compact className="sm:hidden" />
              <Logo className="hidden sm:inline-flex" />
            </Link>
            {/* The section name is not repeated here. The rail marks it and the page's own
                h1 states it; a third copy in the bar was the eyebrow again, one size down. */}
            <span className="sr-only">{section}</span>
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              <ThemeMenu />
              <Notifications />
              <WalletButton />
            </div>
          </div>
        </header>

        <motion.main ref={mainRef} id="main-content" tabIndex={-1} key={path} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }} className="mx-auto w-full max-w-[1560px] flex-1 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </motion.main>

        <footer className="px-4 pb-6 pt-2 lg:px-8">
          <div className="mx-auto flex max-w-[1560px] items-center gap-2 border-t border-[color:var(--rule)] pt-4 t-label text-[color:var(--text-muted)]">
            <span className="h-[5px] w-[5px] rounded-full bg-up" aria-hidden="true" />
            Solana mainnet
          </div>
        </footer>
      </div>
    </div>
  );
}
