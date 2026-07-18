"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import { Menu, X } from "lucide-react";

const LINKS = [
  { label: "Terminal", href: "/terminal" },
  { label: "Trades", href: "/trades" },
  { label: "Search", href: "/search" },
  { label: "Bots", href: "/bots" },
  { label: "Affiliate", href: "/affiliate" },
  { label: "Portfolio", href: "/portfolio" }
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
      className="fixed inset-x-0 top-10 z-[70] border-b border-edge bg-void/90 backdrop-blur-xl"
    >
      <motion.nav
        className={`mx-auto flex h-16 max-w-7xl items-center gap-2 px-5 transition-shadow duration-300 ${scrolled ? "shadow-[0_12px_30px_-24px_rgba(0,0,0,.9)]" : ""}`}
      >
        <Link href="#top" className={`transition-all ${scrolled ? "text-base" : "text-lg"}`}>
          <Logo />
        </Link>

        <div className="mx-2 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="px-3 py-2 text-sm text-dim transition hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login" className="rounded-md border border-edge px-4 py-2 text-sm font-semibold text-ink transition hover:border-toxic">Connect Wallet</Link>
          <Link href="/terminal" className="rounded-md bg-toxic px-4 py-2 text-sm font-semibold text-[#17110c] transition hover:bg-[#d1a371]">Open terminal</Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={open}
          className="ml-auto grid h-10 w-10 place-items-center rounded-md border border-edge text-dim md:hidden"
        >
          {open ? <X aria-hidden="true" size={19} /> : <Menu aria-hidden="true" size={19} />}
        </button>
      </motion.nav>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute inset-x-4 top-16 border border-edge bg-panel p-3 shadow-2xl md:hidden"
        >
          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} onClick={() => setOpen(false)} className="block rounded-md px-4 py-3 text-sm text-dim hover:bg-edge/40 hover:text-ink">
              {l.label}
            </Link>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/login" onClick={() => setOpen(false)} className="rounded-md border border-edge px-3 py-2.5 text-center text-sm font-semibold">Connect Wallet</Link>
            <Link href="/terminal" onClick={() => setOpen(false)} className="rounded-md bg-toxic px-3 py-2.5 text-center text-sm font-bold text-[#17110c]">Open terminal</Link>
          </div>
        </motion.div>
      )}
    </motion.header>
  );
}
