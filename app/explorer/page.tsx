"use client";
import AppShell from "@/components/AppShell";
import TokenDrawer from "@/components/TokenDrawer";
import Filters from "@/components/explorer/Filters";
import Table from "@/components/explorer/Table";
import Cards from "@/components/explorer/Cards";
import type { Cat, Sort, View, Tok } from "@/components/explorer/types";
import { fetchTokensFull } from "@/lib/queries";
import { useEffect, useMemo, useState } from "react";

export default function ExplorerPage() {
  const [tokens, setTokens] = useState<Tok[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("volume");
  const [cat, setCat] = useState<Cat>("all");
  const [view, setView] = useState<View>("table");
  const [q, setQ] = useState("");
  const [pulse, setPulse] = useState(false);
  const [drawer, setDrawer] = useState<Tok | null>(null);
  const [page, setPage] = useState(1);
  const PER = 15;

  async function load() {
    const { tokens } = await fetchTokensFull(cat === "trending" ? "trending" : "new");
    setTokens(tokens); setLoading(false); setPulse(true); setTimeout(() => setPulse(false), 600);
  }
  useEffect(() => { setLoading(true); setPage(1); load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); /* eslint-disable-next-line */ }, [cat]);

  const rows = useMemo(() => {
    let t = [...tokens];
    if (cat === "pump") t = t.filter((x) => x.isPump);
    if (cat === "raydium") t = t.filter((x) => (x.dex || "").toLowerCase().includes("raydium"));
    if (q) { const s = q.toLowerCase(); t = t.filter((x) => x.symbol?.toLowerCase().includes(s) || x.name?.toLowerCase().includes(s) || x.address?.toLowerCase().includes(s)); }
    if (sort === "newest") t.sort((a, b) => (a.ageMs || 9e15) - (b.ageMs || 9e15));
    else if (sort === "mcap") t.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
    else if (sort === "change") t.sort((a, b) => (b.change24h || -999) - (a.change24h || -999));
    else if (sort === "liquidity") t.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
    else t.sort((a, b) => (b.vol24h || 0) - (a.vol24h || 0));
    return t;
  }, [tokens, sort, cat, q]);

  const paged = rows.slice(0, page * PER);

  return (
    <AppShell>
      <TokenDrawer token={drawer} onClose={() => setDrawer(null)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">Explorer
            <span className="flex items-center gap-1 rounded-full border border-toxic/40 px-2 py-0.5 font-mono text-[10px] text-toxic"><span className={`h-1.5 w-1.5 rounded-full bg-toxic ${pulse ? "animate-ping" : ""}`} />LIVE</span>
          </h1>
          <p className="mt-1 text-sm text-dim">Real Solana tokens, live on-chain. Auto-refreshes every 10s.</p>
        </div>
      </div>
      <Filters cat={cat} setCat={setCat} sort={sort} setSort={setSort} view={view} setView={setView} q={q} setQ={setQ} />
      {view === "table" ? <Table rows={paged} loading={loading} onPick={setDrawer} /> : <Cards rows={paged} loading={loading} onPick={setDrawer} />}
      {!loading && !rows.length && <p className="mt-8 text-center text-sm text-dim">No tokens match. Try a different filter or search.</p>}
      {!loading && paged.length < rows.length && (
        <button onClick={() => setPage((p) => p + 1)} className="mx-auto mt-5 block rounded-md border border-edge px-6 py-2 font-mono text-xs text-dim transition hover:border-toxic hover:text-toxic">Load more ({rows.length - paged.length})</button>
      )}
    </AppShell>
  );
}
