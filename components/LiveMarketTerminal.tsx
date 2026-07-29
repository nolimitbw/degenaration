"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChartCandlestick,
  CircleGauge,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import Candles from "@/components/Candles";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SOL = "So11111111111111111111111111111111111111112";
const BUY_PRESETS = [0.1, 0.5, 1, 2];

type Timeframe = "minute" | "hour" | "day";
type Tab = "chart" | "holders" | "risk";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Holder = { rank: number; address: string; amount: number; pct: number | null };
type Market = {
  priceUsd: number | null;
  solPrice: number;
  liquidityUsd: number;
  symbol: string | null;
  name: string | null;
  fdv: number | null;
  volume24h: number | null;
  change24h: number | null;
  dex: string | null;
};
type Quote = {
  outAmount?: string;
  outputDecimals?: number;
  priceImpactPct?: string;
  route?: string[];
  error?: string;
};
type Risk = {
  ok: boolean;
  reasons?: string[];
  riskScore?: number | null;
  mintAuthorityRevoked?: boolean | null;
  freezeAuthorityRevoked?: boolean | null;
};

function compact(value: number | null | undefined, currency = false) {
  if (!Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(Number(value));
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
  return (value / 10 ** (decimals ?? 6)).toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}

async function json(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || "Live market request failed");
  return body;
}

