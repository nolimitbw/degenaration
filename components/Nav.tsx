"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import Magnetic from "@/components/Magnetic";
import Logo from "@/components/Logo";

const LINKS = [
  { label: "Home", href: "#top" },
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how" },
  { label: "Roadmap", href: "#roadmap" },
  { label: "FAQ", href: "/docs" }
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
      className="fixed inset-x-0 top-3 z-[70] flex justify-center px-4"
    >
      <motion.nav
        animate={{ y: scrolled ? 0 : [0, -3, 0] }}
        transition={scrolled ? { duration: 0.3 } : { duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className={`glass-cosmic flex items-center gap-2 rounded-full transition-all duration-300 ${
          scrolled ? "px-3 py-1.5 shadow-[0_10px_40px_-12px_rgb(var(--toxic-rgb)/.5)]" : "px-4 py-2.5"
        }`}
        style={{ backdropFilter: scrolled ? "blur(22px) saturate(160%)" : "blur(14px) saturate(140%)" }}
      >
        <Link href="#top" className={`transition-all ${scrolled ? "text-base" : "text-lg"}`}>
          <Logo />
        </Link>

        <div className="mx-2 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="rounded-full px-3 py-1.5 text-sm text-haze transition hover:bg-white/5 hover:text-starlight"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login" className="btn-ghost px-3 py-1.5 text-sm font-semibold">Connect Wallet</Link>
          <Magnetic strength={0.5}>
            <Link href="/trenches" className={`btn-cosmic font-bold transition-all ${scrolled ? "px-4 py-1.5 text-sm" : "px-5 py-2 text-sm"}`}>
              Launch App →
            </Link>
          </Magnetic>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          className="btn-ghost ml-1 grid h-9 w-9 place-items-center md:hidden"
        >
          <span className="text-lg leading-none">{open ? "✕" : "☰"}</span>
        </button>
      </motion.nav>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-cosmic absolute top-16 w-[min(92vw,22rem)] rounded-2xl p-3 md:hidden"
        >
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-sm text-haze hover:bg-white/5 hover:text-starlight">
              {l.label}
            </a>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/login" onClick={() => setOpen(false)} className="btn-ghost px-3 py-2.5 text-center text-sm font-semibold">Connect Wallet</Link>
            <Link href="/trenches" onClick={() => setOpen(false)} className="btn-cosmic px-3 py-2.5 text-center text-sm font-bold">Launch App →</Link>
          </div>
        </motion.div>
      )}
    </motion.header>
  );
}
