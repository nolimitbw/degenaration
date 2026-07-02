"use client";
import type { Cat, Sort, View } from "./types";

const CATS: [Cat, string][] = [["all","All"],["pump","Pump.fun"],["raydium","Raydium"],["trending","Trending"]];
const SORTS: [Sort, string][] = [["volume","Volume"],["newest","Newest"],["mcap","MCAP"],["change","Change"],["liquidity","Liquidity"]];

export default function Filters({ cat, setCat, sort, setSort, view, setView, q, setQ }: {
  cat: Cat; setCat: (c: Cat) => void; sort: Sort; setSort: (s: Sort) => void;
  view: View; setView: (v: View) => void; q: string; setQ: (v: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / ticker / address"
        className="w-full max-w-xs rounded-md border border-edge bg-void px-3 py-1.5 font-mono text-xs outline-none focus:border-toxic sm:w-56" />
      <div className="flex gap-1 rounded-md border border-edge p-1 font-mono text-[11px]">
        {CATS.map(([c, l]) => <button key={c} onClick={() => setCat(c)} className={`rounded px-3 py-1.5 font-bold transition ${cat===c?"bg-cyber/20 text-cyber":"text-dim hover:text-white"}`}>{l}</button>)}
      </div>
      <div className="flex gap-1 rounded-md border border-edge p-1 font-mono text-[11px]">
        {SORTS.map(([s, l]) => <button key={s} onClick={() => setSort(s)} className={`rounded px-3 py-1.5 font-bold transition ${sort===s?"bg-toxic text-void":"text-dim hover:text-white"}`}>{l}</button>)}
      </div>
      <div className="ml-auto flex gap-1 rounded-md border border-edge p-0.5 font-mono text-[11px]">
        <button onClick={() => setView("table")} className={`rounded px-2 py-1 ${view==="table"?"bg-toxic/20 text-toxic":"text-dim"}`}>Table</button>
        <button onClick={() => setView("cards")} className={`rounded px-2 py-1 ${view==="cards"?"bg-toxic/20 text-toxic":"text-dim"}`}>Cards</button>
      </div>
    </div>
  );
}
