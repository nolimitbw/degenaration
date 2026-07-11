"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Ticker() {
  const [toks, setToks] = useState<any[]>([]);
  useEffect(() => {
    const load = () => fetch("/api/tokens?mode=trending").then(r => r.json()).then(d => setToks((d.tokens || []).slice(0, 12))).catch(() => {});
    load(); const iv = setInterval(load, 45000); return () => clearInterval(iv);
  }, []);
  if (!toks.length) return null;
  const row = [...toks, ...toks];
  return (
    <div className="overflow-hidden border-b border-edge bg-panel/50">
      <div className="ticker-track flex w-max gap-6 py-2">
        {row.map((t, i) => (
          <Link key={i} href={`/terminal?mint=${t.address}`} className="flex items-center gap-1.5 font-mono text-[11px] transition hover:text-ink">
            <span className="text-ink">{t.symbol}</span>
            <span className={(t.change24h || 0) >= 0 ? "text-up" : "text-hotpink"}>{(t.change24h || 0) >= 0 ? "+" : ""}{(t.change24h ?? 0).toFixed(0)}%</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
