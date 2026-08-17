"use client";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

export default function Hero() {
  const reduced = useReducedMotion();
  return <section className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:pb-20 sm:pt-16">
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(380px,.72fr)] lg:gap-14">
      <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45 }}>
        <p className="ui-label text-gold-400">Solana trading automation</p>
        <h1 className="home-hero-title mt-5 max-w-4xl font-black uppercase text-ink">Turn calls into <span className="text-gold-400">trades.</span></h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-dim sm:text-lg sm:leading-8">Build bots from reviewed Discord calls or live market rules, set the risk, and follow every position from one portfolio.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/bots" className="inline-flex min-h-12 items-center gap-2 rounded-md bg-gold-400 px-6 py-3 text-sm font-bold text-[#17110c] transition hover:brightness-110">Build a bot <ArrowUpRight aria-hidden="true" size={17} /></Link>
          <Link href="#how-it-works" className="inline-flex min-h-12 items-center rounded-md border border-edge px-6 py-3 text-sm font-semibold text-ink transition hover:border-gold-400">How it works</Link>
        </div>
        <div className="mt-8 flex max-w-xl items-start gap-3 border-t border-edge pt-5 text-xs leading-5 text-dim"><ShieldCheck aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-up" />You set the capital limits. Every execution, fee, and outcome stays in your account history.</div>
      </motion.div>
      <motion.div initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .55 }} className="relative mx-auto w-full max-w-[520px] self-end">
        <div className="absolute inset-x-[12%] bottom-[4%] h-[22%] rounded-full bg-gold-400/10 blur-3xl" aria-hidden="true" />
        <Image src="/images/degenaration-ape-hero.png" alt="DegenAration ape wearing a branded black shirt" width={1230} height={1278} priority className="relative h-auto w-full" />
      </motion.div>
    </div>
  </section>;
}
