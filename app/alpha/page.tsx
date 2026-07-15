"use client";
import AppShell from "@/components/AppShell";
import { ImageDown } from "lucide-react";
import { useEffect, useState } from "react";

type View = "groups" | "calls" | "callers";
const rank = (i: number) => {
  if (i === 0) return <span className="text-gold font-bold">#1</span>;
  if (i === 1) return <span className="text-dim font-bold">#2</span>;
  if (i === 2) return <span className="text-dim font-bold">#3</span>;
  return <span className="text-dim/60">#{i + 1}</span>;
};

export default function Alpha() {
  const [view, setView] = useState<View>("groups");
  const [tf, setTf] = useState("1d");
  const [data, setData] = useState<{ calls: any[]; groups: any[]; callers: any[] } | null>(null);

  useEffect(() => {
    const params = tf !== "1d" ? `?tf=${tf}` : "";
    fetch(`/api/calls${params}`).then((r) => r.json()).then(setData).catch(() => setData({ calls: [], groups: [], callers: [] }));
  }, [tf]);

  const list = view === "groups" ? data?.groups : view === "callers" ? data?.callers : data?.calls;
  const empty = !data || !list || list.length === 0;

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Alpha leaderboard</h1>
          <p className="mt-1 text-sm text-dim">Groups and callers ranked by real recorded on-chain performance.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/leaderboard-image" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-edge px-3 font-mono text-xs text-dim transition hover:border-toxic/60 hover:text-toxic"><ImageDown aria-hidden="true" size={15} /> Weekly image</a>
          {["1h","1d","7d","30d"].map((t) => <button key={t} onClick={() => setTf(t)} className={`rounded-md border px-3 py-1.5 font-mono text-xs transition ${tf===t?"border-toxic text-toxic":"border-edge text-dim hover:text-ink"}`}>{t}</button>)}
        </div>
      </div>
      <div className="mt-6 flex gap-1 rounded-md border border-edge p-1 font-mono text-xs w-fit">
        {(["groups","calls","callers"] as View[]).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded px-4 py-2 font-bold transition ${view===v?"bg-toxic text-white":"text-dim hover:text-ink"}`}>{v.toUpperCase()}</button>)}
      </div>

      {empty ? (
        <div className="mt-4 grid place-items-center rounded-lg border border-edge bg-panel/40 py-16 text-center">
          <p className="text-sm font-bold text-dim">No {view} ranked yet</p>
          <p className="mt-1 max-w-md font-mono text-[11px] text-dim/70">Real data only — rankings populate automatically as approved Discord groups post calls and the engine records their on-chain results.</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-edge">
          {view === "calls" ? (
            <table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-panel font-mono text-[11px] uppercase text-dim"><tr>{["#","Caller","Group","Token","Called MC","Peak"].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>{data!.calls.map((c, i) => (<tr key={c.id} className="border-t border-edge font-mono text-xs"><td className="px-4 py-3">{rank(i)}</td><td className="px-4 py-3 font-bold">{c.caller ?? "—"}</td><td className="px-4 py-3 text-dim">{c.group_name ?? "—"}</td><td className="px-4 py-3">{c.symbol ?? c.mint.slice(0,6)}</td><td className="px-4 py-3 text-dim">{c.called_mcap ? "$"+Math.round(c.called_mcap).toLocaleString() : "—"}</td><td className="px-4 py-3 font-bold text-up">{c.peakX ? c.peakX.toFixed(1)+"x" : "—"}</td></tr>))}</tbody>
            </table>
          ) : (
            <table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-panel font-mono text-[11px] uppercase text-dim"><tr>{["#","Name","Points","Avg peak","2x hit rate","Calls","Best"].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>{(list as any[]).map((g, i) => (<tr key={`${g.name}-${i}`} className="border-t border-edge font-mono text-xs"><td className="px-4 py-3">{rank(i)}</td><td className="px-4 py-3 font-bold">{g.name}</td><td className="px-4 py-3 text-cyber">{g.points.toFixed(0)}</td><td className="px-4 py-3 text-up">{g.avgX.toFixed(2)}x</td><td className="px-4 py-3">{g.hitRate.toFixed(0)}%</td><td className="px-4 py-3 text-dim">{g.calls}</td><td className="px-4 py-3 text-up">{g.bestX.toFixed(1)}x</td></tr>))}</tbody>
            </table>
          )}
        </div>
      )}
    </AppShell>
  );
}
