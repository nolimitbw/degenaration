"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Candles from "@/components/Candles";
import { usePrivy } from "@privy-io/react-auth";
import { useExecuteBuy } from "@/lib/useExecuteBuy";
import { useExecuteSell } from "@/lib/useExecuteSell";
import { createLimitOrder, fmtUsd } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getNet } from "@/lib/net";
import { useQuickBuyPresets } from "@/lib/useQuickBuyPresets";
import { getSolanaAddress, getSolanaWalletId, hasDelegatedSolanaWallet } from "@/lib/solanaWallet";

const SOL = "So11111111111111111111111111111111111111112";
const SELL_PCTS = [25, 50, 75, 100];
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Mode = "buy" | "sell" | "limit";

function formatBaseUnits(value: unknown, decimals: number | null | undefined, digits = 4) {
  const raw = Number(value);
  const d = Number.isInteger(decimals) ? Number(decimals) : 6;
  if (!Number.isFinite(raw)) return "—";
  return (raw / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: digits });
}

async function fetchJson<T = any>(url: string, ms = 9000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Privy + trade-execution terminal body. Lazily loaded by app/terminal/page.tsx.
export default function TerminalBody() {
  const params = useSearchParams();
  const [mint, setMint] = useState(params.get("mint") || "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  const cleanMint = mint.trim();
  const latestMintRef = useRef(cleanMint);
  const previewSeqRef = useRef(0);
  const [mode, setMode] = useState<Mode>("buy");
  const [amount, setAmount] = useState(Number(params.get("amount")) > 0 ? Number(params.get("amount")) : 0.5);
  const [sellPct, setSellPct] = useState(100);
  const [slippage, setSlippage] = useState(3);
  const [mev, setMev] = useState(true);
  const [autoRetry, setAutoRetry] = useState(true);
  const [price, setPrice] = useState<any>(null);
  const [loadedMint, setLoadedMint] = useState<string | null>(null);
  const [quote, setQuote] = useState<any>(null);
  const [candles, setCandles] = useState<any[]>([]);
  const [holders, setHolders] = useState<any[]>([]);
  const [chartTab, setChartTab] = useState<"chart" | "holders" | "info">("chart");
  const [tf] = useState<"minute" | "hour" | "day">("hour");
  const [loading, setLoading] = useState(false);
  const [bal, setBal] = useState<{ uiAmount: number; rawAmount: string; decimals: number } | null>(null);
  const [balanceMint, setBalanceMint] = useState<string | null>(null);
  // unified trade preview modal (buy or sell)
  const [preview, setPreview] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [limitTarget, setLimitTarget] = useState(0);
  const [limitTrigger, setLimitTrigger] = useState<"below" | "above">("below");
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const executeBuy = useExecuteBuy();
  const executeSell = useExecuteSell();
  const { presets: AMOUNTS } = useQuickBuyPresets();
  const toast = useToast();
  const pubkey = getSolanaAddress(user);
  const mintOk = MINT_RE.test(cleanMint);
  const walletId = getSolanaWalletId(user);
  const delegated = hasDelegatedSolanaWallet(user);
  const amountOk = Number.isFinite(amount) && amount > 0 && amount <= 100;
  const slippageOk = Number.isFinite(slippage) && slippage > 0 && slippage <= 20;
  const slippageBps = Math.round(slippage * 100);
  const canCreateLimit = mintOk && amountOk && slippageOk && limitTarget > 0 && (!authenticated || (walletId && delegated));
  const tokenLoaded = mintOk && loadedMint === cleanMint;
  const livePrice = tokenLoaded ? price : null;
  const liveBal = balanceMint === cleanMint ? bal : null;
  const validPresetAmounts = AMOUNTS.filter((a) => Number.isFinite(a) && a > 0 && a <= 100);

  useEffect(() => { latestMintRef.current = cleanMint; }, [cleanMint]);

  const loadBalance = useCallback(async () => {
    const currentMint = mint.trim();
    if (!pubkey || !MINT_RE.test(currentMint)) { setBal(null); setBalanceMint(null); return; }
    setBal(null);
    setBalanceMint(null);
    const b = await fetch(`/api/token-balance?owner=${pubkey}&mint=${currentMint}&net=${getNet()}`).then((r) => r.json()).catch(() => null);
    if (currentMint !== latestMintRef.current) return;
    if (b && !b.error) { setBal({ uiAmount: b.uiAmount, rawAmount: b.rawAmount, decimals: b.decimals }); setBalanceMint(currentMint); }
    else { setBal(null); setBalanceMint(null); }
  }, [pubkey, mint]);

  async function createLimit() {
    if (!authenticated) { login(); return; }
    if (!mintOk || limitTarget <= 0 || !amountOk) { toast("Enter a valid mint, target price and amount", "err"); return; }
    if (!slippageOk) { toast("Use slippage between 0.01% and 20%", "err"); return; }
    if (!pubkey) { toast("No wallet found", "err"); return; }
    if (!walletId || !delegated) { toast("Enable 24/7 auto-trading in Wallet before creating limits", "err"); return; }
    const { error } = await createLimitOrder({ mint: cleanMint, symbol: livePrice?.symbol || cleanMint.slice(0, 6), trigger: limitTrigger, target_usd: limitTarget, amount_sol: amount, slippage_bps: slippageBps, user_pubkey: pubkey, wallet_id: walletId }, await getAccessToken());
    if (error) { toast(error.message || "Could not save order", "err"); return; }
    toast("Limit order created — see Limit Orders");
  }

  async function load() {
    if (!mintOk) { toast("Enter a valid Solana token mint", "err"); return; }
    if (!slippageOk) { toast("Use slippage between 0.01% and 20%", "err"); return; }
    setLoading(true);
    setLoadedMint(null);
    setPrice(null);
    setQuote(null);
    setCandles([]);
    setHolders([]);
    try {
      const targetMint = cleanMint;
      const quoteUrl = amountOk ? `/api/quote?in=${SOL}&out=${cleanMint}&amount=${Math.floor(amount * 1e9)}&slippageBps=${slippageBps}` : null;
      const [p, oh, hd, q] = await Promise.all([
        fetchJson(`/api/price?mint=${cleanMint}`),
        fetchJson(`/api/ohlcv?mint=${cleanMint}&tf=${tf}`),
        fetchJson(`/api/holders?mint=${cleanMint}`),
        quoteUrl ? fetchJson(quoteUrl) : Promise.resolve(null)
      ]);
      if (targetMint !== latestMintRef.current) return;
      setPrice(p);
      setLoadedMint(targetMint);
      setCandles(oh?.candles ?? []);
      setHolders(hd?.holders ?? []);
      setQuote(q && !q.error ? q : null);
      if (q?.error) toast(q.error, "err");
    } finally {
      setLoading(false);
      loadBalance();
    }
  }

  // auto-load the token on mount (covers arriving via /terminal?mint=... from Quick trade)
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  // keep the balance fresh once a wallet is connected
  useEffect(() => { loadBalance(); }, [loadBalance]);
  // Any trade input change invalidates the displayed quote until the next load/preview.
  useEffect(() => { setQuote(null); }, [cleanMint, amount, slippage, mode]);
  useEffect(() => {
    previewSeqRef.current++;
    setPreviewOpen(false);
    setPreview(null);
    setPreviewLoading(false);
    setBal(null);
    setBalanceMint(null);
  }, [cleanMint]);

  // BUY preview: simulate the SOL->token swap, then confirm & sign
  async function runBuyPreview() {
    if (!authenticated) { login(); return; }
    if (!mintOk) { toast("Enter a valid Solana token mint", "err"); return; }
    if (!amountOk) { toast("Enter a buy amount between 0 and 100 SOL", "err"); return; }
    if (!slippageOk) { toast("Use slippage between 0.01% and 20%", "err"); return; }
    const seq = ++previewSeqRef.current;
    const targetMint = cleanMint;
    const targetAmount = amount;
    const targetSlippageBps = slippageBps;
    setPreviewOpen(true); setPreviewLoading(true); setPreview(null);
    const s = await fetch(`/api/simulate?in=${SOL}&out=${targetMint}&amount=${Math.floor(targetAmount * 1e9)}&slippageBps=${targetSlippageBps}`)
      .then((r) => r.json()).catch(() => ({ error: "Simulation failed — try again." }));
    if (seq !== previewSeqRef.current || targetMint !== latestMintRef.current) return;
    setPreview({ side: "buy", mint: targetMint, amountSol: targetAmount, slippageBps: targetSlippageBps, ...s }); setPreviewLoading(false);
  }

  // SELL preview: quote token->SOL for the chosen % of the live balance
  async function runSellPreview() {
    if (!authenticated) { login(); return; }
    if (!mintOk) { toast("Enter a valid Solana token mint", "err"); return; }
    if (!slippageOk) { toast("Use slippage between 0.01% and 20%", "err"); return; }
    if (!liveBal || liveBal.uiAmount <= 0) { toast("You don't hold this token", "err"); return; }
    const seq = ++previewSeqRef.current;
    const targetMint = cleanMint;
    const targetSellPct = sellPct;
    const targetSlippageBps = slippageBps;
    const targetBalance = liveBal;
    setPreviewOpen(true); setPreviewLoading(true); setPreview(null);
    const rawTotal = BigInt(targetBalance.rawAmount || "0");
    const rawAmt = (rawTotal * BigInt(Math.round((targetSellPct / 100) * 10000))) / BigInt(10000);
    if (rawAmt <= BigInt(0)) { setPreview({ side: "sell", mint: targetMint, sellPct: targetSellPct, error: "Amount too small" }); setPreviewLoading(false); return; }
    const q = await fetch(`/api/quote?in=${targetMint}&out=${SOL}&amount=${rawAmt.toString()}&slippageBps=${targetSlippageBps}`)
      .then((r) => r.json()).catch(() => ({ error: "Quote failed — try again." }));
    if (seq !== previewSeqRef.current || targetMint !== latestMintRef.current) return;
    const solOut = q.outAmount ? Number(q.outAmount) / 1e9 : null;
    const sellUi = targetBalance.uiAmount * (targetSellPct / 100);
    setPreview({ side: "sell", mint: targetMint, sellPct: targetSellPct, slippageBps: targetSlippageBps, ...q, solOut, sellUi }); setPreviewLoading(false);
  }

  async function confirmTrade() {
    if (!authenticated) { login(); return; }
    if (!preview || preview.error) { toast("Preview the trade first", "err"); return; }
    if (!mintOk || !slippageOk) { toast("Fix the trade inputs first", "err"); return; }
    if (preview.mint !== cleanMint) { toast("Token changed — preview again", "err"); return; }
    if (preview.slippageBps !== slippageBps) { toast("Slippage changed — preview again", "err"); return; }
    if (preview.side === "buy" && (!amountOk || preview.amountSol !== amount)) { toast("Amount changed — preview again", "err"); return; }
    if (preview.side === "sell" && (!liveBal || preview.sellPct !== sellPct)) { toast("Sell amount changed — preview again", "err"); return; }
    setExecuting(true);
    const execution = {
      side: preview.side as "buy" | "sell",
      mint: preview.mint as string,
      amountSol: Number(preview.amountSol),
      sellPct: Number(preview.sellPct),
      slippageBps: Number(preview.slippageBps),
      priceUsd: livePrice?.priceUsd,
      symbol: livePrice?.symbol,
      mev
    };
    const retries = autoRetry ? 3 : 1;
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (execution.side === "sell") {
        const r = await executeSell({ mint: execution.mint, pct: execution.sellPct / 100, slippageBps: execution.slippageBps, priceUsd: execution.priceUsd, symbol: execution.symbol, mev: execution.mev });
        if (r.ok) {
          setExecuting(false);
          toast("Sell sent — " + (r.sig?.slice(0, 8) ?? ""));
          setPreviewOpen(false);
          setTimeout(loadBalance, 4000);
          return;
        }
        if (attempt < retries) { toast(`Retry ${attempt}/${retries - 1}…`, "info"); continue; }
        setExecuting(false);
        toast(r.error || "Sell failed", "err");
      } else {
        const r = await executeBuy({ mint: execution.mint, solAmount: execution.amountSol, slippageBps: execution.slippageBps, priceUsd: execution.priceUsd, symbol: execution.symbol, mev: execution.mev });
        if (r.ok) {
          setExecuting(false);
          toast("Buy sent — " + (r.sig?.slice(0, 8) ?? ""));
          setPreviewOpen(false);
          setTimeout(loadBalance, 4000);
          return;
        }
        if (attempt < retries) { toast(`Retry ${attempt}/${retries - 1}…`, "info"); continue; }
        setExecuting(false);
        toast(r.error || "Buy failed", "err");
      }
    }
  }

  const chg = livePrice?.change24h;
  const priceLabel = livePrice?.priceUsd ? `$${livePrice.priceUsd}` : tokenLoaded ? "No price" : "Load a token";
  const feeBps = Number(quote?.platformFeeBps ?? preview?.platformFeeBps ?? 0) || 0;
  const feeLabel = feeBps > 0 ? `${(feeBps / 100).toFixed(0)}% platform` : "No platform fee";
  const quoteLabel = mode === "buy" && livePrice?.priceUsd && livePrice?.solPrice
    ? `${(amount * livePrice.solPrice / livePrice.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${livePrice?.symbol ?? "tokens"}`
    : quote?.outAmount ? `${formatBaseUnits(quote.outAmount, quote.outputDecimals, 2)} ${livePrice?.symbol ?? "tokens"}` : "Preview required";

  return (
    <>
      <div className="terminal-hero flex flex-wrap items-center justify-between gap-4 rounded-lg border border-edge bg-panel p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">Trade Terminal</h1>
            <span className="rounded-full border border-toxic/40 px-2 py-0.5 font-mono text-[10px] text-toxic">LIVE</span>
            <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-dim">Jupiter routed</span>
          </div>
          <p className="mt-1 text-xs text-dim">Market buys, sells, and limit orders. Every execution requires your wallet signature.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Token mint address"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic sm:w-80" />
          <button onClick={load} disabled={loading || !mintOk} className="min-h-11 rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
            {loading ? "Loading" : "Load"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* chart + info */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-edge bg-panel p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {livePrice?.image ? <img src={livePrice.image} alt="" className="h-11 w-11 rounded-full" /> : <div className="grid h-11 w-11 place-items-center rounded-full bg-edge font-mono text-xs">{(livePrice?.symbol ?? mint).slice(0, 2)}</div>}
                <div>
                  <p className="font-mono text-sm font-bold">{livePrice?.symbol ?? mint.slice(0, 6)} <span className="text-dim">{livePrice?.name ? `· ${livePrice.name}` : ""}</span></p>
                  <p className="mt-0.5 font-mono text-2xl font-bold">{priceLabel}</p>
                </div>
              </div>
              <div className="text-right font-mono text-xs">
                <p className={chg >= 0 ? "text-up" : "text-hotpink"}>
                  {chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% 24h` : "—"}
                </p>
                <p className="text-dim">Liq {fmtUsd(Number(livePrice?.liquidityUsd) || null)} · {livePrice?.dex ?? "—"}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 border-t border-edge pt-3 font-mono text-[11px] sm:grid-cols-3">
              <div className="rounded-md bg-void px-3 py-2"><p className="text-dim">Est. receive</p><p className="mt-0.5 text-ink">{quoteLabel}</p></div>
              <div className="rounded-md bg-void px-3 py-2"><p className="text-dim">Fee</p><p className="mt-0.5 text-ink">{feeLabel}</p></div>
              <div className="rounded-md bg-void px-3 py-2"><p className="text-dim">Custody</p><p className="mt-0.5 text-ink">Wallet-signed</p></div>
            </div>
            <div className="mt-3 flex gap-1">
              {(["chart", "holders", "info"] as const).map((t) => (
                <button key={t} onClick={() => setChartTab(t)}
                  className={`rounded px-3 py-1.5 font-mono text-[11px] font-bold transition ${chartTab === t ? "bg-toxic text-white" : "border border-edge text-dim hover:text-ink"}`}>{t.toUpperCase()}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-edge pt-3 font-mono text-[11px] sm:grid-cols-4">
              <div><p className="text-dim">FDV</p><p className="text-ink">{fmtUsd(Number(livePrice?.fdv) || null)}</p></div>
              <div><p className="text-dim">24h Vol</p><p className="text-ink">{fmtUsd(Number(livePrice?.volume24h) || null)}</p></div>
              <div><p className="text-dim">Buys/Sells</p><p><span className="text-toxic">{livePrice?.buys24h ?? "—"}</span><span className="text-dim">/</span><span className="text-hotpink">{livePrice?.sells24h ?? "—"}</span></p></div>
              <div><p className="text-dim">Socials</p><p className="flex gap-2">{(livePrice?.socials || []).slice(0, 3).map((x: any) => (<a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="text-cyber hover:underline">{x.type?.slice(0, 2)}</a>))}{!(livePrice?.socials || []).length && <span className="text-dim">—</span>}</p></div>
            </div>
            {chartTab === "chart" && <div className="mt-3">
              {livePrice?.pairAddress ? (
                <iframe key={livePrice.pairAddress}
                  src={`https://dexscreener.com/${livePrice.chainId || "solana"}/${livePrice.pairAddress}?embed=1&theme=dark&trades=0&info=0`}
                  className="h-[420px] w-full rounded-md border border-edge" title="chart" />
              ) : candles.length ? (<Candles data={candles} />) : (
                <div className="grid h-72 place-items-center rounded-md border border-edge bg-void text-sm text-dim">Load a token to see its live DexScreener chart.</div>
              )}
            </div>}
            {chartTab === "holders" && (
              <div className="mt-3 overflow-hidden rounded-md border border-edge">
                <table className="w-full text-left text-xs"><thead className="bg-panel font-mono uppercase text-dim"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Holder</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">%</th></tr></thead>
                  <tbody>{holders.length ? holders.map((h) => (<tr key={h.address} className="border-t border-edge font-mono"><td className="px-3 py-2">{h.rank}</td><td className="px-3 py-2 text-cyber">{h.address.slice(0, 4)}…{h.address.slice(-4)}</td><td className="px-3 py-2">{Math.round(h.amount).toLocaleString()}</td><td className="px-3 py-2 text-toxic">{h.pct != null ? h.pct.toFixed(2) + "%" : "—"}</td></tr>)) : <tr><td colSpan={4} className="px-3 py-6 text-center text-dim">Load a token to see holders.</td></tr>}</tbody></table>
              </div>
            )}
            {chartTab === "info" && (
              <div className="mt-3 space-y-2 rounded-md border border-edge bg-void p-4 font-mono text-xs">
                <p className="text-dim">Name: <span className="text-ink">{livePrice?.name ?? "—"}</span></p>
                <p className="text-dim">Symbol: <span className="text-ink">{livePrice?.symbol ?? "—"}</span></p>
                <p className="text-dim">FDV: <span className="text-ink">{livePrice?.fdv ? "$" + Math.round(livePrice.fdv).toLocaleString() : "—"}</span></p>
                <p className="text-dim">Mint: <span className="break-all text-ink">{cleanMint}</span></p>
                <p className="text-dim">Links: {(livePrice?.websites || []).concat((livePrice?.socials || []).map((x: any) => x.url)).slice(0, 4).map((u: string) => (<a key={u} href={u} target="_blank" rel="noreferrer" aria-label="Open link" className="mr-2 text-cyber hover:underline">↗</a>))}{!(livePrice?.websites || []).length && !(livePrice?.socials || []).length && <span className="text-ink">—</span>}</p>
              </div>
            )}
          </div>
        </div>

        {/* trade panel */}
        <div className="rounded-lg border border-edge bg-panel p-5">
          <div className="grid grid-cols-3 rounded-md border border-edge p-1 font-mono text-xs">
            {(["buy", "sell", "limit"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`rounded py-2 font-bold uppercase transition ${
                  mode === m
                    ? m === "sell" ? "bg-hotpink text-white" : "bg-toxic text-white"
                    : "text-dim hover:text-ink"
                }`}>{m}</button>
            ))}
          </div>

          {/* your holdings (visible in sell/buy when connected) */}
          {authenticated && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-edge bg-void px-3 py-2 font-mono text-[11px]">
              <span className="text-dim">Your balance</span>
              <span className="text-ink">{liveBal ? `${liveBal.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${livePrice?.symbol ?? ""}` : "—"}</span>
            </div>
          )}

          {mode === "sell" ? (
            <>
              <div className="mt-4">
                <span className="font-mono text-[11px] uppercase text-dim">Sell amount</span>
                <div className="mt-1 grid grid-cols-4 gap-1">
                  {SELL_PCTS.map((p) => (
                    <button key={p} onClick={() => setSellPct(p)}
                      className={`rounded border py-2 font-mono text-xs font-bold transition ${sellPct === p ? "border-hotpink bg-hotpink/15 text-hotpink" : "border-edge text-dim hover:text-ink"}`}>{p}%</button>
                  ))}
                </div>
                {liveBal && liveBal.uiAmount > 0 && (
                  <p className="mt-1.5 font-mono text-[11px] text-dim">≈ {(liveBal.uiAmount * sellPct / 100).toLocaleString(undefined, { maximumFractionDigits: 4 })} {livePrice?.symbol ?? "tokens"}</p>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="mt-4 block">
                <span className="font-mono text-[11px] uppercase text-dim">Amount (SOL)</span>
                <input type="number" step="0.1" value={amount} onChange={(e) => setAmount(+e.target.value)}
                  className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                {!amountOk && <span className="mt-1 block font-mono text-[10px] text-hotpink">Use an amount above 0 and at most 100 SOL.</span>}
              </label>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {validPresetAmounts.map((a) => (
                  <button key={a} onClick={() => setAmount(a)}
                    className="rounded border border-edge py-1.5 font-mono text-xs text-dim transition hover:border-toxic hover:text-toxic">{a}</button>
                ))}
              </div>
            </>
          )}

          <label className="mt-4 block">
            <span className="font-mono text-[11px] uppercase text-dim">Max slippage %</span>
            <input type="number" value={slippage} onChange={(e) => setSlippage(+e.target.value)}
              className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
            {!slippageOk && <span className="mt-1 block font-mono text-[10px] text-hotpink">Use slippage between 0.01% and 20%.</span>}
          </label>

          {mode === "limit" && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="font-mono text-[11px] uppercase text-dim">Trigger</span>
                <select value={limitTrigger} onChange={(e) => setLimitTrigger(e.target.value as any)} className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono text-sm outline-none focus:border-toxic">
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
          {mode === "limit" && authenticated && pubkey && (!walletId || !delegated) && (
            <p className="mt-3 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-[11px] text-hotpink">
              Enable 24/7 auto-trading in Wallet before saving offline limit orders.
            </p>
          )}

          {mode !== "sell" && (
            <div className="mt-4 space-y-2 text-sm">
              {[
                { l: "MEV protection", v: mev, set: setMev },
                { l: "Auto-retry", v: autoRetry, set: setAutoRetry }
              ].map((o) => (
                <label key={o.l} className="flex items-center gap-2 text-dim">
                  <input type="checkbox" checked={o.v} onChange={(e) => o.set(e.target.checked)} className="accent-toxic" />
                  {o.l}
                </label>
              ))}
            </div>
          )}

          {mode === "buy" && (livePrice?.priceUsd || quote?.outAmount) && (
            <p className="mt-4 rounded-md border border-edge bg-void px-3 py-2 font-mono text-[11px] text-toxic">
              ≈ {livePrice?.priceUsd && livePrice?.solPrice ? (amount * livePrice.solPrice / livePrice.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 }) : formatBaseUnits(quote.outAmount, quote.outputDecimals, 2)} {livePrice?.symbol ?? "tokens"} · {feeBps > 0 ? `${feeBps / 100}% fee applied` : "fee wallet not configured"}
            </p>
          )}

          {mode === "limit" ? (
            <button onClick={createLimit} disabled={authenticated && !canCreateLimit}
              className="mt-4 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
              {!authenticated ? "Connect wallet for limit" : !walletId || !delegated ? "Enable auto-trading first" : "Create limit order"}
            </button>
          ) : mode === "sell" ? (
            <button onClick={runSellPreview} disabled={previewLoading || (authenticated && (!mintOk || !slippageOk || !liveBal || liveBal.uiAmount <= 0))}
              className="mt-4 w-full rounded-md bg-hotpink py-3 font-bold text-white shadow-pink transition hover:brightness-110 disabled:opacity-50">
              {!slippageOk ? "Fix slippage" : !authenticated ? "Connect wallet to sell" : !liveBal || liveBal.uiAmount <= 0 ? "No balance to sell" : `Sell ${sellPct}%`}
            </button>
          ) : (
            <button onClick={runBuyPreview} disabled={previewLoading || !mintOk || !amountOk || !slippageOk}
              className="mt-4 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
              {!amountOk ? "Fix amount" : !slippageOk ? "Fix slippage" : !authenticated ? "Connect wallet to buy" : `Buy ${amount} SOL`}
            </button>
          )}
          <p className="mt-2 text-center font-mono text-[10px] text-dim">{mode === "limit" ? "Auto-buys when the target hits (watch on Limit Orders)" : "Preview the trade, then sign in your wallet"}</p>
        </div>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onClick={() => { if (!executing) setPreviewOpen(false); }}>
          <div className="w-full max-w-md rounded-lg border border-edge bg-panel p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{preview?.side === "sell" ? "Sell preview" : "Buy preview"}</h3>
              <button onClick={() => { if (!executing) setPreviewOpen(false); }} disabled={executing} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">x</button>
            </div>
            {previewLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-dim"><span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-toxic" /> Fetching quote…</div>
            ) : preview?.error ? (
              <p className="mt-4 font-mono text-sm text-hotpink">{preview.error}</p>
            ) : preview?.side === "sell" ? (
              <div className="mt-4 space-y-2 font-mono text-sm">
                <div className="flex justify-between"><span className="text-dim">You sell</span><span>{preview.sellUi?.toLocaleString(undefined, { maximumFractionDigits: 4 })} {livePrice?.symbol}</span></div>
                <div className="flex justify-between"><span className="text-dim">You receive (est.)</span><span className="text-toxic">{preview.solOut != null ? `${preview.solOut.toFixed(4)} SOL` : "—"}</span></div>
                <div className="flex justify-between"><span className="text-dim">Price impact</span><span className={preview.priceImpactPct > 10 ? "text-hotpink" : ""}>{preview.priceImpactPct != null ? `${Math.abs(preview.priceImpactPct).toFixed(2)}%` : "—"}</span></div>
                <div className="flex justify-between"><span className="text-dim">Platform fee</span><span>{preview.platformFeeBps ? `${preview.platformFeeBps / 100}%` : "not configured"}</span></div>
                <div className="flex justify-between"><span className="text-dim">Route</span><span className="text-dim">{(preview.route || []).join(" → ") || "—"}</span></div>
                <button onClick={confirmTrade} disabled={executing}
                  className="mt-2 w-full rounded-md bg-hotpink py-3 font-bold text-white shadow-pink transition hover:brightness-110 disabled:opacity-50">
                  {executing ? "Awaiting signature…" : "Confirm sell & sign"}
                </button>
              </div>
            ) : preview ? (
              <div className="mt-4 space-y-2 font-mono text-sm">
                <div className="flex justify-between"><span className="text-dim">You pay</span><span>{preview.inAmountSol} SOL</span></div>
                <div className="flex justify-between"><span className="text-dim">You receive (est.)</span><span className="text-toxic">{livePrice?.priceUsd && livePrice?.solPrice ? (preview.inAmountSol * livePrice.solPrice / livePrice.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 }) : formatBaseUnits(preview.outAmount, preview.outputDecimals, 2)} {livePrice?.symbol}</span></div>
                <div className="flex justify-between"><span className="text-dim">Min received</span><span>{formatBaseUnits(preview.minReceived, preview.outputDecimals)}</span></div>
                <div className="flex justify-between"><span className="text-dim">Price impact</span><span className={preview.priceImpactPct > 10 ? "text-hotpink" : ""}>{preview.priceImpactPct.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-dim">Platform fee</span><span>{preview.platformFeeBps ? `${preview.feeSol.toFixed(4)} SOL` : "not configured"}</span></div>
                <div className="flex justify-between"><span className="text-dim">Route</span><span className="text-dim">{(preview.route || []).join(" → ") || "—"}</span></div>
                {preview.warn && <p className="rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 text-[11px] text-hotpink">{preview.warn}</p>}
                <button onClick={confirmTrade} disabled={executing}
                  className="mt-2 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
                  {executing ? "Awaiting signature…" : "Confirm buy & sign"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
