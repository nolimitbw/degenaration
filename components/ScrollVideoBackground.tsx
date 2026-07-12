"use client";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import RocketGlyph from "@/components/RocketGlyph";

// The former scroll-scrubbed 640px video was visibly soft after its watermark crop.
// This high-resolution launch visual stays sharp while the layer moves with scroll.
export default function ScrollVideoBackground() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 0.72, 1], reduceMotion ? ["0%", "0%", "0%"] : ["0%", "-13%", "-23%"]);
  const scale = useTransform(scrollYProgress, [0, 1], reduceMotion ? [1, 1] : [1.02, 1.14]);
  const opacity = useTransform(scrollYProgress, [0, 0.78, 1], [1, 0.92, 0.52]);
  const rocketX = useTransform(scrollYProgress, [0, 0.35, 0.72, 0.9], reduceMotion ? ["0vw", "0vw", "0vw", "0vw"] : ["12vw", "4vw", "-7vw", "-12vw"]);
  const rocketY = useTransform(scrollYProgress, [0, 0.35, 0.72, 0.9], reduceMotion ? ["0vh", "0vh", "0vh", "0vh"] : ["23vh", "3vh", "-24vh", "-38vh"]);
  const rocketRotate = useTransform(scrollYProgress, [0, 0.72, 0.9], reduceMotion ? [-18, -18, -18] : [-18, -8, 12]);
  const rocketOpacity = useTransform(scrollYProgress, [0, 0.08, 0.76, 0.9], reduceMotion ? [0, 0, 0, 0] : [0, 0.95, 0.8, 0]);
  const rocketScale = useTransform(scrollYProgress, [0, 0.72, 0.9], reduceMotion ? [1, 1, 1] : [0.92, 1.08, 0.68]);
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
      <motion.div
        className="launch-rocket-traveller"
        style={{ x: rocketX, y: rocketY, rotate: rocketRotate, opacity: rocketOpacity, scale: rocketScale }}
      >
        <RocketGlyph size={72} />
        <span className="launch-rocket-trail" />
      </motion.div>
      <motion.div className="launch-bomb" style={{ opacity: bombOpacity, y: bombY }}>
        <span className="launch-bomb-core" />
        <span className="launch-bomb-ring" />
      </motion.div>
      <div className="launch-video-scrim" />
    </div>
  );
}
