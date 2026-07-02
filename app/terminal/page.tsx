"use client";
import AppShell from "@/components/AppShell";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Candles from "@/components/Candles";
import { usePrivy } from "@privy-io/react-auth";
import { executeBuy } from "@/lib/execute";
import { createLimitOrder } from "@/lib/queries";
import { useToast } from "@/components/Toast";

const SOL = "So11111111111111111111111111111111111111112";
const AMOUNTS = [0.1, 0.5, 1, 2];

// Simple SVG price chart from a series of numbers
function MiniChart({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-48 rounded-md border border-edge bg-void" />;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / range) * 100}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <div className="h-48 rounded-md border border-edge bg-void p-2">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polyline points={pts} fill="none" stroke={up ? "#a3ff12" : "#ff2d78"} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default function Terminal() {
  const params = useSearchParams();
  const [mint, setMint] = useState(params.get("mint") || "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  const [tab, setTab] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState(0.5);
  const [slippage, setSlippage] = useState(3);
  const [tp, setTp] = useState(false);
  const [sl, setSl] = useState(false);
  const [mev, setMev] = useState(true);
  const [autoRetry, setAutoRetry] = useState(true);
  const [price, setPrice] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [candles, setCandles] = useState<any[]>([]);
  const [holders, setHolders] = useState<any[]>([]);
  const [chartTab, setChartTab] = useState<"chart" | "holders" | "info">("chart");
  const [tf, setTf] = useState<"minute" | "hour" | "day">("hour");
  const [loading, setLoading] = useState(false);
  const [sim, setSim] = useState<any>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [limitTarget, setLimitTarget] = useState(0);
  const [limitTrigger, setLimitTrigger] = useState<"below" | "above">("below");
  const { user, authenticated, login } = usePrivy();
  const toast = useToast();

  async function createLimit() {
    if (!authenticated) { login(); return; }
    if (limitTarget <= 0 || amount <= 0) { toast("Enter a target price and amount", "err"); return; }
    const pubkey = (user as any)?.wallet?.address as string | undefined;
    const walletId = (user as any)?.wallet?.id as string | undefined;
    if (!pubkey) { toast("No wallet found", "err"); return; }
    const { error } = await createLimitOrder({ mint, symbol: price?.symbol || mint.slice(0, 6), trigger: limitTrigger, target_usd: limitTarget, amount_sol: amount, slippage_bps: slippage * 100, user_pubkey: pubkey, wallet_id: walletId });
    if (error) { toast(error.message || "Could not save order", "err"); return; }
    toast("Limit order created — see Limit Orders");
  }

  async function load() {
    setLoading(true);
    const p = await fetch(`/api/price?mint=${mint}`).then((r) => r.json()).catch(() => null);
    setPrice(p);
    const oh = await fetch(`/api/ohlcv?mint=${mint}&tf=${tf}`).then((r) => r.json()).catch(() => null);
    setCandles(oh?.candles ?? []);
    const hd = await fetch(`/api/holders?mint=${mint}`).then((r) => r.json()).catch(() => null);
    setHolders(hd?.holders ?? []);
    const q = await fetch(`/api/quote?in=${SOL}&out=${mint}&amount=${Math.floor(amount * 1e9)}&slippageBps=${slippage * 100}`).then((r) => r.json()).catch(() => null);
    setQuote(q);
    setLoading(false);
  }

  // auto-load the token on mount (covers arriving via /terminal?mint=... from Quick trade)
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // open the trade preview: simulate the swap, then let the user confirm and sign
  async function runSim() {
    setSimOpen(true); setSimLoading(true); setSim(null);
    const s = await fetch(`/api/simulate?in=${SOL}&out=${mint}&amount=${Math.floor(amount * 1e9)}&slippageBps=${slippage * 100}`)
      .then((r) => r.json()).catch(() => ({ error: "Simulation failed — try again." }));
    setSim(s); setSimLoading(false);
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Trading terminal <span className="font-mono text-xs text-toxic">live</span></h1>
        <div className="flex gap-2">
          <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Token mint address"
            className="w-72 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
          <button onClick={load} className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-void shadow-toxic">Load</button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* chart + info */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-edge bg-panel p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm text-dim">{price?.symbol ?? mint.slice(0, 6)}…</p>
                <p className="mt-1 font-mono text-2xl font-bold">
                  {price?.priceUsd ? `$${price.priceUsd}` : "—"}
                </p>
              </div>
              <div className="text-right font-mono text-xs">
                <p className={price?.change24h >= 0 ? "text-toxic" : "text-hotpink"}>
                  {price?.change24h != null ? `${price.change24h >= 0 ? "+" : ""}${price.change24h.toFixed(1)}% 24h` : "—"}
                </p>
                <p className="text-dim">Liq {price?.liquidityUsd ? `$${Math.round(price.liquidityUsd/1000)}K` : "—"} · {price?.dex ?? "—"}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-1">
              {(["chart", "holders", "info"] as const).map((t) => (
                <button key={t} onClick={() => setChartTab(t)}
                  className={`rounded px-3 py-1.5 font-mono text-[11px] font-bold transition ${chartTab === t ? "bg-toxic text-void" : "border border-edge text-dim"}`}>{t.toUpperCase()}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-edge pt-3 font-mono text-[11px] sm:grid-cols-4">
              <div><p className="text-dim">FDV</p><p className="text-white">{price?.fdv ? `$${Math.round(price.fdv/1000).toLocaleString()}K` : "—"}</p></div>
              <div><p className="text-dim">24h Vol</p><p className="text-white">{price?.volume24h ? `$${Math.round(price.volume24h/1000).toLocaleString()}K` : "—"}</p></div>
              <div><p className="text-dim">Buys/Sells</p><p><span className="text-toxic">{price?.buys24h ?? "—"}</span><span className="text-dim">/</span><span className="text-hotpink">{price?.sells24h ?? "—"}</span></p></div>
              <div><p className="text-dim">Socials</p><p className="flex gap-2">{(price?.socials || []).slice(0,3).map((x: any) => (<a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="text-cyber hover:underline">{x.type?.slice(0,2)}</a>))}{!(price?.socials||[]).length && <span className="text-dim">—</span>}</p></div>
            </div>
            {chartTab === "chart" && <div className="mt-3">
              {price?.pairAddress ? (
                <iframe
                  key={price.pairAddress}
                  src={`https://dexscreener.com/${price.chainId || "solana"}/${price.pairAddress}?embed=1&theme=dark&trades=0&info=0`}
                  className="h-[420px] w-full rounded-md border border-edge"
                  title="chart"
                />
              ) : candles.length ? (
                <Candles data={candles} />
              ) : (
                <div className="grid h-72 place-items-center rounded-md border border-edge bg-void text-sm text-dim">Load a token to see its live DexScreener chart.</div>
              )}
            </div>}
            {chartTab === "holders" && (
              <div className="mt-3 overflow-hidden rounded-md border border-edge">
                <table className="w-full text-left text-xs"><thead className="bg-panel font-mono uppercase text-dim"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Holder</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">%</th></tr></thead>
                <tbody>{holders.length ? holders.map((h) => (<tr key={h.address} className="border-t border-edge font-mono"><td className="px-3 py-2">{h.rank}</td><td className="px-3 py-2 text-cyber">{h.address.slice(0,4)}…{h.address.slice(-4)}</td><td className="px-3 py-2">{Math.round(h.amount).toLocaleString()}</td><td className="px-3 py-2 text-toxic">{h.pct != null ? h.pct.toFixed(2)+"%" : "—"}</td></tr>)) : <tr><td colSpan={4} className="px-3 py-6 text-center text-dim">Load a token to see holders.</td></tr>}</tbody></table>
              </div>
            )}
            {chartTab === "info" && (
              <div className="mt-3 space-y-2 rounded-md border border-edge bg-void p-4 font-mono text-xs">
                <p className="text-dim">Name: <span className="text-white">{price?.name ?? "—"}</span></p>
                <p className="text-dim">Symbol: <span className="text-white">{price?.symbol ?? "—"}</span></p>
                <p className="text-dim">FDV: <span className="text-white">{price?.fdv ? "$"+Math.round(price.fdv).toLocaleString() : "—"}</span></p>
                <p className="text-dim">Mint: <span className="break-all text-white">{mint}</span></p>
                <p className="text-dim">Links: {(price?.websites||[]).concat((price?.socials||[]).map((x:any)=>x.url)).slice(0,4).map((u:string)=>(<a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 text-cyber hover:underline">↗</a>))}{!(price?.websites||[]).length && !(price?.socials||[]).length && <span className="text-white">—</span>}</p>
              </div>
            )}
          </div>
        </div>

        {/* trade panel */}
        <div className="rounded-lg border border-edge bg-panel p-5">
          <div className="grid grid-cols-2 rounded-md border border-edge p-1 font-mono text-xs">
            {(["market", "limit"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded py-2 font-bold transition ${tab === t ? "bg-toxic text-void" : "text-dim"}`}>{t.toUpperCase()}</button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="font-mono text-[11px] uppercase text-dim">Amount (SOL)</span>
            <input type="number" step="0.1" value={amount} onChange={(e) => setAmount(+e.target.value)}
              className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
          </label>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {AMOUNTS.map((a) => (
              <button key={a} onClick={() => setAmount(a)}
                className="rounded border border-edge py-1.5 font-mono text-xs text-dim transition hover:border-toxic hover:text-toxic">{a}</button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="font-mono text-[11px] uppercase text-dim">Max slippage %</span>
            <input type="number" value={slippage} onChange={(e) => setSlippage(+e.target.value)}
              className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-cyber" />
          </label>

          {tab === "limit" && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="font-mono text-[11px] uppercase text-dim">Trigger</span>
                <select value={limitTrigger} onChange={(e) => setLimitTrigger(e.target.value as any)} className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono text-sm outline-none focus:border-cyber">
                  <option value="below">price ≤</option><option value="above">price ≥</option>
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[11px] uppercase text-dim">Target $</span>
                <input type="number" step="any" value={limitTarget || ""} onChange={(e) => setLimitTarget(+e.target.value)}
                  className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
              </label>
            </div>
          )}

          <div className="mt-4 space-y-2 text-sm">
            {[
              { l: "Take Profit", v: tp, set: setTp },
              { l: "Stop Loss", v: sl, set: setSl },
              { l: "MEV protection", v: mev, set: setMev },
              { l: "Auto-retry", v: autoRetry, set: setAutoRetry }
            ].map((o) => (
              <label key={o.l} className="flex items-center gap-2 text-dim">
                <input type="checkbox" checked={o.v} onChange={(e) => o.set(e.target.checked)} className="accent-toxic" />
                {o.l}
              </label>
            ))}
          </div>

          {quote?.outAmount && (
            <p className="mt-4 rounded-md border border-edge bg-void px-3 py-2 font-mono text-[11px] text-toxic">
              ≈ {(Number(quote.outAmount) / 1e5).toLocaleString()} tokens · 2% fee applied
            </p>
          )}

          {tab === "limit" ? (
            <button onClick={createLimit} disabled={limitTarget <= 0 || amount <= 0}
              className="mt-4 w-full rounded-md bg-cyber py-3 font-bold text-void shadow-pink transition hover:brightness-110 disabled:opacity-50">
              Create limit order
            </button>
          ) : (
            <button onClick={runSim} disabled={simLoading || amount <= 0}
              className="mt-4 w-full rounded-md bg-toxic py-3 font-bold text-void shadow-toxic transition hover:brightness-110 disabled:opacity-50">
              {`Buy ${amount} SOL`}
            </button>
          )}
          <p className="mt-2 text-center font-mono text-[10px] text-dim">{tab === "limit" ? "Auto-buys when the target hits (watch on Limit Orders)" : "Preview the trade, then sign in your wallet"}</p>
        </div>
      </div>

      {simOpen && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onClick={() => setSimOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-edge bg-panel p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Trade preview</h3>
              <button onClick={() => setSimOpen(false)} className="text-dim hover:text-white">✕</button>
            </div>
            {simLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-dim"><span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-toxic" /> Simulating…</div>
            ) : sim?.error ? (
              <p className="mt-4 font-mono text-sm text-hotpink">{sim.error}</p>
            ) : sim ? (
              <div className="mt-4 space-y-2 font-mono text-sm">
                <div className="flex justify-between"><span className="text-dim">You pay</span><span>{sim.inAmountSol} SOL</span></div>
                <div className="flex justify-between"><span className="text-dim">You receive (est.)</span><span className="text-toxic">{(sim.outAmount/1e5).toLocaleString()} {price?.symbol}</span></div>
                <div className="flex justify-between"><span className="text-dim">Min received</span><span>{(sim.minReceived/1e5).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-dim">Price impact</span><span className={sim.priceImpactPct > 10 ? "text-hotpink" : ""}>{sim.priceImpactPct.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-dim">Platform fee (2%)</span><span>{sim.feeSol.toFixed(4)} SOL</span></div>
                <div className="flex justify-between"><span className="text-dim">Route</span><span className="text-dim">{(sim.route||[]).join(" → ") || "—"}</span></div>
                {sim.warn && <p className="rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 text-[11px] text-hotpink">⚠ {sim.warn}</p>}
                <div className="rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 text-[11px] text-hotpink">DEVNET — this is a simulation. Live execution activates on mainnet with your wallet signature.</div>
                <button onClick={async () => {
                  setExecuting(true);
                  const r = await executeBuy({ mint, solAmount: amount, slippageBps: slippage * 100, priceUsd: price?.priceUsd, symbol: price?.symbol });
                  setExecuting(false);
                  if (r.ok) { toast("Trade sent — " + (r.sig?.slice(0,8) ?? "")); setSimOpen(false); }
                  else toast(r.error || "Trade failed", "err");
                }} disabled={executing}
                  className="mt-2 w-full rounded-md bg-toxic py-3 font-bold text-void shadow-toxic transition hover:brightness-110 disabled:opacity-50">
                  {executing ? "Awaiting signature…" : "Confirm & sign in wallet"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </AppShell>
  );
}
