"use client";
import Link from "next/link";
import { motion } from "framer-motion";

export default function Nav() {
  return (
    <motion.nav
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="sticky top-0 z-50 w-full border-b border-edge/70 bg-void/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="text-xl font-bold tracking-tight">
          DEGEN<span className="text-toxic text-glow-toxic">ARATION</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-dim md:flex">
          <a href="#groups" className="transition hover:text-white">Call Groups</a>
          <a href="#how" className="transition hover:text-white">How it works</a>
          <a href="#fees" className="transition hover:text-white">Fees</a>
          <Link href="/docs" className="transition hover:text-white">Docs</Link>
          <Link href="/security" className="transition hover:text-white">Security</Link>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden rounded-md px-3 py-2 text-sm font-medium text-dim transition hover:text-white sm:block">
            Sign in
          </Link>
          <Link
            href="/trenches"
            className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-void shadow-toxic transition hover:scale-[1.04]"
          >
            Launch App →
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}
