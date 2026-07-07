"use client";
import { motion } from "framer-motion";

// Word-by-word rise-in reveal. Splits on spaces and staggers each word.
export default function RevealText({ text, className = "", delay = 0, stagger = 0.06 }: { text: string; className?: string; delay?: number; stagger?: number }) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: "110%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{ delay: delay + i * stagger, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </span>
  );
}
