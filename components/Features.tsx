"use client";
import Link from "next/link";
import { motion } from "framer-motion";

const FEATURES = [
  { code: "01", title: "Trenches", body: "Live feed of fresh Solana launches and trending tokens, straight from the chain.", href: "/trenches" },
  { code: "02", title: "Explorer", body: "A real token screener with live price, MC, liquidity and volume.", href: "/explorer" },
  { code: "03", title: "Trading terminal", body: "DexScreener charts, Market and Limit orders, slippage, take-profit and stop-loss.", href: "/terminal" },
  { code: "04", title: "Discord calls", body: "Sources ranked by independently tracked call performance. Choose only the ones you trust.", href: "/calls" },
  { code: "05", title: "Wallet tracker", body: "Follow top traders' wallets and watch their moves live, on-chain.", href: "/tracker" },
  { code: "06", title: "Holdings & PnL", body: "Your portfolio value and trading performance over time, in one dashboard.", href: "/holdings" }
];

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24">
      <motion.h2
        initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="text-4xl font-bold tracking-tight md:text-5xl"
      >
        One terminal. <span className="text-grape">Every edge.</span>
      </motion.h2>
      <p className="mt-3 max-w-xl text-haze">Discover, analyze, copy and trade — all on-chain, all in one place.</p>

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, index) => (
          <motion.div key={f.title}
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.06 }}>
            <Link href={f.href} className="card-cosmic group flex h-full flex-col p-7">
              <span className="feature-code">{f.code}</span>
              <h3 className="mt-4 text-lg font-bold text-starlight">{f.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-haze">{f.body}</p>
              <p className="mt-4 font-mono text-xs text-grape opacity-0 transition group-hover:opacity-100">Open -&gt;</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
