"use client";
import Link from "next/link";
import { fmtNum, fmtAge } from "@/lib/queries";
import { Chg } from "./bits";
import type { Tok } from "./types";

export default function Cards({ rows, loading, onPick }: { rows: Tok[]; loading: boolean; onPick: (t: Tok) => void }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {loading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-lg border border-edge bg-panel/40" />)}
      {!loading && rows.map((t) => (
        <div key={t.address} role="button" tabIndex={0} aria-label={`View ${t.symbol ?? "token"} details`}
          onClick={() => onPick(t)}
          onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(t); } }}
          className="group gradient-border cursor-pointer rounded-lg border border-edge p-4 transition hover:shadow-toxic">
          <div className="flex items-center gap-3">
            {t.image ? <img src={t.image} alt="" className="h-10 w-10 rounded-full" /> : <div className="h-10 w-10 rounded-full bg-edge" />}
            <div className="min-w-0 flex-1"><p className="truncate font-mono font-bold">{t.symbol}</p><p className="truncate font-mono text-[11px] text-dim">{t.name} · {fmtAge(t.ageMs)}</p></div>
            <span className="font-mono text-sm font-bold"><Chg v={t.change24h} /></span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]"><div><p className="text-dim">MC</p><p>{fmtNum(t.marketCap)}</p></div><div><p className="text-dim">Liq</p><p>{fmtNum(t.liquidityUsd)}</p></div><div><p className="text-dim">1h Vol</p><p>{fmtNum(t.vol1h)}</p></div></div>
          <Link href={`/terminal?mint=${t.address}`} onClick={(e) => e.stopPropagation()} className="mt-3 block w-full rounded-md bg-toxic py-2 text-center text-sm font-bold text-white shadow-toxic transition hover:brightness-110">Trade →</Link>
        </div>
      ))}
    </div>
  );
}
