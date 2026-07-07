"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import Magnetic from "@/components/Magnetic";

// Slow, subtle metallic coin specks drifting down (deterministic — no Math.random).
const RAIN = [
  { l: "6%", d: 0, dur: 13, s: 10, a: "#c9ffdb", b: "#1f8f5a" },
  { l: "16%", d: 2.4, dur: 16, s: 7, a: "#ffffff", b: "#8fb8a0" },
  { l: "27%", d: 1.1, dur: 14, s: 12, a: "#eafff2", b: "#3fb87e" },
  { l: "38%", d: 3.6, dur: 15, s: 6, a: "#c9ffdb", b: "#1f8f5a" },
  { l: "49%", d: 0.6, dur: 17, s: 9, a: "#ffe6a8", b: "#a9741f" },
  { l: "60%", d: 2.0, dur: 13, s: 8, a: "#c9ffdb", b: "#1f8f5a" },
  { l: "71%", d: 4.2, dur: 16, s: 11, a: "#ffffff", b: "#8fb8a0" },
  { l: "82%", d: 1.4, dur: 14, s: 7, a: "#eafff2", b: "#3fb87e" },
  { l: "92%", d: 3.0, dur: 15, s: 9, a: "#ffe6a8", b: "#a9741f" },
  { l: "45%", d: 5.0, dur: 18, s: 6, a: "#c9ffdb", b: "#1f8f5a" }
];

export default function Cta() {
  return (
    <section id="cta" className="relative overflow-hidden py-28">
      {/* coin rain */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {RAIN.map((r, i) => (
          <span
            key={i}
            className="absolute -top-12 rounded-full"
            style={{ left: r.l, width: r.s, height: r.s, opacity: 0.5, background: `radial-gradient(circle at 32% 28%, ${r.a}, ${r.b})`, boxShadow: `0 0 8px ${r.b}66`, animation: `coin-rain ${r.dur}s linear ${r.d}s infinite` }}
          />
        ))}
      </div>

      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.18, 0.3, 0.18] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-magenta/20 blur-[120px]"
      />

      <div className="relative z-10 mx-auto max-w-3xl px-5 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-4xl font-bold tracking-tight md:text-6xl"
        >
          The calls fire while you&apos;re <span className="cosmic-text">asleep</span>.
          <br />Now your wallet doesn&apos;t miss them.
        </motion.h2>
        <p id="fees" className="mx-auto mt-6 max-w-xl text-haze">
          Free to create an account. No subscription, no hidden spread. A flat{" "}
          <span className="font-mono text-starlight">2%</span> is taken on-chain on each trade in
          and out — fully transparent, and only when you actually trade.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Magnetic strength={0.5}>
            <Link href="/onboarding" className="btn-cosmic px-10 py-4 text-lg font-bold">Create your account</Link>
          </Magnetic>
          <Magnetic strength={0.3}>
            <Link href="/trenches" className="btn-ghost px-8 py-4 font-bold">Explore Trenches</Link>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}
