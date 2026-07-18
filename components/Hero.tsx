"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Bot, CandlestickChart, ShieldCheck } from "lucide-react";

const candles = [42, 58, 48, 72, 64, 88, 74, 96, 82, 106, 92, 118, 104, 132, 124, 146, 136, 158, 148, 172];

export default function Hero() {
  return (
    <section className="home-hero mx-auto min-h-[min(880px,calc(100svh-2rem))] max-w-7xl px-5 pb-14 pt-32">
      <div className="grid items-end gap-10 lg:grid-cols-[.72fr_1.28fr]">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="pb-3">
          <div className="inline-flex items-center gap-2 border border-edge bg-panel px-3 py-2 font-mono text-[10px] uppercase text-dim">
            <span className="h-1.5 w-1.5 bg-up" /> Solana execution workspace
          </div>
          <h1 className="mt-7 max-w-xl text-5xl font-semibold leading-[1.02] text-ink md:text-6xl">Trade signals with a clearer view.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-dim">A professional terminal for market discovery, wallet-signed trading, Discord call tracking, automation controls, and portfolio performance.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/terminal" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-toxic px-5 py-3 text-sm font-semibold text-[#17110c] transition hover:bg-[#d1a371]">Open terminal <ArrowUpRight size={16} /></Link>
            <Link href="/search" className="inline-flex min-h-11 items-center rounded-md border border-edge px-5 py-3 text-sm font-semibold text-ink transition hover:border-toxic">Search markets</Link>
          </div>
          <div className="mt-9 grid max-w-lg grid-cols-3 gap-px bg-edge">
            {[['Wallet','Non-custodial'],['Routes','Previewed'],['Sources','Approved']].map(([label, value]) => <div key={label} className="bg-void px-3 py-4"><p className="font-mono text-[9px] uppercase text-dim">{label}</p><p className="mt-1 text-xs font-semibold text-ink">{value}</p></div>)}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.55 }} className="terminal-preview overflow-hidden border border-edge bg-panel shadow-[0_28px_80px_-48px_rgba(0,0,0,.9)]">
          <div className="flex h-11 items-center justify-between border-b border-edge px-4">
            <div className="flex items-center gap-4"><span className="font-mono text-[10px] text-toxic">TERMINAL</span><span className="font-mono text-[10px] text-dim">BONK / SOL</span></div>
            <span className="flex items-center gap-1.5 font-mono text-[9px] text-up"><span className="h-1.5 w-1.5 bg-up" /> LIVE MARKET</span>
          </div>
          <div className="grid min-h-[470px] lg:grid-cols-[1fr_250px]">
            <div className="border-b border-edge lg:border-b-0 lg:border-r">
              <div className="flex items-start justify-between border-b border-edge p-4">
                <div><p className="text-sm font-semibold">BONK <span className="font-normal text-dim">Bonk</span></p><p className="mt-1 font-mono text-xl font-semibold">$0.00002184</p></div>
                <div className="text-right font-mono text-[10px]"><p className="text-up">+8.42%</p><p className="mt-1 text-dim">24H CHANGE</p></div>
              </div>
              <div className="grid grid-cols-3 gap-px border-b border-edge bg-edge">
                {[['LIQUIDITY','$18.4M'],['24H VOLUME','$42.8M'],['MARKET CAP','$1.62B']].map(([k,v]) => <div key={k} className="bg-panel px-4 py-3"><p className="font-mono text-[8px] text-dim">{k}</p><p className="mt-1 font-mono text-xs text-ink">{v}</p></div>)}
              </div>
              <div className="relative h-72 overflow-hidden bg-[#101111] p-5">
                <div className="absolute inset-0 home-chart-grid" />
                <div className="relative flex h-full items-end gap-[5px]">
                  {candles.map((height, index) => <motion.span key={index} initial={{ height: 0 }} animate={{ height }} transition={{ delay: .3 + index * .025, duration: .28 }} className={`relative flex-1 max-w-3 ${index % 4 === 1 ? 'bg-down' : 'bg-up'}`}><i className="absolute left-1/2 top-[-9px] h-[calc(100%+18px)] w-px -translate-x-1/2 bg-current opacity-60" /></motion.span>)}
                </div>
              </div>
              <div className="grid grid-cols-3 border-t border-edge text-center font-mono text-[9px] text-dim"><span className="border-r border-edge py-3 text-toxic">CHART</span><span className="border-r border-edge py-3">HOLDERS</span><span className="py-3">RISK</span></div>
            </div>
            <aside className="p-4">
              <div className="grid grid-cols-2 gap-px bg-edge p-px font-mono text-[10px]"><span className="bg-toxic py-2 text-center font-semibold text-[#17110c]">BUY</span><span className="bg-void py-2 text-center text-dim">SELL</span></div>
              <p className="mt-5 font-mono text-[9px] uppercase text-dim">Amount</p>
              <div className="mt-2 flex items-center justify-between border border-edge bg-void px-3 py-3"><span className="font-mono text-sm">0.50</span><span className="font-mono text-[10px] text-dim">SOL</span></div>
              <div className="mt-2 grid grid-cols-4 gap-1">{['0.1','0.5','1','2'].map(v => <span key={v} className="border border-edge py-2 text-center font-mono text-[9px] text-dim">{v}</span>)}</div>
              <div className="mt-5 space-y-3 border-y border-edge py-4 font-mono text-[9px]"><div className="flex justify-between"><span className="text-dim">EST. RECEIVE</span><span>3.39M BONK</span></div><div className="flex justify-between"><span className="text-dim">SLIPPAGE</span><span>3.0%</span></div><div className="flex justify-between"><span className="text-dim">ROUTE</span><span>JUPITER</span></div></div>
              <div className="mt-4 flex items-center gap-2 text-[10px] text-dim"><ShieldCheck size={14} className="text-up" /> MEV protection enabled</div>
              <Link href="/login" className="mt-5 block w-full rounded-md bg-toxic py-3 text-center text-xs font-semibold text-[#17110c]">Connect wallet to trade</Link>
              <div className="mt-5 grid grid-cols-2 gap-2"><div className="border border-edge p-3"><CandlestickChart size={15} className="text-toxic" /><p className="mt-2 text-[10px] text-dim">Live route preview</p></div><div className="border border-edge p-3"><Bot size={15} className="text-toxic" /><p className="mt-2 text-[10px] text-dim">Source tracking</p></div></div>
            </aside>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
