"use client";
import { fmtNum, fmtAge } from "@/lib/queries";
import { Chg, Pressure } from "./bits";
import type { Tok } from "./types";

function Skel() { return <tr className="animate-pulse border-t border-edge"><td className="px-4 py-3" colSpan={10}><div className="h-6 rounded bg-edge/40" /></td></tr>; }

export default function Table({ rows, loading, onPick }: { rows: Tok[]; loading: boolean; onPick: (t: Tok) => void }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-edge">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-panel font-mono text-[11px] uppercase text-dim">
          <tr>{["Token","Price","Age","MCAP","Liquidity","5m Vol","1h Vol","1h","24h","Buys",""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: 10 }).map((_, i) => <Skel key={i} />)}
          {!loading && rows.map((t) => (
            <tr key={t.address} className="cursor-pointer border-t border-edge transition hover:bg-panel/40" onClick={() => onPick(t)}>
              <td className="px-4 py-3"><div className="flex items-center gap-2">{t.image ? <img src={t.image} alt="" className="h-7 w-7 rounded-full" /> : <div className="h-7 w-7 rounded-full bg-edge" />}<div><p className="font-mono font-bold">{t.symbol}{t.isPump && <span className="ml-1 rounded bg-cyber/20 px-1 text-[9px] text-cyber">pump</span>}</p><p className="font-mono text-[10px] text-dim">{t.name?.slice(0,16)}</p></div></div></td>
              <td className="px-4 py-3 font-mono">{t.priceUsd != null ? `$${t.priceUsd}` : "—"}</td>
              <td className="px-4 py-3 font-mono text-dim">{fmtAge(t.ageMs)}</td>
              <td className="px-4 py-3 font-mono">{fmtNum(t.marketCap)}</td>
              <td className="px-4 py-3 font-mono text-dim">{fmtNum(t.liquidityUsd)}</td>
              <td className="px-4 py-3 font-mono">{fmtNum(t.vol5m)}</td>
              <td className="px-4 py-3 font-mono">{fmtNum(t.vol1h)}</td>
              <td className="px-4 py-3 font-mono"><Chg v={t.change1h} /></td>
              <td className="px-4 py-3 font-mono font-bold"><Chg v={t.change24h} /></td>
              <td className="px-4 py-3"><Pressure b={t.buys1h} s={t.sells1h} /></td>
              <td className="px-4 py-3"><button onClick={(e) => { e.stopPropagation(); onPick(t); }} className="rounded border border-edge px-3 py-1.5 text-xs font-bold text-dim transition hover:border-toxic hover:text-toxic">Trade</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
