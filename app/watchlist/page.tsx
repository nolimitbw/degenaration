"use client";
import AppShell from "@/components/AppShell";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtNum } from "@/lib/queries";

export default function Watchlist() {
  const [mints, setMints] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, any>>({});
  const [input, setInput] = useState("");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("degen_watchlist") : null;
    setMints(saved ? JSON.parse(saved) : ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"]);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("degen_watchlist", JSON.stringify(mints));
    mints.forEach(async (m) => {
      const p = await fetch(`/api/price?mint=${m}`).then((r) => r.json()).catch(() => null);
      if (p && !p.error) setData((prev) => ({ ...prev, [m]: p }));
    });
  }, [mints]);

  const add = () => {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return;
    setMints((m) => [...new Set([...m, input])]); setInput("");
  };
  const remove = (m: string) => setMints((x) => x.filter((y) => y !== m));

  return (
    <AppShell>
      <h1 className="text-2xl font-bold">Watchlist <span className="font-mono text-xs text-toxic">live</span></h1>
      <p className="mt-1 text-sm text-dim">Track your favorite tokens with live prices.</p>

      <div className="mt-5 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token mint address"
          className="flex-1 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <button onClick={add} className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-void shadow-toxic">+ Add</button>
      </div>

      {!mints.length ? (
        <div className="mt-6 grid place-items-center rounded-lg border border-edge bg-panel/40 py-12 text-center">
          <p className="text-sm font-bold text-dim">Your watchlist is empty</p>
          <p className="mt-1 font-mono text-[11px] text-dim/70">Add a token mint address above to track its live price.</p>
        </div>
      ) : (
      <div className="mt-6 overflow-x-auto rounded-lg border border-edge">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-panel font-mono text-[11px] uppercase text-dim">
            <tr>{["Token", "Price", "24h", "Market Cap", "Liquidity", ""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {mints.map((m) => {
              const d = data[m];
              return (
                <tr key={m} className="border-t border-edge">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {d?.image ? <img src={d.image} alt="" className="h-6 w-6 rounded-full" /> : <div className="grid h-6 w-6 place-items-center rounded-full bg-edge font-mono text-[9px]">{(d?.symbol ?? "?").slice(0, 2)}</div>}
                      <p className="font-mono font-bold">{d?.symbol ?? m.slice(0, 6) + "…"}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">{d?.priceUsd ? `$${d.priceUsd}` : "…"}</td>
                  <td className={`px-4 py-3 font-mono ${(d?.change24h ?? 0) >= 0 ? "text-toxic" : "text-hotpink"}`}>{d?.change24h != null ? `${d.change24h >= 0 ? "+" : ""}${Number(d.change24h).toFixed(1)}%` : "…"}</td>
                  <td className="px-4 py-3 font-mono text-dim">{d ? fmtNum(d.fdv) : "…"}</td>
                  <td className="px-4 py-3 font-mono text-dim">{d ? fmtNum(d.liquidityUsd) : "…"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/terminal?mint=${m}`} className="rounded border border-edge px-3 py-1.5 text-xs font-bold text-dim hover:border-toxic hover:text-toxic">Trade</Link>
                      <button onClick={() => remove(m)} className="font-mono text-[11px] text-hotpink hover:underline">remove</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </AppShell>
  );
}
