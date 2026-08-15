"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Radio, ShieldCheck } from "lucide-react";

export default function Hero() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="home-hero-shell mx-auto max-w-[1480px] px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
      <div className="home-poster overflow-hidden border border-edge bg-panel">
        <div className="grid min-h-[720px] lg:grid-cols-[minmax(0,.88fr)_minmax(520px,1.12fr)]">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: [0.2, 0.75, 0.2, 1] }}
            className="relative z-10 flex flex-col justify-between px-6 py-10 sm:px-10 sm:py-12 lg:px-14 lg:py-16"
          >
            <div>
              <div className="ui-label inline-flex min-h-10 items-center gap-2 border border-edge bg-void/75 px-3 text-ink">
                <Radio aria-hidden="true" size={14} className="text-up" />
                Solana automation workspace
              </div>
              <h1 className="home-poster-title mt-8 max-w-[760px] font-black uppercase text-ink">
                Catch calls.
                <span className="block text-gold-400">Launch bots.</span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-dim sm:text-lg sm:leading-8">
                Turn reviewed Discord sources and live market signals into bounded trading strategies, then follow every position from one portfolio.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/bots" className="inline-flex min-h-12 items-center gap-2 bg-gold-400 px-6 py-3 text-sm font-bold text-[#17110c] transition hover:brightness-110">
                  Build a bot <ArrowUpRight aria-hidden="true" size={17} />
                </Link>
                <Link href="#how-it-works" className="inline-flex min-h-12 items-center border border-edge bg-void/60 px-6 py-3 text-sm font-semibold text-ink transition hover:border-gold-400">
                  How it works
                </Link>
              </div>
            </div>

            <div className="mt-16 grid gap-px border border-edge bg-edge sm:grid-cols-3 lg:max-w-2xl">
              {[["01", "Pick a source"], ["02", "Set your rules"], ["03", "Track every move"]].map(([number, label]) => (
                <div key={number} className="bg-void/90 p-4">
                  <span className="font-mono text-[11px] text-gold-400">{number}</span>
                  <p className="mt-2 text-sm font-semibold text-ink">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 1.035 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.75, ease: [0.2, 0.75, 0.2, 1] }}
            className="home-rocket-frame relative min-h-[440px] overflow-hidden border-t border-edge lg:min-h-0 lg:border-l lg:border-t-0"
          >
            <img src="/images/rocket-launch-hero.png" alt="A rocket launching into space" className="home-rocket-image absolute inset-0 h-full w-full object-cover" />
            <div className="home-rocket-grade absolute inset-0" />
            <div className="absolute inset-x-5 bottom-5 border border-white/15 bg-void/75 p-4 backdrop-blur-md sm:inset-x-8 sm:bottom-8 sm:p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-gold-400" />
                <div>
                  <p className="text-sm font-bold text-ink">Built for controlled execution</p>
                  <p className="mt-1 text-xs leading-5 text-dim">Capital limits, safety filters, and position history stay attached to each bot.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
