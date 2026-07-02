"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { fetchTokens } from "@/lib/queries";

const POS = [
  { x: "8%", y: "20%", d: 0 }, { x: "82%", y: "16%", d: 0.4 },
  { x: "88%", y: "58%", d: 0.8 }, { x: "5%", y: "62%", d: 1.2 }
];
const FALLBACK = [
  { t: "$BONK", p: "live" }, { t: "$WIF", p: "live" }, { t: "$POPCAT", p: "live" }, { t: "$PNUT", p: "live" }
];

export default function Hero() {
  const [floaters, setFloaters] = useState(FALLBACK.map((f, i) => ({ ...f, ...POS[i] })));
  useEffect(() => {
    let alive = true;
    fetchTokens("trending").then((toks) => {
      if (!alive) return;
      const top = (toks || []).filter((x: any) => x.symbol && x.change24h != null).slice(0, 4);
      if (top.length === 4) setFloaters(top.map((x: any, i: number) => ({
        t: "$" + String(x.symbol).toUpperCase().slice(0, 8),
        p: `${x.change24h >= 0 ? "+" : ""}${Number(x.change24h).toFixed(0)}%`,
        ...POS[i]
      })));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return (
    <section className="grid-bg relative overflow-hidden pb-24 pt-40">
      {/* animated glow orbs */}
      <motion.div
        animate={{ x: [0, 40, 0], y: [0, -20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[720px] -translate-x-1/2 rounded-full bg-cyber/20 blur-[140px]"
      />
      <motion.div
        animate={{ x: [0, -30, 0], y: [0, 30, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute bottom-0 right-1/4 h-72 w-[480px] rounded-full bg-toxic/10 blur-[130px]"
      />

      {/* floating live-token cards (desktop) */}
      {floaters.map((f) => (
        <motion.div
          key={f.t}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1, y: [0, -12, 0] }}
          transition={{ opacity: { delay: 0.8 + f.d }, y: { duration: 4 + f.d, repeat: Infinity, ease: "easeInOut" } }}
          style={{ left: f.x, top: f.y }}
          className="pointer-events-none absolute hidden rounded-lg border border-edge bg-panel/80 px-4 py-2.5 backdrop-blur-sm lg:block"
        >
          <p className="font-mono text-sm font-bold">{f.t}</p>
          <p className={`font-mono text-xs ${f.p.startsWith("-") ? "text-hotpink" : "text-toxic"}`}>{f.p}</p>
        </motion.div>
      ))}

      <div className="relative mx-auto max-w-6xl px-5 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border border-edge bg-panel px-4 py-1.5 font-mono text-xs"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-toxic opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-toxic" />
          </span>
          <span className="text-dim">Non-custodial · your keys, your coins</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mx-auto max-w-4xl text-5xl font-bold leading-[1.03] tracking-tight md:text-7xl"
        >
          The best alpha calls,{" "}
          <span className="relative whitespace-nowrap">
            <span className="gradient-text">traded for you.</span>
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-dim"
        >
          Degenaration connects to vetted Discord alpha groups and executes their calls
          from your own wallet in under two seconds — with the take-profit, stop-loss and
          position sizing rules <span className="text-white">you</span> set. Automated,
          audited, and non-custodial by design.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link href="/onboarding" className="group rounded-md bg-toxic px-7 py-3.5 font-bold text-void shadow-toxic transition hover:scale-[1.03]">
            Start trading <span className="inline-block transition group-hover:translate-x-1">→</span>
          </Link>
          <Link href="/trenches" className="rounded-md border border-edge bg-panel px-7 py-3.5 font-bold text-white transition hover:border-toxic">
            Explore Trenches
          </Link>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-6 font-mono text-xs text-dim"
        >
          Free to join · 2% per trade · withdraw anytime — we can never touch your funds
        </motion.p>
      </div>
    </section>
  );
}
