"use client";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useRef, type ReactNode } from "react";

// Wraps a child so it drifts toward the cursor on hover (magnetic buttons).
export default function Magnetic({ children, strength = 0.4, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 150, damping: 20 });
  const y = useSpring(useMotionValue(0), { stiffness: 150, damping: 20 });

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => { x.set(0); y.set(0); };

  return (
    <motion.div
      ref={ref}
      data-magnetic
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x, y }}
      className={`inline-flex ${className}`}
    >
      {children}
    </motion.div>
  );
}
