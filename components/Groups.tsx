"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { getApprovedGroups, type Group } from "@/lib/queries";

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { getApprovedGroups().then((g) => { setGroups(g); setLoaded(true); }); }, []);

  return (
    <section id="groups" className="mx-auto max-w-6xl px-5 py-24">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold tracking-tight md:text-5xl">Approved <span className="cosmic-text">call groups</span></h2>
          <p className="mt-3 max-w-xl text-haze">Every group is vetted and its call history tracked on-chain before it appears here. Real, verifiable performance — never screenshots.</p>
        </div>
        <Link href="/apply" className="font-mono text-sm text-grape underline-offset-4 hover:underline">Own a call group? Apply to get listed →</Link>
      </div>
      {loaded && groups.length === 0 ? (
        <div className="glass-cosmic grid place-items-center rounded-2xl py-16 text-center">
          <p className="text-sm font-bold text-haze">Call groups launching soon</p>
          <p className="mt-1 max-w-md font-mono text-[11px] text-haze/70">We&apos;re onboarding vetted groups now. Be the first — apply to list your server.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g, i) => (
            <motion.div key={g.id}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
              className="card-cosmic group p-6">
              <h3 className="text-lg font-bold text-starlight">{g.name}</h3>
              <p className="mt-1 font-mono text-xs text-haze">{g.members} members · {g.win_rate ?? "—"}% win · <span className={(g.pnl_30d ?? "").startsWith("+") ? "text-up" : "text-haze"}>{g.pnl_30d ?? "new"}</span></p>
              <Link href="/onboarding" className="mt-5 block w-full rounded-xl border border-white/10 py-2.5 text-center text-sm font-bold text-haze transition group-hover:border-grape/60 group-hover:text-grape">Copy this group</Link>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
