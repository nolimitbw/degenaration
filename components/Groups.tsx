"use client";
import Link from "next/link";
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
          <h2 className="text-4xl font-bold tracking-tight">Approved <span className="text-cyber">call groups</span></h2>
          <p className="mt-2 max-w-xl text-dim">Every group is vetted and its call history tracked on-chain before it appears here. Real, verifiable performance — never screenshots.</p>
        </div>
        <Link href="/apply" className="font-mono text-sm text-toxic underline-offset-4 hover:underline">Own a call group? Apply to get listed →</Link>
      </div>
      {loaded && groups.length === 0 ? (
        <div className="grid place-items-center rounded-lg border border-edge bg-panel/40 py-14 text-center">
          <p className="text-sm font-bold text-dim">Call groups launching soon</p>
          <p className="mt-1 max-w-md font-mono text-[11px] text-dim/70">We&apos;re onboarding vetted groups now. Be the first — apply to list your server.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.id} className="group gradient-border rounded-lg border border-edge p-5 transition hover:shadow-toxic">
              <h3 className="text-lg font-bold">{g.name}</h3>
              <p className="mt-0.5 font-mono text-xs text-dim">{g.members} members · {g.win_rate ?? "—"}% win · <span className={(g.pnl_30d??"").startsWith("+")?"text-toxic":"text-dim"}>{g.pnl_30d ?? "new"}</span></p>
              <Link href="/onboarding" className="mt-5 block w-full rounded-md border border-edge py-2.5 text-center text-sm font-bold text-dim transition group-hover:border-toxic group-hover:text-toxic">Copy this group</Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
