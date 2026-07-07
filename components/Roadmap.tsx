"use client";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { useRef } from "react";
import RocketGlyph from "@/components/RocketGlyph";

const STEPS = [
  { q: "Phase 1", title: "The terminal", body: "Live trenches, token screener, pro charts and a non-custodial wallet." },
  { q: "Phase 2", title: "Copy engine", body: "Automated alpha copy-trading with take-profit, stop-loss and per-group sizing." },
  { q: "Phase 3", title: "Alpha leaderboard", body: "Call groups ranked by verified on-chain performance — copy the winners." },
  { q: "Phase 4", title: "Everywhere", body: "Mobile app, more alpha sources and deeper portfolio analytics." }
];

export default function Roadmap() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });
  const width = useTransform(p, [0, 1], ["0%", "100%"]);
  const left = useTransform(p, [0, 1], ["0%", "100%"]);

  return (
    <section id="roadmap" ref={ref} className="mx-auto max-w-6xl px-5 py-24">
      <h2 className="text-4xl font-bold tracking-tight md:text-5xl">The <span className="cosmic-text">launch</span> trajectory</h2>
      <p className="mt-3 max-w-xl text-haze">Where Degenaration is headed. The rocket moves as you scroll.</p>

      {/* horizontal timeline (md+) */}
      <div className="relative mt-24 hidden md:block">
        <div className="absolute left-0 right-0 top-0 h-0.5 rounded-full bg-white/10" />
        <motion.div style={{ width }} className="absolute left-0 top-0 h-0.5 rounded-full bg-gradient-to-r from-grape via-magenta to-ember" />
        <motion.div style={{ left }} className="absolute -top-8 -translate-x-1/2">
          <span className="block rotate-[38deg]"><RocketGlyph size={26} /></span>
        </motion.div>

        <div className="grid grid-cols-4">
          {STEPS.map((s, i) => (
            <motion.div key={s.q}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
              className="relative pt-8">
              <span className="absolute -top-[7px] left-0 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-grape bg-night" />
              <div className="pr-6">
                <p className="font-mono text-xs text-grape">{s.q}</p>
                <h3 className="mt-2 text-lg font-bold text-starlight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-haze">{s.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* vertical timeline (mobile) */}
      <div className="mt-12 space-y-5 md:hidden">
        {STEPS.map((s) => (
          <div key={s.q} className="card-cosmic p-5">
            <p className="font-mono text-xs text-grape">{s.q}</p>
            <h3 className="mt-1 text-lg font-bold text-starlight">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-haze">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
