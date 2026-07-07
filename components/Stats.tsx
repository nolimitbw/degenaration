"use client";
import { motion, useInView, useMotionValue, animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// Honest product facts only — no fabricated traction/volume metrics on a money site.
const STATS = [
  { label: "Flat fee — no subscription", prefix: "", value: 2, suffix: "%", decimals: 0 },
  { label: "Non-custodial — your keys", prefix: "", value: 100, suffix: "%", decimals: 0 },
  { label: "Avg trade execution", prefix: "<", value: 2, suffix: "s", decimals: 0 },
  { label: "Automated copy engine", prefix: "", value: 24, suffix: "/7", decimals: 0 }
];

function Counter({ value, decimals }: { value: number; decimals: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const [text, setText] = useState("0");
  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, { duration: 1.4, ease: "easeOut" });
    const unsub = mv.on("change", (v) =>
      setText(v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }))
    );
    return () => { controls.stop(); unsub(); };
  }, [inView, value, decimals, mv]);
  return <span ref={ref}>{text}</span>;
}

export default function Stats() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="glass-cosmic rounded-2xl px-6 py-8 text-center transition hover:border-grape/30"
          >
            <p className="font-mono text-4xl font-bold">
              <span className="cosmic-text">{s.prefix}<Counter value={s.value} decimals={s.decimals} />{s.suffix}</span>
            </p>
            <p className="mt-2 text-sm text-haze">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
