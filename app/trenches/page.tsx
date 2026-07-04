"use client";
import AppShell from "@/components/AppShell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchTokensFull, fmtNum, fmtAge } from "@/lib/queries";
import TokenDrawer from "@/components/TokenDrawer";

type Sort = "hot" | "new" | "volume" | "gainers";
const BUY_PRESETS = [0.1, 0.5, 1, 2];

function Skeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-edge bg-panel/40 p-4">
      <div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-edge" /><div className="flex-1 space-y-2"><div className="h-3 w-20 rounded bg-edge" /><div className="h-2 w-28 rounded bg-edge/60" /></div></div>
      <div className="mt-3 grid grid-cols-3 gap-2"><div className="h-6 rounded bg-edge/50" /><div className="h-6 rounded bg-edge/50" /><div className="h-6 rounded bg-edge/50" /></div>
      <div className="mt-3 h-8 rounded bg-edge/40" />
    </div>
  );
}

function Pressure({ b, s }: { b: number; s: number }) {
  const t = b + s || 1; const bp = (b / t) * 100;
  return (
    <div className="mt-1">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-hotpink/40"><div className="bg-toxic" style={{ width: `${bp}%` }} /></div>
      <p className="mt-1 font-mono text-[10px] text-dim"><span className="text-toxic">{b}</span> buys · <span className="text-hotpink">{s}</span> sells</p>
    </div>
  );
}

