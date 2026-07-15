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
  const rocketX = useTransform(scrollYProgress, [0, 0.28, 0.62, 0.86, 0.94], reduceMotion ? ["0vw", "0vw", "0vw", "0vw", "0vw"] : ["15vw", "7vw", "-4vw", "-10vw", "-10vw"]);
  const rocketY = useTransform(scrollYProgress, [0, 0.28, 0.62, 0.86, 0.94], reduceMotion ? ["0vh", "0vh", "0vh", "0vh", "0vh"] : ["31vh", "12vh", "-14vh", "-39vh", "-42vh"]);
  const rocketRotate = useTransform(scrollYProgress, [0, 0.55, 0.86, 0.94], reduceMotion ? [-18, -18, -18, -18] : [-20, -9, 8, 18]);
  const rocketOpacity = useTransform(scrollYProgress, [0, 0.06, 0.82, 0.93, 0.97], reduceMotion ? [0, 0, 0, 0, 0] : [0, 0.98, 0.92, 0.2, 0]);
  const rocketScale = useTransform(scrollYProgress, [0, 0.62, 0.9, 0.96], reduceMotion ? [1, 1, 1, 1] : [0.82, 1.1, 0.78, 0.28]);
  const bombOpacity = useTransform(scrollYProgress, [0.84, 0.93, 1], reduceMotion ? [0, 0, 0] : [0, 0.82, 1]);
  const bombY = useTransform(scrollYProgress, [0.84, 1], reduceMotion ? [24, 24] : [86, 0]);
  const bombScale = useTransform(scrollYProgress, [0.84, 0.95, 1], reduceMotion ? [1, 1, 1] : [0.54, 0.94, 1.08]);

  return (
    <>
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
        <div className="launch-video-scrim" />
      </div>
      <motion.div className="launch-bomb" style={{ opacity: bombOpacity, y: bombY, scale: bombScale }}>
        <span className="launch-bomb-core" />
        <span className="launch-bomb-spark" />
        <span className="launch-bomb-ring" />
      </motion.div>
    </>
  );
}
