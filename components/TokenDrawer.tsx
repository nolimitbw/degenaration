"use client";
import { useEffect, useState } from "react";
import { fmtNum, fmtAge } from "@/lib/queries";
import { getNet } from "@/lib/net";
import { usePrivy } from "@privy-io/react-auth";
import { useToast } from "@/components/Toast";
import { useQuickBuyPresets } from "@/lib/useQuickBuyPresets";
import { useExecuteBuy } from "@/lib/useExecuteBuy";
import { X } from "lucide-react";
import Candles from "./Candles";

const SOL = "So11111111111111111111111111111111111111112";

export default function TokenDrawer({ token, onClose }: { token: any | null; onClose: () => void }) {
  const { authenticated, login } = usePrivy();
  const executeBuy = useExecuteBuy();
  const toast = useToast();
  const { presets: PRESETS } = useQuickBuyPresets();
  const [price, setPrice] = useState<any>(null);
  const [rug, setRug] = useState<any>(null);
  const [conc, setConc] = useState<number | null>(null);
  const [candles, setCandles] = useState<any[]>([]);
  const [amount, setAmount] = useState(0.5);
  const [slippage, setSlippage] = useState(3);
  const [sim, setSim] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSim(null); setPrice(null); setRug(null); setConc(null); setCandles([]);
    if (!token) return;
    const mint = token.address;
    fetch(`/api/price?mint=${mint}`).then((r) => r.json()).then(setPrice).catch(() => {});
    fetch(`/api/rugcheck?mint=${mint}`).then((r) => r.json()).then(setRug).catch(() => {});
    fetch(`/api/holders?mint=${mint}&net=${getNet()}`).then((r) => r.json()).then((d) => {
      const top = (d?.holders ?? []).slice(0, 10).reduce((s: number, h: any) => s + (h.pct || 0), 0);
      setConc(top || null);
    }).catch(() => {});
    fetch(`/api/ohlcv?mint=${mint}&tf=hour`).then((r) => r.json()).then((d) => setCandles(d?.candles ?? [])).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [token, onClose]);

  if (!token) return null;

  async function doSim() {
    setBusy(true);
    const r = await fetch(`/api/simulate?in=${SOL}&out=${token.address}&amount=${Math.floor(amount * 1e9)}&slippageBps=${slippage * 100}`).then((x) => x.json()).catch(() => null);
    setSim(r); setBusy(false);
  }

  async function doBuy() {
    if (!authenticated) { login(); return; }
    if (amount <= 0) { toast("Enter a buy amount", "err"); return; }
    setBusy(true);
    const r = await executeBuy({ mint: token.address, solAmount: amount, slippageBps: slippage * 100, priceUsd: price?.priceUsd, symbol: token.symbol, mev: true });
    if (r.ok) {
      toast(r.warning || "Trade sent - " + (r.sig?.slice(0, 8) ?? ""), r.warning ? "info" : "ok");
      onClose();
    }
    else toast(r.error || "Trade failed", "err");
    setBusy(false);
  }

  const socials = price?.socials ?? token.socials ?? [];
  const websites = price?.websites ?? [];

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/60" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto border-l border-edge bg-panel" onClick={(e) => e.stopPropagation()}>
        {token.bannerImage && (
          <div className="h-28 w-full overflow-hidden bg-void">
            <img src={token.bannerImage} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {token.image ? <img src={token.image} alt="" className="h-10 w-10 rounded-full" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-edge font-mono text-xs">{token.symbol?.slice(0, 2)}</div>}
            <div>
              <p className="flex items-center gap-1 font-mono font-bold">{token.symbol}{(token.ageMs != null && token.ageMs < 3600000) && <span className="rounded bg-hotpink/20 px-1 text-[9px] text-hotpink">new</span>}</p>
              <p className="font-mono text-[11px] text-dim">{token.name} · {fmtAge(token.ageMs)}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close" className="grid h-9 w-9 place-items-center rounded-md text-dim hover:bg-edge/40 hover:text-ink"><X aria-hidden="true" size={17} /></button>
        </div>

        {/* links */}
        {(socials.length > 0 || websites.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px]">
            {websites.slice(0, 2).map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer" className="rounded border border-edge px-2 py-0.5 text-cyber hover:border-cyber">site</a>)}
            {socials.slice(0, 3).map((s: any) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="rounded border border-edge px-2 py-0.5 text-cyber hover:border-cyber">{s.type}</a>)}
            <a href={`https://solscan.io/token/${token.address}`} target="_blank" rel="noreferrer" className="rounded border border-edge px-2 py-0.5 text-dim hover:border-cyber hover:text-cyber">solscan</a>
          </div>
        )}

        <div className="mt-4">
          {candles.length > 0 ? (
            <Candles data={candles} />
          ) : price ? (
            <div className="grid h-72 place-items-center rounded-md border border-edge bg-void text-sm text-dim">No chart data yet — check back in a few minutes.</div>
          ) : (
            <div className="grid h-72 place-items-center rounded-md border border-edge bg-void text-sm text-dim">Loading chart…</div>
          )}
        </div>

        {/* stats */}
        <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[11px]">
          <div><p className="text-dim">Price</p><p className="text-ink">{price?.priceUsd ? `$${price.priceUsd}` : fmtNum(token.priceUsd)}</p></div>
          <div><p className="text-dim">MC / FDV</p><p className="text-ink">{fmtNum(price?.fdv ?? token.marketCap)}</p></div>
          <div><p className="text-dim">Liq</p><p className="text-ink">{fmtNum(price?.liquidityUsd ?? token.liquidityUsd)}</p></div>
          <div><p className="text-dim">24h Vol</p><p className="text-ink">{fmtNum(price?.volume24h ?? token.vol24h)}</p></div>
          <div><p className="text-dim">24h</p><p className={(price?.change24h ?? 0) >= 0 ? "text-up" : "text-hotpink"}>{price?.change24h != null ? `${price.change24h >= 0 ? "+" : ""}${Number(price.change24h).toFixed(1)}%` : "—"}</p></div>
          <div><p className="text-dim">Buys/Sells</p><p><span className="text-toxic">{price?.buys24h ?? "—"}</span><span className="text-dim">/</span><span className="text-hotpink">{price?.sells24h ?? "—"}</span></p></div>
        </div>

        {/* security profile */}
        <div className="mt-4 rounded-lg border border-edge bg-void p-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase text-dim">Security</p>
            {rug ? (
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${rug.ok ? "bg-toxic/20 text-toxic" : "bg-hotpink/20 text-hotpink"}`}>{rug.ok ? "PASSED" : "RISKS FOUND"}</span>
            ) : <span className="font-mono text-[10px] text-dim">checking…</span>}
          </div>
          {rug && !rug.ok && (rug.reasons?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-1">
              {rug.reasons.map((r: string) => <li key={r} className="flex items-start gap-1 font-mono text-[10px] text-hotpink">! <span>{r}</span></li>)}
            </ul>
          )}
          {rug?.ok && <p className="mt-1 font-mono text-[10px] text-dim">Mint & freeze checks clear, liquidity present. Always DYOR.</p>}
          <div className="mt-2 flex justify-between border-t border-edge pt-2 font-mono text-[10px]">
            <span className="text-dim">Top 10 holders</span>
            <span className={conc != null && conc > 50 ? "text-hotpink" : "text-ink"}>{conc != null ? `${conc.toFixed(1)}%` : "—"}</span>
          </div>
        </div>

        {/* buy form */}
        <div className="mt-4 rounded-lg border border-edge bg-void p-4">
          <label className="block">
            <span className="font-mono text-[11px] uppercase text-dim">Amount (SOL)</span>
            <input type="number" step="0.1" value={amount} onChange={(e) => setAmount(+e.target.value)} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 font-mono outline-none focus:border-toxic" />
          </label>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {PRESETS.map((a, i) => <button key={i} onClick={() => setAmount(a)} className="rounded border border-edge py-1.5 font-mono text-xs text-dim transition hover:border-toxic hover:text-toxic">{a}</button>)}
          </div>
          <label className="mt-3 block">
            <span className="font-mono text-[11px] uppercase text-dim">Max slippage %</span>
            <input type="number" value={slippage} onChange={(e) => setSlippage(+e.target.value)} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 font-mono outline-none focus:border-cyber" />
          </label>
          {sim && !sim.error && (
            <div className="mt-3 space-y-1 rounded-md border border-edge bg-panel px-3 py-2 font-mono text-[11px]">
              <div className="flex justify-between"><span className="text-dim">Est. receive</span><span className="text-toxic">{price?.priceUsd && price?.solPrice ? (amount * price.solPrice / price.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 }) : (sim.outAmount/1e6).toLocaleString()} {token.symbol}</span></div>
              <div className="flex justify-between"><span className="text-dim">Price impact</span><span className={sim.priceImpactPct>10?"text-hotpink":""}>{sim.priceImpactPct.toFixed(2)}%</span></div>
              <div className="flex justify-between"><span className="text-dim">Platform fee</span><span>{sim.platformFeeBps ? `${sim.feeSol.toFixed(4)} SOL` : "not configured"}</span></div>
            </div>
          )}
          {sim?.error && <p className="mt-2 font-mono text-[11px] text-hotpink">{sim.error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={doSim} disabled={busy} className="rounded-md border border-edge py-2.5 text-sm font-bold text-dim transition hover:border-toxic hover:text-toxic disabled:opacity-50">{busy ? "..." : "Simulate"}</button>
            <button onClick={doBuy} disabled={busy || amount <= 0} className="rounded-md bg-toxic py-2.5 text-sm font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">{authenticated ? "Buy" : "Connect wallet"}</button>
          </div>
          <p className="mt-2 text-center font-mono text-[10px] text-dim">Non-custodial · your wallet signs · fee applies when configured</p>
        </div>
        </div>
      </div>
    </div>
  );
}
