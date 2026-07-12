"use client";
import { motion } from "framer-motion";

const STEPS = [
  {
    n: "01",
    title: "A caller connects a channel",
    body: "Approved Discord sources add the bot and authorize only their calls channels. The platform records qualifying token calls with a timestamp and entry data."
  },
  {
    n: "02",
    title: "Performance is measured",
    body: "Each call is checked against later market data. The directory shows the tracked sample, 2x hit rate, average peak and best recorded run."
  },
  {
    n: "03",
    title: "You choose your rules",
    body: "Enable only the sources you trust, then set size, take-profit, stop-loss, slippage and daily loss limits independently for each one."
  },
  {
    n: "04",
    title: "Your wallet executes",
    body: "When your enabled source posts a qualified call, your configured rules decide whether to trade. You can edit or pause them at any time."
  }
];

export default function How() {
  return (
    <section id="how" className="relative py-24">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="text-4xl font-bold tracking-tight md:text-5xl">
          From Discord call to <span className="text-grape">controlled trade</span>
        </h2>
        <p className="mt-3 max-w-xl text-haze">A transparent path from caller history to your own per-source execution rules.</p>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="card-cosmic p-6"
            >
              <p className="font-mono text-3xl font-bold text-grape">{s.n}</p>
              <h3 className="mt-3 text-lg font-bold text-starlight">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-haze">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
