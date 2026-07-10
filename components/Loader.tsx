"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import RocketGlyph from "@/components/RocketGlyph";

// Minimal launch splash: shows once per session while the app hydrates.
export default function Loader() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("degen-loaded")) { setGone(true); return; }
    sessionStorage.setItem("degen-loaded", "1");
    setTimeout(() => setGone(true), 800);
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
