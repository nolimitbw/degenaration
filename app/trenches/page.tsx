"use client";
import AppShell from "@/components/AppShell";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { fetchTokensFull, fmtNum, fmtAge } from "@/lib/queries";
import { useExecuteBuy } from "@/lib/useExecuteBuy";
import { useQuickBuyPresets } from "@/lib/useQuickBuyPresets";
import { useToast } from "@/components/Toast";
import TokenDrawer from "@/components/TokenDrawer";
import QuickBuyEditor from "@/components/QuickBuyEditor";
import FlashValue from "@/components/FlashValue";

type Sort = "hot" | "new" | "volume" | "gainers";
const DEFAULT_SLIPPAGE_BPS = 300; // 3% — matches the default slippage used elsewhere (drawer/terminal)

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
      <div className="flex h-1.5 overflow-hidden rounded-full bg-hotpink/40"><div className="bg-toxic transition-[width] duration-500" style={{ width: `${bp}%` }} /></div>
      <p className="mt-1 font-mono text-[10px] text-dim">
        <FlashValue value={b} className="text-toxic">{b} buys</FlashValue> · <FlashValue value={s} className="text-hotpink">{s} sells</FlashValue>
      </p>
    </div>
  );
}

export default function Trenches() {
  const { authenticated, login } = usePrivy();
  const executeBuy = useExecuteBuy();
  const { presets: BUY_PRESETS, loaded: presetsLoaded, save: saveBuyPresets } = useQuickBuyPresets();
  const toast = useToast();
  const [tab, setTab] = useState<"new" | "trending">("new");
  const [sort, setSort] = useState<Sort>("hot");
  const [tokens, setTokens] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ count: 0, totalVol: 0 });
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(false);
  const [drawer, setDrawer] = useState<any | null>(null);
  const [buyingKey, setBuyingKey] = useState<string | null>(null);
  // synchronous re-entrancy guard — belt-and-suspenders alongside the (async) disabled
  // state above, since this fires a real signed swap and refs mutate synchronously
  const buyingRef = useRef(false);

  // One-tap buy: clicking a preset amount signs and sends immediately (no extra
  // confirmation screen — the wallet's own signing prompt is the confirmation).
  async function quickBuy(t: any, amt: number) {
    if (buyingRef.current) return;
    if (!authenticated) { login(); return; }
    buyingRef.current = true;
    const key = `${t.address}:${amt}`;
    setBuyingKey(key);
    try {
      const r = await executeBuy({ mint: t.address, solAmount: amt, slippageBps: DEFAULT_SLIPPAGE_BPS, priceUsd: t.priceUsd, symbol: t.symbol });
      if (r.ok) toast(`Bought ${amt} SOL of ${t.symbol ?? "token"} — ${r.sig?.slice(0, 8) ?? ""}`);
      else toast(r.error || "Buy failed", "err");
    } finally {
      buyingRef.current = false;
      setBuyingKey(null);
    }
  }

  async function load() {
    const { tokens, stats } = await fetchTokensFull(tab);
    // A transient empty/rate-limited upstream response shouldn't blank out a list that
    // was already showing real tokens — keep the last-good list until real data returns.
    if (tokens.length > 0) setTokens(tokens);
    setStats(stats); setLoading(false);
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
          <p className="mt-1 text-sm text-dim">Fresh Solana launches and trending tokens, straight from the chain — updating live.</p>
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
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1.5 font-bold transition ${tab === t ? "bg-toxic text-white" : "text-dim hover:text-ink"}`}>{t.toUpperCase()}</button>
          ))}
        </div>
        <div className="flex gap-1 rounded-md border border-edge p-1 font-mono text-xs">
          {(["hot", "new", "volume", "gainers"] as Sort[]).map((sopt) => (
            <button key={sopt} onClick={() => setSort(sopt)} className={`rounded px-3 py-1.5 font-bold transition ${sort === sopt ? "bg-cyber/20 text-cyber" : "text-dim hover:text-ink"}`}>{sopt.toUpperCase()}</button>
          ))}
        </div>
        <QuickBuyEditor presets={BUY_PRESETS} loaded={presetsLoaded} onSave={saveBuyPresets} />
      </div>

      {/* grid */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading && Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} />)}
        {!loading && rows.map((t) => (
            <div key={t.address} role="button" tabIndex={0} aria-label={`View ${t.symbol ?? "token"} details`}
              onClick={() => setDrawer(t)}
              onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(t); } }}
              className="group gradient-border flex cursor-pointer flex-col rounded-lg border border-edge p-4 transition hover:shadow-toxic">
              <div className="flex w-full items-center gap-3 text-left">
                {t.image ? <img src={t.image} alt="" className="h-10 w-10 rounded-full" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-edge font-mono text-xs">{t.symbol?.slice(0,2)}</div>}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate font-mono font-bold">{t.symbol}{t.risks?.includes("Brand new") && <span className="rounded bg-hotpink/20 px-1 text-[9px] text-hotpink">new</span>}</p>
                  <p className="truncate font-mono text-[11px] text-dim">{t.name} · {fmtAge(t.ageMs)}</p>
                </div>
                <FlashValue value={t.change24h} className={`font-mono text-sm font-bold ${(t.change24h||0)>=0?"text-toxic":"text-hotpink"}`}>{(t.change24h||0)>=0?"+":""}{(t.change24h??0).toFixed(0)}%</FlashValue>
              </div>
            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
              <div><p className="text-dim">MC</p><FlashValue value={t.marketCap} className="text-ink">{fmtNum(t.marketCap)}</FlashValue></div>
              <div><p className="text-dim">Liq</p><FlashValue value={t.liquidityUsd} className="text-ink">{fmtNum(t.liquidityUsd)}</FlashValue></div>
              <div><p className="text-dim">1h Vol</p><FlashValue value={t.vol1h} className="text-ink">{fmtNum(t.vol1h)}</FlashValue></div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px]">
              {([["5m", t.change5m], ["1h", t.change1h], ["24h", t.change24h]] as const).map(([l, v]) => (
                <div key={l} className="rounded bg-void/60 px-1 py-0.5 text-center">
                  <span className="text-dim">{l} </span>
                  <FlashValue value={v} className={(v ?? 0) >= 0 ? "text-toxic" : "text-hotpink"}>{v != null ? `${v >= 0 ? "+" : ""}${Number(v).toFixed(0)}%` : "—"}</FlashValue>
                </div>
              ))}
            </div>
            <Pressure b={t.buys1h} s={t.sells1h} />
            {t.risks?.length ? <div className="mt-2 flex flex-wrap gap-1">{t.risks.map((r: string) => <span key={r} className="rounded border border-hotpink/40 px-1.5 py-0.5 font-mono text-[9px] text-hotpink">⚠ {r}</span>)}</div> : null}
            <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-1 gap-1">
                {BUY_PRESETS.map((a, i) => {
                  const busy = buyingKey === `${t.address}:${a}`;
                  return (
                    <button key={i} onClick={() => quickBuy(t, a)} disabled={buyingKey != null}
                      title={`Quick buy ${a} SOL`} aria-label={`Quick buy ${a} SOL of ${t.symbol ?? "token"}`}
                      className="flex-1 rounded border border-edge py-1 text-center font-mono text-[10px] text-dim transition hover:border-toxic hover:text-toxic disabled:opacity-50">{busy ? "…" : a}</button>
                  );
                })}
              </div>
              {t.socials?.slice(0,2).map((x: any) => <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="text-cyber hover:text-ink" title={x.type} aria-label={x.type}>↗</a>)}
            </div>
            <Link href={`/terminal?mint=${t.address}`} onClick={(e) => e.stopPropagation()} className="mt-2 block rounded-md bg-toxic py-2 text-center text-sm font-bold text-white shadow-toxic transition hover:brightness-110">Quick trade →</Link>
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
