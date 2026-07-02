"use client";
import Link from "next/link";
import { motion } from "framer-motion";

const FEATURES = [
  { icon: "🔥", title: "Trenches", body: "Live feed of fresh Solana launches and trending tokens, straight from the chain.", href: "/trenches" },
  { icon: "◎", title: "Explorer", body: "A real token screener — Hot, New, Gainers, Top — with live price, MC, liquidity and volume.", href: "/explorer" },
  { icon: "▤", title: "Trading terminal", body: "Pro DexScreener charts, Market/Limit orders, slippage, take-profit and stop-loss.", href: "/terminal" },
  { icon: "★", title: "Alpha leaderboard", body: "Call groups and callers ranked by real on-chain performance. Copy the winners.", href: "/alpha" },
  { icon: "◉", title: "Wallet tracker", body: "Follow top traders' wallets and watch their moves live, on-chain.", href: "/tracker" },
  { icon: "◈", title: "Holdings & PnL", body: "Your portfolio value and trading performance over time, in one dashboard.", href: "/holdings" }
];

export default function Features() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24">
      <h2 className="text-4xl font-bold tracking-tight">
        One terminal. <span className="text-toxic text-glow-toxic">Every edge.</span>
      </h2>
      <p className="mt-3 max-w-xl text-dim">Discover, analyze, copy and trade — all on-chain, all in one place.</p>
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.div key={f.title}
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}>
            <Link href={f.href} className="group block gradient-border h-full rounded-lg border border-edge p-6 transition hover:shadow-toxic">
              <p className="text-2xl">{f.icon}</p>
              <h3 className="mt-3 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">{f.body}</p>
              <p className="mt-3 font-mono text-xs text-toxic opacity-0 transition group-hover:opacity-100">Open →</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
