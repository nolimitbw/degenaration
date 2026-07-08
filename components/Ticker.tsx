"use client";
import { useEffect, useState } from "react";
import { fetchTokens } from "@/lib/queries";

export default function Ticker() {
  // Starts empty and stays hidden until the real trending feed responds — no fabricated rows.
  const [items, setItems] = useState<{ t: string; p: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const toks = await fetchTokens("trending");
      if (!alive) return;
      const mapped = (toks || [])
        .filter((x: any) => x.symbol && x.change24h != null)
        .slice(0, 16)
        .map((x: any) => ({ t: "$" + String(x.symbol).toUpperCase().slice(0, 10), p: Number(x.change24h) }));
      if (mapped.length) setItems(mapped);
    };
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  if (!items.length) return null; // hidden until real trending data loads
  const row = [...items, ...items];
  return (
    <div className="relative overflow-hidden border-y border-white/10 bg-white/[0.03] py-3 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-night to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-night to-transparent" />
      <div className="ticker-track flex w-max gap-10 font-mono text-sm">
        {row.map((c, i) => (
          <span key={i} className="flex items-center gap-2 text-haze">
            <span className="text-starlight">{c.t}</span>
            <span className={c.p >= 0 ? "text-cyber" : "text-down"}>{c.p >= 0 ? "+" : ""}{c.p.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
