"use client";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

// The former scroll-scrubbed 640px video was visibly soft after its watermark crop.
// This high-resolution launch visual stays sharp while the layer moves with scroll.
export default function ScrollVideoBackground() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 0.72, 1], reduceMotion ? ["0%", "0%", "0%"] : ["0%", "-13%", "-23%"]);
  const scale = useTransform(scrollYProgress, [0, 1], reduceMotion ? [1, 1] : [1.02, 1.14]);
  const opacity = useTransform(scrollYProgress, [0, 0.78, 1], [1, 0.92, 0.52]);
  const bombOpacity = useTransform(scrollYProgress, [0.72, 0.9, 1], reduceMotion ? [0, 0, 0] : [0, 0.25, 1]);
  const bombY = useTransform(scrollYProgress, [0.72, 1], reduceMotion ? [24, 24] : [64, 0]);

  return (
    <div className="launch-video-wrap" aria-hidden="true">
      <motion.img
        className="launch-video"
        src="/images/rocket-launch-hero.png"
        alt=""
        decoding="async"
        fetchPriority="high"
        style={{ y, scale, opacity }}
      />
      <motion.div className="launch-bomb" style={{ opacity: bombOpacity, y: bombY }}>
        <span className="launch-bomb-core" />
        <span className="launch-bomb-ring" />
      </motion.div>
      <div className="launch-video-scrim" />
    </div>
  );
}