export default function LiveMarketTerminal() {
  const [buyAmount, setBuyAmount] = useState(0.5);
  const [dropPercent, setDropPercent] = useState(12);
  const [capitalLimit, setCapitalLimit] = useState(3);
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

  const loadMarket = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [nextMarket, chart, holderData, riskData] = await Promise.all([
        json(`/api/price?mint=${BONK}`, signal),
        json(`/api/ohlcv?mint=${BONK}&tf=${timeframe}`, signal),
        json(`/api/holders?mint=${BONK}&net=mainnet`, signal),
        json(`/api/rugcheck?mint=${BONK}`, signal)
      ]);
      setMarket(nextMarket);
      setCandles(chart.candles ?? []);
      setHolders(holderData.holders ?? []);
      setRisk(riskData);
      setError(null);
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setError("Live providers are delayed. Automation remains fail-closed.");
      }
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    const controller = new AbortController();
    loadMarket(controller.signal);
    const timer = window.setInterval(() => loadMarket(controller.signal), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadMarket]);

  useEffect(() => {
    if (!Number.isFinite(buyAmount) || buyAmount <= 0 || buyAmount > 100) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      try {
        setQuote(await json(
          `/api/quote?in=${SOL}&out=${BONK}&amount=${Math.floor(buyAmount * 1e9)}&slippageBps=300`,
          controller.signal
        ));
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setQuote({ error: "Route estimate unavailable" });
      } finally {
        setQuoteLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [buyAmount]);

  const receive = useMemo(() => {
    if (quoteLoading) return "Refreshing";
    if (quote?.error) return "Unavailable";
    return `${units(quote?.outAmount, quote?.outputDecimals)} BONK`;
  }, [quote, quoteLoading]);

  const change = Number(market?.change24h);
  const buildHref = `/bots/kol/new?mint=${BONK}&buy=${buyAmount}&drop=${dropPercent}&capital=${capitalLimit}`;

  return (
    <div className="terminal-preview overflow-hidden border border-edge bg-panel shadow-[0_28px_80px_-54px_rgba(0,0,0,.95)]">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-2">
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-gold-400">LIVE MARKET WORKSPACE</span>
          <span className="font-mono text-[10px] text-dim">BONK / SOL</span>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="hidden font-mono text-[9px] text-down sm:inline">FEED DELAYED</span>}
          <button
            type="button"
            onClick={() => loadMarket()}
            disabled={loading}
            aria-label="Refresh market data"
            title="Refresh market data"
            className="grid h-8 w-8 place-items-center border border-edge text-dim transition hover:border-gold-400 hover:text-ink disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-up">
            <span className="h-1.5 w-1.5 bg-up" />
            LIVE DATA
          </span>
        </div>
      </header>

      {error && (
        <div className="border-b border-down/30 bg-down/5 px-4 py-2 text-xs text-down">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="border-b border-edge lg:border-b-0 lg:border-r">
          <div className="flex min-h-[92px] items-start justify-between border-b border-edge p-5">
            <div>
              <p className="text-base font-semibold text-ink">
                {market?.symbol ?? "BONK"} <span className="font-normal text-dim">{market?.name ?? "Bonk"}</span>
              </p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-ink">
                {loading && !market ? "Loading live price" : price(market?.priceUsd)}
              </p>
            </div>
            <div className="text-right font-mono text-[11px]">
              <p className={change >= 0 ? "text-up" : "text-down"}>
                {Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "--"}
              </p>
              <p className="mt-2 text-dim">24H CHANGE</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px border-b border-edge bg-edge">
            {[
              ["LIQUIDITY", compact(market?.liquidityUsd, true)],
              ["24H VOLUME", compact(market?.volume24h, true)],
              ["FDV", compact(market?.fdv, true)]
            ].map(([label, value]) => (
              <div key={label} className="bg-panel px-4 py-3.5 sm:px-5">
                <p className="font-mono text-[9px] text-dim">{label}</p>
                <p className="mt-1.5 font-mono text-sm text-ink">{value}</p>
              </div>
            ))}
          </div>

          <div className="min-h-[330px] bg-void">
            {tab === "chart" && (
              <>
                <div className="flex items-center justify-between border-b border-edge px-4 py-2">
                  <p className="font-mono text-[9px] text-dim">
                    GECKOTERMINAL · {market?.dex?.toUpperCase() ?? "SOLANA"}
                  </p>
                  <div className="flex gap-1">
                    {(["minute", "hour", "day"] as Timeframe[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTimeframe(value)}
                        className={`min-h-8 min-w-9 px-2 font-mono text-[9px] transition ${
                          timeframe === value
                            ? "bg-gold-400 text-[#17110c]"
                            : "border border-edge text-dim hover:text-ink"
                        }`}
                      >
                        {value === "minute" ? "1M" : value === "hour" ? "1H" : "1D"}
                      </button>
                    ))}
                  </div>
                </div>
                <Candles data={candles} className="h-[288px] border-0" />
              </>
            )}

            {tab === "holders" && (
              <div className="overflow-x-auto p-4">
                <table className="w-full min-w-[480px] text-left font-mono text-[10px]">
                  <thead className="text-dim">
                    <tr><th className="pb-3">RANK</th><th className="pb-3">ACCOUNT</th><th className="pb-3 text-right">AMOUNT</th><th className="pb-3 text-right">SUPPLY</th></tr>
                  </thead>
                  <tbody>
                    {holders.slice(0, 8).map((holder) => (
                      <tr key={holder.address} className="border-t border-edge">
                        <td className="py-3 text-dim">{String(holder.rank).padStart(2, "0")}</td>
                        <td className="py-3 text-ink">{holder.address.slice(0, 6)}...{holder.address.slice(-5)}</td>
                        <td className="py-3 text-right text-ink">{compact(holder.amount)}</td>
                        <td className="py-3 text-right text-gold-400">{holder.pct == null ? "--" : `${holder.pct.toFixed(2)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!holders.length && <p className="py-20 text-center text-sm text-dim">Holder data is unavailable.</p>}
              </div>
            )}

            {tab === "risk" && (
              <div className="grid gap-px bg-edge sm:grid-cols-2">
                {[
                  ["RISK STATUS", risk ? (risk.ok ? "PASSED" : "REVIEW") : "CHECKING", risk?.ok],
                  ["RUGCHECK SCORE", risk?.riskScore == null ? "NOT SCORED" : `${risk.riskScore}/100`, risk?.riskScore != null && risk.riskScore <= 60],
                  ["MINT AUTHORITY", risk?.mintAuthorityRevoked == null ? "UNVERIFIED" : risk.mintAuthorityRevoked ? "REVOKED" : "ACTIVE", risk?.mintAuthorityRevoked],
                  ["FREEZE AUTHORITY", risk?.freezeAuthorityRevoked == null ? "UNVERIFIED" : risk.freezeAuthorityRevoked ? "REVOKED" : "ACTIVE", risk?.freezeAuthorityRevoked]
                ].map(([label, value, good]) => (
                  <div key={String(label)} className="min-h-[104px] bg-panel p-5">
                    <p className="font-mono text-[9px] text-dim">{label}</p>
                    <p className={`mt-3 font-mono text-sm ${good ? "text-up" : "text-down"}`}>{String(value)}</p>
                  </div>
                ))}
                <div className="bg-panel p-5 sm:col-span-2">
                  <p className="font-mono text-[9px] text-dim">REVIEW NOTES</p>
                  <p className="mt-3 text-xs leading-6 text-ink">
                    {risk?.reasons?.length
                      ? risk.reasons.slice(0, 3).join(" · ")
                      : risk
                        ? "No blocking checks were reported."
                        : "Loading independent token checks."}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 border-t border-edge text-center font-mono text-[9px] text-dim">
            {(["chart", "holders", "risk"] as Tab[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`min-h-12 border-r border-edge uppercase transition last:border-r-0 hover:text-ink ${
                  tab === value ? "bg-panel text-gold-400" : ""
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </section>

        <aside className="p-5">
          <div className="flex items-center justify-between gap-3 border-b border-edge pb-4">
            <div>
              <p className="font-mono text-[9px] uppercase text-gold-400">KOL bot preview</p>
              <h2 className="mt-2 text-sm font-semibold text-ink">Volatility entry</h2>
            </div>
            <span className="rounded-sm border border-edge bg-void px-2 py-1 font-mono text-[9px] text-dim">MAINNET DATA</span>
          </div>

          <label className="mt-5 block">
            <span className="field-label">Buy allocation</span>
            <span className="field-control mt-1.5 flex items-center px-3">
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.1"
                value={buyAmount}
                onChange={(event) => setBuyAmount(Number(event.target.value))}
                className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
              />
              <span className="font-mono text-[9px] text-dim">SOL</span>
            </span>
          </label>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {BUY_PRESETS.map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => setBuyAmount(value)}
                className={`min-h-9 border font-mono text-[9px] transition ${
                  buyAmount === value ? "border-gold-400 bg-gold-400/10 text-gold-400" : "border-edge text-dim hover:text-ink"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="field-label">Price drop trigger</span>
              <span className="field-control mt-1.5 flex items-center px-3">
                <input
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  value={dropPercent}
                  onChange={(event) => setDropPercent(Number(event.target.value))}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
                />
                <span className="font-mono text-[9px] text-dim">%</span>
              </span>
            </label>
            <label className="block">
              <span className="field-label">Capital ceiling</span>
              <span className="field-control mt-1.5 flex items-center px-3">
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.5"
                  value={capitalLimit}
                  onChange={(event) => setCapitalLimit(Number(event.target.value))}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
                />
                <span className="font-mono text-[9px] text-dim">SOL</span>
              </span>
            </label>
          </div>

          <dl className="mt-5 space-y-3 border-y border-edge py-4 font-mono text-[9px]">
            <div className="flex justify-between gap-4">
              <dt className="text-dim">ROUTE ESTIMATE</dt>
              <dd className="truncate text-right text-ink">{receive}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-dim">PRICE IMPACT</dt>
              <dd className="text-ink">{quote?.priceImpactPct ? `${Number(quote.priceImpactPct).toFixed(3)}%` : "--"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-dim">ROUTE</dt>
              <dd className="truncate text-right text-ink">{quote?.route?.join(" / ") || "JUPITER"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-dim">MISSING DATA</dt>
              <dd className="text-up">FAIL CLOSED</dd>
            </div>
          </dl>

          <div className="mt-4 flex items-start gap-2 text-[10px] leading-4 text-dim">
            <ShieldCheck aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-up" />
            Market, authority, liquidity, and route checks run again before every eligible entry.
          </div>

          <Link
            href={buildHref}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-gold-400 px-4 text-xs font-semibold text-[#17110c] transition hover:bg-[#d1a371]"
          >
            <Bot aria-hidden="true" size={15} />
            Build this KOL bot
          </Link>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/bots/kol" className="border border-edge p-3 transition hover:border-gold-400">
              <CircleGauge aria-hidden="true" size={15} className="text-gold-400" />
              <p className="mt-2 text-[10px] text-dim">KOL marketplace</p>
            </Link>
            <Link href="/bots/discord" className="border border-edge p-3 transition hover:border-gold-400">
              <ChartCandlestick aria-hidden="true" size={15} className="text-gold-400" />
              <p className="mt-2 text-[10px] text-dim">Discord sources</p>
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
