"use client";
import Link from "next/link";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useState } from "react";
import { fetchTokens } from "@/lib/queries";
import Magnetic from "@/components/Magnetic";
import RevealText from "@/components/RevealText";

export default function Hero() {
  // Floating price chips populate only from real trending data — nothing fabricated up front.
  const [chips, setChips] = useState<{ t: string; p: string }[]>([]);
  // subtle parallax applied to the floating live-price chips
  const px = useSpring(useMotionValue(0), { stiffness: 60, damping: 20 });
  const py = useSpring(useMotionValue(0), { stiffness: 60, damping: 20 });
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: MouseEvent) => {
      px.set((e.clientX / window.innerWidth - 0.5) * 26);
      py.set((e.clientY / window.innerHeight - 0.5) * 20);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [px, py]);
  useEffect(() => {
    let alive = true;
    fetchTokens("trending").then((toks) => {
      if (!alive) return;
      const top = (toks || []).filter((x: any) => x.symbol && x.change24h != null).slice(0, 2);
      if (top.length === 2) setChips(top.map((x: any) => ({
        t: "$" + String(x.symbol).toUpperCase().slice(0, 8),
        p: `${x.change24h >= 0 ? "+" : ""}${Number(x.change24h).toFixed(0)}%`
      })));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <section id="top" className="relative mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-10 px-5 pb-16 pt-32 lg:grid-cols-2 lg:pt-24">
      {/* left: copy */}
      <div className="relative z-10 text-center lg:text-left">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-cosmic mx-auto mb-6 flex w-fit items-center gap-2 rounded-full px-4 py-1.5 font-mono text-xs lg:mx-0"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-grape opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-grape" />
          </span>
          <span className="text-haze">Non-custodial · your keys, your coins</span>
        </motion.div>

        <h1 className="text-5xl font-bold leading-[1.02] tracking-tight md:text-7xl">
          <RevealText text="The best alpha calls," delay={0.15} />
          <br />
          <span className="cosmic-text">
            <RevealText text="traded for you." delay={0.5} />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}
          className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-haze lg:mx-0"
        >
          Degenaration copies vetted Discord alpha groups and fires their calls from
          <span className="text-starlight"> your own wallet</span> in under two seconds — with the
          take-profit, stop-loss and sizing rules you set. Automated and non-custodial by design.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start"
        >
          <Magnetic strength={0.5}>
            <Link href="/onboarding" className="btn-cosmic group px-8 py-3.5 font-bold">
              Start trading <span className="inline-block transition group-hover:translate-x-1">→</span>
            </Link>
          </Magnetic>
          <Magnetic strength={0.3}>
            <Link href="/trenches" className="btn-ghost px-8 py-3.5 font-bold">Explore Trenches</Link>
          </Magnetic>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.25 }}
          className="mt-6 font-mono text-xs text-haze/80"
        >
          Free to join · 2% per trade · withdraw anytime — we can never touch your funds
        </motion.p>
      </div>

      {/* right: negative space — the full-page launch video reads through here.
          Live price chips float over it; no competing foreground mesh. */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 1.2 }}
        style={{ x: px, y: py }}
        className="relative z-10 lg:min-h-[30rem]"
      >
        {chips.map((c, i) => (
          <motion.div
            key={c.t}
            initial={{ opacity: 0 }} animate={{ opacity: 1, y: [0, -10, 0] }}
            transition={{ opacity: { delay: 1 + i * 0.2 }, y: { duration: 7 + i * 1.5, repeat: Infinity, ease: "easeInOut" } }}
            className={`glass-cosmic pointer-events-none absolute hidden rounded-xl px-3.5 py-2 sm:block ${i === 0 ? "left-[10%] top-10" : "bottom-16 right-[8%]"}`}
          >
            <p className="font-mono text-sm font-bold text-starlight">{c.t}</p>
            <p className={`font-mono text-xs ${c.p.startsWith("-") ? "text-down" : "text-up"}`}>{c.p}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
