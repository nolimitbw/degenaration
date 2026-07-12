"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { getCallSources, type CallSource } from "@/lib/queries";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function Groups() {
  const [sources, setSources] = useState<CallSource[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getCallSources().then((rows) => {
      setSources(rows);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  return (
    <section id="groups" className="mx-auto max-w-6xl px-5 py-24">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-grape">Discord source directory</p>
          <h2 className="mt-2 text-4xl font-bold md:text-5xl">
            Follow the <span className="text-grape">signal</span>, not the hype.
          </h2>
          <p className="mt-3 max-w-xl text-haze">
            Every listed source is scored from tracked calls. Review the sample size, hit rate,
            and recorded upside before you choose rules for it.
          </p>
        </div>
        <Link href="/apply" className="font-mono text-sm text-grape underline-offset-4 hover:underline">
          Run a Discord source? Apply to list it -&gt;
        </Link>
      </div>

      {loaded && sources.length === 0 ? (
        <div className="source-empty py-14 text-center">
          <p className="text-sm font-bold text-starlight">No public sources are live yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-haze">
            The directory unlocks when approved callers connect their Discord channels and build a tracked record.
          </p>
          <Link href="/apply" className="btn-ghost mt-6 inline-flex min-h-11 items-center px-5 py-2 text-sm font-bold">
            Apply as a caller
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sources.map((source, index) => (
            <motion.article
              key={source.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05 }}
              className="card-cosmic group flex min-h-64 flex-col p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="source-status">Active source</p>
                  <h3 className="mt-2 text-lg font-bold text-starlight">{source.name}</h3>
                  <p className="mt-1 text-sm text-haze">{source.tag || "Discord call source"}</p>
                </div>
                <span className="font-mono text-xs text-haze">{source.members || "-"} members</span>
              </div>

              <dl className="source-metrics mt-6 grid grid-cols-3 gap-2">
                <Metric label="Tracked" value={String(source.metrics.calls)} />
                <Metric label="Hit rate" value={source.metrics.hitRate == null ? "-" : `${source.metrics.hitRate.toFixed(0)}%`} />
                <Metric label="Best run" value={source.metrics.bestPeakX == null ? "-" : `${source.metrics.bestPeakX.toFixed(2)}x`} />
              </dl>

              <Link
                href="/calls"
                className="mt-auto inline-flex min-h-11 items-center justify-center border border-white/15 px-4 py-2 text-sm font-bold text-haze transition group-hover:border-grape group-hover:text-grape"
              >
                Review calls -&gt;
              </Link>
            </motion.article>
          ))}
        </div>
      )}
    </section>
  );
}
