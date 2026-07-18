"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CandlestickChart, RefreshCw, ShieldCheck } from "lucide-react";
import Candles from "@/components/Candles";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SOL = "So11111111111111111111111111111111111111112";
const BUY_PRESETS = [0.1, 0.5, 1, 2];
const SELL_PRESETS = [1_000_000, 5_000_000, 10_000_000, 25_000_000];

type Mode = "buy" | "sell";
type Timeframe = "minute" | "hour" | "day";
type Tab = "chart" | "holders" | "risk";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Holder = { rank: number; address: string; amount: number; pct: number | null };
type Market = {
  priceUsd: number | null; solPrice: number; liquidityUsd: number; symbol: string | null; name: string | null;
  fdv: number | null; volume24h: number | null; change24h: number | null; dex: string | null; found: boolean;
};
type Quote = { outAmount?: string; outputDecimals?: number; priceImpactPct?: string; route?: string[]; error?: string };
type Risk = {
  ok: boolean; reasons?: string[]; riskScore?: number | null; mintAuthorityRevoked?: boolean | null;
  freezeAuthorityRevoked?: boolean | null; authoritiesVerified?: boolean;
};

function compact(value: number | null | undefined, currency = false) {
  if (!Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value));
  return currency ? `$${formatted}` : formatted;
}

function price(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "--";
  const digits = Number(value) < 0.001 ? 8 : Number(value) < 1 ? 5 : 2;
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}

function units(raw: string | undefined, decimals: number | undefined) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return "--";
  return (value / 10 ** (decimals ?? 6)).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

async function json(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || "Live market request failed");
  return body;
}

