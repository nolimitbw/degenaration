"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import LiveMarketTerminal from "@/components/LiveMarketTerminal";

export default function Hero() {
  return (
    <section className="home-hero mx-auto max-w-7xl px-5 pb-14 pt-12 sm:pt-16">
      <div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex flex-col justify-between gap-7 pb-9 lg:flex-row lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 border border-edge bg-panel px-3 py-2 font-mono text-[10px] uppercase text-dim">
              <span className="h-1.5 w-1.5 bg-up" />
              Solana automation workspace
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.05] text-ink sm:text-5xl md:text-6xl">
              Degen<span className="text-toxic">A</span>ration
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-dim">
              Build evidence-aware bots from Discord calls or live market volatility, then follow every position, fee, and payout from one account.
            </p>
          </div>
          <div className="shrink-0">
            <div className="flex flex-wrap gap-3">
              <Link href="/bots" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-toxic px-5 py-3 text-sm font-semibold text-[#17110c] transition hover:bg-[#d1a371]">
                Open Bots <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
              <Link href="/affiliate" className="inline-flex min-h-11 items-center rounded-md border border-edge px-5 py-3 text-sm font-semibold text-ink transition hover:border-toxic">
                Creator earnings
              </Link>
            </div>
            <div className="mt-4 flex items-start gap-2 border-t border-edge pt-4 text-[11px] leading-5 text-dim">
              <ShieldCheck aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-up" />
              Paper mode is active. Mainnet entries and automated payouts remain disabled.
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
          <LiveMarketTerminal />
        </motion.div>
      </div>
    </section>
  );
}
