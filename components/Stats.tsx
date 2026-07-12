"use client";
import { motion } from "framer-motion";
import FeeStatus from "@/components/FeeStatus";

const STATS = [
  { value: "Non-custodial", label: "Your wallet remains yours" },
  { value: "Per source", label: "Independent rules and caps" },
  { value: "Tracked", label: "Call-performance records" }
];

export default function Stats() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-cosmic rounded-lg px-6 py-8 text-center transition hover:border-grape/50"
        >
          <FeeStatus variant="stat" />
        </motion.div>
        {STATS.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: (index + 1) * 0.08 }}
            className="glass-cosmic rounded-lg px-6 py-8 text-center transition hover:border-grape/50"
          >
            <p className="text-xl font-bold text-grape md:text-2xl">{stat.value}</p>
            <p className="mt-2 text-sm text-haze">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
