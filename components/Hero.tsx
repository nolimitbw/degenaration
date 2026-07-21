"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import LiveMarketTerminal from "@/components/LiveMarketTerminal";

export default function Hero() {
  return (
    <section className="home-hero mx-auto max-w-7xl px-5 pb-16 pt-16">
      <div>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="flex flex-col justify-between gap-7 pb-9 lg:flex-row lg:items-end">
          <div>
          <div className="inline-flex items-center gap-2 border border-edge bg-panel px-3 py-2 font-mono text-[10px] uppercase text-dim">
            <span className="h-1.5 w-1.5 bg-up" /> Solana execution workspace
          </div>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.02] text-ink md:text-6xl">Trade signals with a clearer view.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-dim">Live market discovery, wallet-signed execution, Discord call tracking, automation controls, and portfolio performance in one focused workspace.</p>
          </div>
          <div className="shrink-0">
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/terminal" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-toxic px-5 py-3 text-sm font-semibold text-[#17110c] transition hover:bg-[#d1a371]">Open terminal <ArrowUpRight size={16} /></Link>
            <Link href="/search" className="inline-flex min-h-11 items-center rounded-md border border-edge px-5 py-3 text-sm font-semibold text-ink transition hover:border-toxic">Search markets</Link>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-px bg-edge">
            {[['Wallet','Non-custodial'],['Routes','Previewed'],['Sources','Approved']].map(([label, value]) => <div key={label} className="bg-void px-3 py-3"><p className="font-mono text-[9px] uppercase text-dim">{label}</p><p className="mt-1 text-xs font-semibold text-ink">{value}</p></div>)}
          </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.55 }}>
          <LiveMarketTerminal />
        </motion.div>
      </div>
    </section>
  );
}