export default function LiveMarketTerminal() {
  const [mode, setMode] = useState<Mode>("buy");
  const [amount, setAmount] = useState(0.5);
  const [slippage, setSlippage] = useState(3);
  const [timeframe, setTimeframe] = useState<Timeframe>("hour");
  const [tab, setTab] = useState<Tab>("chart");
  const [market, setMarket] = useState<Market | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presets = mode === "buy" ? BUY_PRESETS : SELL_PRESETS;

  const loadMarket = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [nextMarket, chart, holderData, riskData] = await Promise.all([
        json(`/api/price?mint=${BONK}`, signal),
        json(`/api/ohlcv?mint=${BONK}&tf=${timeframe}`, signal),
        json(`/api/holders?mint=${BONK}&net=mainnet`, signal),
        json(`/api/rugcheck?mint=${BONK}`, signal),
      ]);
      setMarket(nextMarket);
      setCandles(chart.candles ?? []);
      setHolders(holderData.holders ?? []);
      setRisk(riskData);
      setError(null);
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError("Live market data is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    const controller = new AbortController();
    loadMarket(controller.signal);
    const timer = window.setInterval(() => loadMarket(controller.signal), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [loadMarket]);

  useEffect(() => {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(slippage) || slippage <= 0 || slippage > 20) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const input = mode === "buy" ? SOL : BONK;
        const output = mode === "buy" ? BONK : SOL;
        const rawAmount = mode === "buy" ? Math.floor(amount * 1e9) : Math.floor(amount * 1e5);
        setQuote(await json(`/api/quote?in=${input}&out=${output}&amount=${rawAmount}&slippageBps=${Math.round(slippage * 100)}`, controller.signal));
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setQuote({ error: "Quote unavailable" });
      } finally {
        setQuoteLoading(false);
      }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [amount, mode, slippage]);

  const receive = useMemo(() => {
    if (quoteLoading) return "Refreshing quote";
    if (quote?.error) return quote.error;
    return `${units(quote?.outAmount, quote?.outputDecimals)} ${mode === "buy" ? "BONK" : "SOL"}`;
  }, [mode, quote, quoteLoading]);

  const change = Number(market?.change24h);
  const href = `/terminal?mint=${BONK}&mode=${mode}${mode === "buy" ? `&amount=${amount}` : ""}`;

  return (
    <div className="terminal-preview overflow-hidden border border-edge bg-panel shadow-[0_30px_90px_-52px_rgba(0,0,0,.95)]">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-2">
        <div className="flex items-center gap-4"><span className="font-mono text-[10px] text-toxic">TERMINAL</span><span className="font-mono text-[10px] text-dim">BONK / SOL</span></div>
        <div className="flex items-center gap-3">
          {error && <span className="font-mono text-[9px] text-down">FEED DELAYED</span>}
          <button type="button" onClick={() => loadMarket()} disabled={loading} aria-label="Refresh market data" title="Refresh market data" className="grid h-8 w-8 place-items-center border border-edge text-dim transition hover:border-toxic hover:text-ink disabled:opacity-50"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-up"><span className="h-1.5 w-1.5 bg-up" /> LIVE MARKET</span>
        </div>
      </div>

      <div className="grid min-h-[590px] lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="border-b border-edge lg:border-b-0 lg:border-r">
          <div className="flex min-h-[94px] items-start justify-between border-b border-edge p-5">
            <div><p className="text-base font-semibold">{market?.symbol ?? "BONK"} <span className="font-normal text-dim">{market?.name ?? "Bonk"}</span></p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{loading && !market ? "Loading live price" : price(market?.priceUsd)}</p></div>
            <div className="text-right font-mono text-[11px]"><p className={change >= 0 ? "text-up" : "text-down"}>{Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "--"}</p><p className="mt-2 text-dim">24H CHANGE</p></div>
          </div>
          <div className="grid grid-cols-3 gap-px border-b border-edge bg-edge">
            {[["LIQUIDITY", compact(market?.liquidityUsd, true)], ["24H VOLUME", compact(market?.volume24h, true)], ["FDV", compact(market?.fdv, true)]].map(([label, value]) => <div key={label} className="bg-panel px-5 py-4"><p className="font-mono text-[9px] text-dim">{label}</p><p className="mt-1.5 font-mono text-sm text-ink">{value}</p></div>)}
          </div>

          <div className="min-h-[354px] bg-void">
            {tab === "chart" && (
              <div>
                <div className="flex items-center justify-between border-b border-edge px-4 py-2">
                  <p className="font-mono text-[9px] text-dim">GECKOTERMINAL · {market?.dex?.toUpperCase() ?? "SOLANA"}</p>
                  <div className="flex gap-1">{(["minute", "hour", "day"] as Timeframe[]).map((value) => <button key={value} type="button" onClick={() => setTimeframe(value)} className={`min-h-7 px-2 font-mono text-[9px] uppercase transition ${timeframe === value ? "bg-toxic text-[#17110c]" : "border border-edge text-dim hover:text-ink"}`}>{value === "minute" ? "1M" : value === "hour" ? "1H" : "1D"}</button>)}</div>
                </div>
                <Candles data={candles} className="h-[315px] border-0" />
              </div>
            )}
            {tab === "holders" && (
              <div className="overflow-x-auto p-4"><table className="w-full min-w-[480px] text-left font-mono text-[10px]"><thead className="text-dim"><tr><th className="pb-3">RANK</th><th className="pb-3">ACCOUNT</th><th className="pb-3 text-right">AMOUNT</th><th className="pb-3 text-right">SUPPLY</th></tr></thead><tbody>{holders.slice(0, 8).map((holder) => <tr key={holder.address} className="border-t border-edge"><td className="py-3 text-dim">{String(holder.rank).padStart(2, "0")}</td><td className="py-3 text-ink">{holder.address.slice(0, 6)}...{holder.address.slice(-5)}</td><td className="py-3 text-right text-ink">{compact(holder.amount)}</td><td className="py-3 text-right text-toxic">{holder.pct == null ? "--" : `${holder.pct.toFixed(2)}%`}</td></tr>)}</tbody></table>{!holders.length && <p className="py-24 text-center text-sm text-dim">Holder data is unavailable.</p>}</div>
            )}
            {tab === "risk" && (
              <div className="grid gap-px bg-edge sm:grid-cols-2">
                {[
                  ["RISK STATUS", risk ? (risk.ok ? "PASSED" : "REVIEW") : "CHECKING", risk?.ok],
                  ["RUGCHECK SCORE", risk?.riskScore == null ? "NOT SCORED" : `${risk.riskScore}/100`, risk?.riskScore != null && risk.riskScore <= 60],
                  ["MINT AUTHORITY", risk?.mintAuthorityRevoked == null ? "UNVERIFIED" : risk.mintAuthorityRevoked ? "REVOKED" : "ACTIVE", risk?.mintAuthorityRevoked],
                  ["FREEZE AUTHORITY", risk?.freezeAuthorityRevoked == null ? "UNVERIFIED" : risk.freezeAuthorityRevoked ? "REVOKED" : "ACTIVE", risk?.freezeAuthorityRevoked],
                ].map(([label, value, good]) => <div key={String(label)} className="min-h-[112px] bg-panel p-5"><p className="font-mono text-[9px] text-dim">{label}</p><p className={`mt-3 font-mono text-sm ${good ? "text-up" : "text-down"}`}>{String(value)}</p></div>)}
                <div className="bg-panel p-5 sm:col-span-2"><p className="font-mono text-[9px] text-dim">REVIEW NOTES</p><p className="mt-3 text-xs leading-6 text-ink">{risk?.reasons?.length ? risk.reasons.slice(0, 3).join(" · ") : risk ? "No blocking checks were reported." : "Loading independent token checks."}</p></div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 border-t border-edge text-center font-mono text-[9px] text-dim">{(["chart", "holders", "risk"] as Tab[]).map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={`min-h-12 border-r border-edge uppercase transition last:border-r-0 hover:text-ink ${tab === value ? "text-toxic" : ""}`}>{value}</button>)}</div>
        </div>

        <aside className="p-5">
          <div className="grid grid-cols-2 gap-px bg-edge p-px font-mono text-[11px]">{(["buy", "sell"] as Mode[]).map((value) => <button key={value} type="button" onClick={() => { setMode(value); setAmount(value === "buy" ? 0.5 : 5_000_000); }} className={`min-h-11 uppercase transition ${mode === value ? value === "buy" ? "bg-toxic text-[#17110c]" : "bg-down text-white" : "bg-void text-dim hover:text-ink"}`}>{value}</button>)}</div>
          <label className="mt-6 block font-mono text-[9px] uppercase text-dim" htmlFor="hero-trade-amount">Amount</label>
          <div className="mt-2 flex items-center justify-between border border-edge bg-void px-3 py-3"><input id="hero-trade-amount" type="number" min="0" step={mode === "buy" ? "0.1" : "100000"} value={amount} onChange={(event) => setAmount(Number(event.target.value))} className="w-full min-w-0 bg-transparent font-mono text-base text-ink outline-none" /><span className="font-mono text-[10px] text-dim">{mode === "buy" ? "SOL" : "BONK"}</span></div>
          <div className="mt-2 grid grid-cols-4 gap-1">{presets.map((value) => <button type="button" key={value} onClick={() => setAmount(value)} className={`min-h-9 border font-mono text-[9px] transition ${amount === value ? "border-toxic text-toxic" : "border-edge text-dim hover:text-ink"}`}>{value >= 1_000_000 ? `${value / 1_000_000}M` : value}</button>)}</div>
          <label className="mt-5 block font-mono text-[9px] uppercase text-dim" htmlFor="hero-slippage">Max slippage</label>
          <div className="mt-2 flex items-center border border-edge bg-void px-3 py-2.5"><input id="hero-slippage" type="number" min="0.01" max="20" step="0.1" value={slippage} onChange={(event) => setSlippage(Number(event.target.value))} className="w-full bg-transparent font-mono text-sm outline-none" /><span className="font-mono text-[10px] text-dim">%</span></div>
          <div className="mt-5 space-y-3 border-y border-edge py-4 font-mono text-[9px]"><div className="flex justify-between gap-4"><span className="text-dim">EST. RECEIVE</span><span className="truncate text-right text-ink">{receive}</span></div><div className="flex justify-between"><span className="text-dim">PRICE IMPACT</span><span>{quote?.priceImpactPct ? `${Number(quote.priceImpactPct).toFixed(3)}%` : "--"}</span></div><div className="flex justify-between gap-3"><span className="text-dim">ROUTE</span><span className="truncate text-right">{quote?.route?.join(" / ") || "JUPITER"}</span></div></div>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-dim"><ShieldCheck size={14} className="text-up" /> MEV-aware wallet execution</div>
          <Link href={href} className={`mt-5 block w-full py-3 text-center text-xs font-semibold transition hover:brightness-110 ${mode === "buy" ? "bg-toxic text-[#17110c]" : "bg-down text-white"}`}>Open {mode} preview</Link>
          <div className="mt-5 grid grid-cols-2 gap-2"><Link href="/terminal" className="border border-edge p-3 transition hover:border-toxic"><CandlestickChart size={15} className="text-toxic" /><p className="mt-2 text-[10px] text-dim">Full terminal</p></Link><Link href="/bots" className="border border-edge p-3 transition hover:border-toxic"><Bot size={15} className="text-toxic" /><p className="mt-2 text-[10px] text-dim">Source tracking</p></Link></div>
        </aside>
      </div>
    </div>
  );
}