export default function Trenches() {
  const router = useRouter();
  const [tab, setTab] = useState<"new" | "trending">("new");
  const [sort, setSort] = useState<Sort>("hot");
  const [tokens, setTokens] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ count: 0, totalVol: 0 });
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(false);
  const [drawer, setDrawer] = useState<any | null>(null);

  async function load() {
    const { tokens, stats } = await fetchTokensFull(tab);
    setTokens(tokens); setStats(stats); setLoading(false);
    setPulse(true); setTimeout(() => setPulse(false), 600);
  }
  useEffect(() => { setLoading(true); load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); /* eslint-disable-next-line */ }, [tab]);

  const rows = useMemo(() => {
    const t = [...tokens];
    if (sort === "new") t.sort((a, b) => (a.ageMs || 9e15) - (b.ageMs || 9e15));
    else if (sort === "volume") t.sort((a, b) => (b.vol24h || 0) - (a.vol24h || 0));
    else if (sort === "gainers") t.sort((a, b) => (b.change24h || -999) - (a.change24h || -999));
    else t.sort((a, b) => (b.vol1h || 0) - (a.vol1h || 0));
    return t;
  }, [tokens, sort]);

  return (
    <AppShell>
      <TokenDrawer token={drawer} onClose={() => setDrawer(null)} />
      {/* header + live stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">Trenches
            <span className="flex items-center gap-1 rounded-full border border-toxic/40 px-2 py-0.5 font-mono text-[10px] text-toxic">
              <span className={`h-1.5 w-1.5 rounded-full bg-toxic ${pulse ? "animate-ping" : ""}`} />LIVE
            </span>
          </h1>
          <p className="mt-1 text-sm text-dim">Fresh Solana launches and trending tokens, straight from the chain. Auto-refreshes every 8s.</p>
        </div>
        <div className="flex gap-4 font-mono text-xs">
          <div><p className="text-dim">Tracked</p><p className="text-toxic">{stats.count} tokens</p></div>
          <div><p className="text-dim">24h volume</p><p className="text-toxic">{fmtNum(stats.totalVol)}</p></div>
        </div>
      </div>

      {/* filters */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md border border-edge p-1 font-mono text-xs">
          {(["new", "trending"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1.5 font-bold transition ${tab === t ? "bg-toxic text-void" : "text-dim hover:text-white"}`}>{t.toUpperCase()}</button>
          ))}
        </div>
        <div className="flex gap-1 rounded-md border border-edge p-1 font-mono text-xs">
          {(["hot", "new", "volume", "gainers"] as Sort[]).map((sopt) => (
            <button key={sopt} onClick={() => setSort(sopt)} className={`rounded px-3 py-1.5 font-bold transition ${sort === sopt ? "bg-cyber/20 text-cyber" : "text-dim hover:text-white"}`}>{sopt.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* grid */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading && Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} />)}
        {!loading && rows.map((t) => (
            <div key={t.address} className="group gradient-border flex flex-col rounded-lg border border-edge p-4 transition hover:shadow-toxic">
              <button onClick={() => setDrawer(t)} className="flex w-full items-center gap-3 text-left">
                {t.image ? <img src={t.image} alt="" className="h-10 w-10 rounded-full" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-edge font-mono text-xs">{t.symbol?.slice(0,2)}</div>}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate font-mono font-bold">{t.symbol}{t.risks?.includes("Brand new") && <span className="rounded bg-hotpink/20 px-1 text-[9px] text-hotpink">new</span>}</p>
                  <p className="truncate font-mono text-[11px] text-dim">{t.name} · {fmtAge(t.ageMs)}</p>
                </div>
                <span className={`font-mono text-sm font-bold ${(t.change24h||0)>=0?"text-toxic":"text-hotpink"}`}>{(t.change24h||0)>=0?"+":""}{(t.change24h??0).toFixed(0)}%</span>
              </button>
            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
              <div><p className="text-dim">MC</p><p className="text-white">{fmtNum(t.marketCap)}</p></div>
              <div><p className="text-dim">Liq</p><p className="text-white">{fmtNum(t.liquidityUsd)}</p></div>
              <div><p className="text-dim">1h Vol</p><p className="text-white">{fmtNum(t.vol1h)}</p></div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px]">
              {([["5m", t.change5m], ["1h", t.change1h], ["24h", t.change24h]] as const).map(([l, v]) => (
                <div key={l} className="rounded bg-void/60 px-1 py-0.5 text-center">
                  <span className="text-dim">{l} </span>
                  <span className={(v ?? 0) >= 0 ? "text-toxic" : "text-hotpink"}>{v != null ? `${v >= 0 ? "+" : ""}${Number(v).toFixed(0)}%` : "—"}</span>
                </div>
              ))}
            </div>
            <Pressure b={t.buys1h} s={t.sells1h} />
            {t.risks?.length ? <div className="mt-2 flex flex-wrap gap-1">{t.risks.map((r: string) => <span key={r} className="rounded border border-hotpink/40 px-1.5 py-0.5 font-mono text-[9px] text-hotpink">⚠ {r}</span>)}</div> : null}
            <div className="mt-3 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {BUY_PRESETS.map((a) => (
                  <button key={a} onClick={() => router.push(`/terminal?mint=${t.address}&amount=${a}`)}
                    title={`Quick buy ${a} SOL`} aria-label={`Quick buy ${a} SOL of ${t.symbol ?? "token"}`}
                    className="flex-1 rounded border border-edge py-1 text-center font-mono text-[10px] text-dim transition hover:border-toxic hover:text-toxic">{a}</button>
                ))}
              </div>
              {t.socials?.slice(0,2).map((x: any) => <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="text-cyber hover:text-white" title={x.type} aria-label={x.type}>↗</a>)}
            </div>
            <Link href={`/terminal?mint=${t.address}`} className="mt-2 block rounded-md bg-toxic py-2 text-center text-sm font-bold text-void shadow-toxic transition hover:brightness-110">Quick trade →</Link>
          </div>
        ))}
        {!loading && !rows.length && (
          <div className="col-span-full grid place-items-center rounded-lg border border-edge bg-panel/40 py-12 text-center">
            <p className="text-sm font-bold text-dim">No tokens right now</p>
            <p className="mt-1 font-mono text-[11px] text-dim/70">The feed refreshes every 8s — new launches will appear automatically.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
