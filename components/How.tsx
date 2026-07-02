"use client";
import { motion } from "framer-motion";

const STEPS = [
  {
    n: "01",
    title: "Connect or create a wallet",
    body: "Sign in with Google or email and spin up an embedded Solana wallet in seconds, or connect Phantom. Your private key never leaves your control — Degenaration receives trade-only permission, capped and revocable."
  },
  {
    n: "02",
    title: "Choose your alpha groups",
    body: "Browse Discord call groups with on-chain-verified track records. Subscribe to the ones whose edge you trust, and tune each independently."
  },
  {
    n: "03",
    title: "Define your risk rules",
    body: "Set position size, take-profit ladders, stop-loss and max slippage per group. Every call is screened for liquidity, mint authority and honeypot traits before a lamport moves."
  },
  {
    n: "04",
    title: "Trade on autopilot",
    body: "Calls execute from your wallet in under two seconds, around the clock. Monitor every position live and pause the entire engine with one click."
  }
];

export default function How() {
  return (
    <section id="how" className="border-y border-edge bg-panel/40 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="text-4xl font-bold tracking-tight">
          From call to trade in <span className="text-hotpink text-glow-pink">seconds</span>
        </h2>
        <p className="mt-3 max-w-xl text-dim">Four steps to a fully automated, risk-managed trading setup.</p>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="rounded-lg border border-edge bg-void p-6 transition hover:border-hotpink/40"
            >
              <p className="font-mono text-sm text-hotpink">{s.n}</p>
              <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
