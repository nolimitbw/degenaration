"use client";
import Link from "next/link";
import { motion } from "framer-motion";

export default function Cta() {
  return (
    <section id="cta" className="grid-bg relative overflow-hidden py-28">
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.1, 0.18, 0.1] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-toxic/10 blur-[120px]"
      />
      <div className="relative mx-auto max-w-3xl px-5 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-4xl font-bold tracking-tight md:text-6xl"
        >
          The calls fire while you&apos;re <span className="text-toxic text-glow-toxic">asleep</span>.
          <br />Now your wallet doesn&apos;t miss them.
        </motion.h2>
        <p id="fees" className="mx-auto mt-6 max-w-xl text-dim">
          Free to create an account. No subscription, no hidden spread. A flat{" "}
          <span className="font-mono text-white">2%</span> is taken on-chain on each trade in
          and out — fully transparent, and only when you actually trade.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href="/onboarding" className="rounded-md bg-toxic px-10 py-4 text-lg font-bold text-void shadow-toxic transition hover:scale-[1.03]">
            Create your account
          </Link>
          <Link href="/trenches" className="rounded-md border border-edge bg-panel px-8 py-4 font-bold text-white transition hover:border-toxic">
            Explore Trenches
          </Link>
        </div>
      </div>
    </section>
  );
}
