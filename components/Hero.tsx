"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import Magnetic from "@/components/Magnetic";
import RevealText from "@/components/RevealText";
import FeeStatus from "@/components/FeeStatus";

export default function Hero() {
  return (
    <section
      id="top"
      className="relative mx-auto grid min-h-dvh max-w-6xl grid-cols-1 items-center px-5 pb-16 pt-32 lg:grid-cols-2 lg:pt-24"
    >
      <div className="relative z-10 text-center lg:text-left">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="hero-kicker mx-auto mb-6 flex w-fit items-center gap-2 px-3 py-2 font-mono text-xs lg:mx-0"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-grape" />
          <span className="text-haze">Measured Discord alpha</span>
        </motion.div>

        <h1 className="text-5xl font-bold leading-[1.02] md:text-6xl">
          <RevealText text="Trade the call." delay={0.15} />
          <br />
          <span className="text-grape">
            <RevealText text="Keep control." delay={0.46} />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-haze lg:mx-0"
        >
          Track caller performance, copy only the sources you trust, and sign every trade from
          <span className="text-starlight"> your own wallet</span>.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.05 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start"
        >
          <Magnetic strength={0.5}>
            <Link href="/calls" className="btn-cosmic group inline-flex min-h-12 items-center px-6 py-3 font-bold">
              Browse Discord calls <span className="ml-2 inline-block transition group-hover:translate-x-1">-&gt;</span>
            </Link>
          </Magnetic>
          <Magnetic strength={0.3}>
            <Link href="/terminal" className="btn-ghost inline-flex min-h-12 items-center px-6 py-3 font-bold">
              Open trading terminal
            </Link>
          </Magnetic>
        </motion.div>

        <motion.dl
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="hero-proof mx-auto mt-8 flex max-w-xl flex-wrap justify-center gap-x-7 gap-y-3 font-mono text-xs lg:mx-0 lg:justify-start"
        >
          <div><dt>Calls</dt><dd>Tracked</dd></div>
          <FeeStatus />
          <div><dt>Custody</dt><dd>Never</dd></div>
        </motion.dl>
      </div>
    </section>
  );
}
