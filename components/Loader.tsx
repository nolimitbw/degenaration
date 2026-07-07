"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import RocketGlyph from "@/components/RocketGlyph";

// Premium launch loader: counts to 100 while a rocket charges, then reveals the
// page. Shows once per browser session so repeat visits aren't slowed down.
export default function Loader() {
  const [pct, setPct] = useState(0);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("degen-loaded")) { setGone(true); return; }
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(100, p + Math.random() * 14 + 6);
      setPct(Math.round(p));
      if (p >= 100) {
        clearInterval(iv);
        sessionStorage.setItem("degen-loaded", "1");
        setTimeout(() => setGone(true), 450);
      }
    }, 130);
    return () => clearInterval(iv);
  }, []);

  return (
    <AnimatePresence>
      {!gone && (
        <motion.div
          exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }}
          transition={{ duration: 0.7, ease: [0.7, 0, 0.3, 1] }}
          className="fixed inset-0 z-[120] grid place-items-center bg-night"
        >
          <div className="flex flex-col items-center gap-6">
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              className="relative"
            >
              <RocketGlyph size={56} />
            </motion.div>
            <p className="font-mono text-xs tracking-[0.3em] text-haze">PREPARING LAUNCH</p>
            <div className="h-1 w-56 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-grape via-magenta to-ember" style={{ width: `${pct}%` }} />
            </div>
            <p className="font-mono text-sm font-bold text-starlight">{pct}%</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
