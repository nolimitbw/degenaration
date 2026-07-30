"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase58Decoder } from "@solana/kit";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  Share2,
  ShieldAlert,
  WalletCards,
  X
} from "lucide-react";
import { PageHeader, Segmented, StatusPill } from "@/components/product/Primitives";
import { useToast } from "@/components/Toast";
import PortfolioCurveIcon from "@/components/icons/PortfolioCurveIcon";
import { getSolanaAddress, getSolanaWalletId } from "@/lib/solanaWallet";
import { fetchPortfolio, fmtUsd, type Portfolio } from "@/lib/queries";
import { formatPercentBps, formatSol, formatWhen, lamportsToSol, productFetch } from "@/lib/product-api";
import { getNet } from "@/lib/net";
import { portfolioStatistics } from "@/lib/portfolio-stats";

type Period = "7d" | "30d" | "3m";
type View = "overview" | "positions" | "trades" | "movements";

export type PortfolioSummary = {
  period: Period;
  performance: {
    sampleSize?: number;
    netPnlLamports?: number | string | null;
    realizedPnlLamports?: number | string | null;
    volumeLamports?: number | string | null;
    networkFeesLamports?: number | string | null;
    platformFeesLamports?: number | string | null;
    creatorFeesLamports?: number | string | null;
    maxDrawdownBps?: number | null;
    winRateBps?: number | null;
    metrics?: Record<string, any> | null;
    asOf?: string;
  } | null;
  positions: Array<any>;
  executions: Array<any>;
  cashMovements: Array<any>;
  legacyTrades: Array<any>;
};

export default function PortfolioDashboard() {
  const { authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const toast = useToast();
  const walletAddress = getSolanaAddress(user);
  const [period, setPeriod] = useState<Period>("30d");
  const [view, setView] = useState<View>("overview");
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [walletPortfolio, setWalletPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [share, setShare] = useState<{ type: "portfolio" | "position"; id?: string } | null>(null);
  const [botFilter, setBotFilter] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bot = params.get("bot") || "";
    const requestedView = params.get("view");
    setBotFilter(/^[0-9a-f-]{36}$/i.test(bot) ? bot : "");
    if (requestedView === "positions" || requestedView === "trades" || requestedView === "movements") {
      setView(requestedView);
    } else if (bot) {
      setView("positions");
    }
  }, []);

  const load = useCallback(() => {
    if (!authenticated) {
      setSummary(null);
      setWalletPortfolio(null);
      return;
    }
    setLoading(true);
    setError("");
    // Bounded so a hung provider cannot leave the page spinning forever.
    const signal = AbortSignal.timeout(15000);
    // allSettled, not all: an on-chain wallet lookup failing must not blank the whole
    // portfolio, and a failed summary must not leave the page rendering nothing (§16).
    Promise.allSettled([
      productFetch<PortfolioSummary>(`/api/product/portfolio?period=${period}`, { getAccessToken }, { signal }),
      walletAddress ? fetchPortfolio(walletAddress, getNet()) : Promise.resolve(null)
    ])
      .then(([product, chain]) => {
        if (product.status === "fulfilled") {
          setSummary(product.value);
          setUpdatedAt(Date.now());
        } else {
          // Keep the last known summary rather than blanking it; it renders as stale.
          setError(product.reason instanceof Error ? product.reason.message : "Portfolio data is temporarily unavailable.");
        }
        if (chain.status === "fulfilled") setWalletPortfolio(chain.value);
      })
      .finally(() => setLoading(false));
  }, [authenticated, getAccessToken, period, walletAddress]);

  useEffect(() => { load(); }, [load]);

  const openPositions = summary?.positions.filter((position) => ["opening", "open", "closing"].includes(position.status)) || [];
  const visiblePositions = botFilter ? (summary?.positions || []).filter((position) => position.botId === botFilter) : (summary?.positions || []);
  const visibleExecutions = botFilter ? (summary?.executions || []).filter((execution) => execution.botId === botFilter) : (summary?.executions || []);
  const filteredBotName = visiblePositions[0]?.botName || visibleExecutions[0]?.botName;
  const allocated = openPositions.reduce((total, position) => total + lamportsToSol(position.costLamports), 0);
  const realized = lamportsToSol(summary?.performance?.realizedPnlLamports);
  const netPnl = lamportsToSol(summary?.performance?.netPnlLamports);
  const fees = lamportsToSol(summary?.performance?.networkFeesLamports) + lamportsToSol(summary?.performance?.platformFeesLamports) + lamportsToSol(summary?.performance?.creatorFeesLamports);
  const executionBuys = summary?.executions.filter((execution) => execution.side === "buy").length || 0;
  const executionSells = summary?.executions.filter((execution) => execution.side === "sell").length || 0;
  // Reference R5 reports buy/sell VOLUME alongside transaction counts, and wins vs losses
  // as counts distinct from the win-rate percentage. Computed in a tested module because
  // this page is auth-gated and cannot be exercised in a browser without a session.
  const stats = portfolioStatistics(summary);
  const lastExecution = summary?.executions[0]?.created_at || summary?.legacyTrades[0]?.created_at;
  const uniqueTokens = new Set([...(summary?.executions || []).map((execution) => execution.mint), ...(summary?.legacyTrades || []).map((trade) => trade.mint)]).size;
  const availableSol = walletPortfolio?.sol ?? 0;
  const totalUsd = walletPortfolio?.totalUsd ?? 0;
  const totalSolEquivalent = walletPortfolio?.solPrice ? totalUsd / walletPortfolio.solPrice : availableSol;

  if (!authenticated) {
    return (
      <>
        <PageHeader title="Portfolio" description="Balances, positions, performance, and transactions." />
        <div className="mt-6 grid min-h-72 place-items-center border border-edge bg-panel p-8 text-center">
          <div className="max-w-md"><PortfolioCurveIcon className="mx-auto text-gold-400" size={26} /><h2 className="mt-4 text-base font-semibold text-ink">Connect to view your portfolio</h2><p className="mt-2 text-sm leading-6 text-dim">Private performance and bot execution records are scoped to your verified Privy account.</p><button type="button" onClick={login} className="mt-5 min-h-11 rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c]">Connect account</button></div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Balances, positions, performance, and transactions."
        actions={
          <>
            <button type="button" onClick={load} className="grid h-10 w-10 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh portfolio"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
            <button type="button" onClick={() => setDepositOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink"><ArrowDownToLine size={15} /> Deposit</button>
            <button type="button" onClick={() => setWithdrawOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c]"><ArrowUpFromLine size={15} /> Withdraw</button>
            <button
              type="button"
              onClick={async () => {
                setSigningOut(true);
                try {
                  await logout();
                } finally {
                  setSigningOut(false);
                }
              }}
              disabled={signingOut}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-down/40 px-4 text-sm font-semibold text-down transition hover:bg-down/5 disabled:opacity-50"
            >
              {signingOut ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <LogOut aria-hidden="true" size={15} />}
              Sign out
            </button>
          </>
        }
      />

      <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
        <div className="grid gap-px bg-edge lg:grid-cols-[1.35fr_repeat(4,1fr)]">
          <div className="bg-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="field-label">Total portfolio value</p><span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase text-dim"><span className="h-1.5 w-1.5 rounded-full bg-up" /> Solana Mainnet</span></div>
            <p className="mt-3 font-mono text-3xl font-semibold text-ink">{totalSolEquivalent.toFixed(3)} <span className="text-base text-dim">SOL</span></p>
            <p className="mt-1 font-mono text-xs text-dim">{fmtUsd(totalUsd)}</p>
          </div>
          <BalanceMetric label="Available" value={`${availableSol.toFixed(3)} SOL`} detail="Wallet balance" />
          <BalanceMetric label="Allocated" value={`${allocated.toFixed(3)} SOL`} detail={`${openPositions.length} open positions`} />
          <BalanceMetric label="Realized PnL" value={`${realized >= 0 ? "+" : ""}${realized.toFixed(3)} SOL`} detail={period.toUpperCase()} tone={realized >= 0 ? "positive" : "negative"} />
          <BalanceMetric label="Net PnL" value={`${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(3)} SOL`} detail="After recorded fees" tone={netPnl >= 0 ? "positive" : "negative"} />
        </div>
      </section>

      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-edge" aria-label="Portfolio views">
        {[
          ["overview", "Overview"],
          ["positions", `Positions ${openPositions.length}`],
          ["trades", `Trades ${(summary?.executions.length || 0) + (summary?.legacyTrades.length || 0)}`],
          ["movements", "Deposits & withdrawals"]
        ].map(([value, label]) => (
          <button key={value} type="button" onClick={() => setView(value as View)} className={`relative min-h-11 shrink-0 px-4 text-sm font-medium ${view === value ? "text-ink" : "text-dim hover:text-ink"}`}>{label}{view === value && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-gold-400" />}</button>
        ))}
      </nav>

      {botFilter && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-gold-400/30 bg-gold-400/5 px-4 py-3">
          <p className="text-xs text-dim">Showing records for <span className="font-semibold text-ink">{filteredBotName || "the selected bot"}</span>.</p>
          <Link href="/portfolio?view=positions" className="text-xs font-semibold text-gold-400">Clear filter</Link>
        </div>
      )}

      {/* Skeleton shaped like the real content, never a spinner in an empty rectangle. */}
      {loading && !summary && (
        <div className="mt-5 space-y-5" aria-busy="true">
          <div className="grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((key) => <div key={key} className="bg-panel p-5"><div className="h-3 w-24 animate-pulse rounded bg-void" /><div className="mt-3 h-5 w-28 animate-pulse rounded bg-void" /></div>)}
          </div>
          <div className="h-64 animate-pulse rounded-md border border-edge bg-panel" />
        </div>
      )}

      {/* Recoverable failure with a retry, instead of a blank page and a vanished toast. */}
      {!loading && !summary && error && (
        <div className="mt-5 rounded-md border border-edge bg-panel p-6">
          <p className="text-sm font-semibold text-ink">Portfolio could not be loaded</p>
          <p className="mt-1 text-xs leading-5 text-dim">{error}</p>
          <button type="button" onClick={load} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-xs font-semibold text-ink"><RefreshCw size={14} /> Try again</button>
        </div>
      )}

      {/* Last known data preserved on a transient failure and labelled as stale. */}
      {summary && error && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-md border border-edge bg-panel px-4 py-3">
          <p className="text-xs text-dim">Showing the last loaded data{updatedAt ? ` from ${new Date(updatedAt).toLocaleTimeString()}` : ""}. {error}</p>
          <button type="button" onClick={load} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink"><RefreshCw size={13} /> Retry</button>
        </div>
      )}
      {summary && view === "overview" && (
        <>
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="overflow-hidden rounded-md border border-edge bg-panel">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4"><div><h2 className="text-sm font-semibold text-ink">Portfolio performance</h2><p className="mt-1 text-[11px] text-dim">Equity time series excludes deposits and withdrawals from trading return.</p></div><Segmented value={period} onChange={setPeriod} label="Portfolio period" options={[{ value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "3m", label: "3M" }]} /></header>
              <PortfolioPerformanceChart performance={summary.performance} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-4"><p className="text-[11px] text-dim">As of {formatWhen(summary.performance?.asOf)}</p><button type="button" onClick={() => setShare({ type: "portfolio" })} disabled={!summary.performance} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink disabled:opacity-35"><Share2 size={14} /> Share performance</button></div>
            </section>
            <section className="overflow-hidden rounded-md border border-edge bg-panel">
              <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Statistics</h2></header>
              <dl className="divide-y divide-edge px-5">
                <StatRow label="Total swaps" value={String((summary.executions.length || 0) + (summary.legacyTrades.length || 0))} />
                <StatRow label="Buys / sells" value={`${executionBuys} / ${executionSells}`} />
                <StatRow label="Buy / sell volume" value={`${stats.buyVolumeSol.toFixed(3)} / ${stats.sellVolumeSol.toFixed(3)} SOL`} />
                <StatRow label="Wins / losses" value={stats.wins == null ? "--" : `${stats.wins} / ${stats.losses}`} />
                <StatRow label="Gas fees" value={`${stats.networkFeesSol.toFixed(4)} SOL`} />
                <StatRow label="All fees" value={`${fees.toFixed(4)} SOL`} />
                <StatRow label="Unique tokens" value={String(uniqueTokens)} />
                <StatRow label="Win rate" value={formatPercentBps(summary.performance?.winRateBps)} />
                <StatRow label="Maximum drawdown" value={formatPercentBps(summary.performance?.maxDrawdownBps)} />
                <StatRow label="Last swap" value={formatWhen(lastExecution)} />
                <StatRow label="Risk-flagged tokens" value={stats.riskFlaggedTokens == null ? "--" : String(stats.riskFlaggedTokens)} />
              </dl>
            </section>
          </div>

          <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
            <header className="flex items-center justify-between border-b border-edge px-5 py-4"><div><h2 className="text-sm font-semibold text-ink">Wallet holdings</h2><p className="mt-1 text-[11px] text-dim">Current SPL balances priced from the most liquid available market pair.</p></div><span className="font-mono text-[9px] text-dim">{walletPortfolio?.count || 0} priced tokens</span></header>
            <WalletHoldings portfolio={walletPortfolio} />
          </section>
        </>
      )}

      {summary && view === "positions" && <PositionsTable positions={visiblePositions} onShare={(id) => setShare({ type: "position", id })} />}
      {summary && view === "trades" && <TradesTable executions={visibleExecutions} legacy={botFilter ? [] : summary.legacyTrades} />}
      {summary && view === "movements" && <MovementsTable rows={summary.cashMovements} />}

      {depositOpen && <DepositModal wallet={walletAddress || ""} onClose={() => setDepositOpen(false)} />}
      {withdrawOpen && <WithdrawModal wallet={walletAddress || ""} walletId={getSolanaWalletId(user) || ""} getAccessToken={getAccessToken} identityToken={identityToken} onClose={() => setWithdrawOpen(false)} />}
      {share && <PnlShareModal subject={share} period={period} getAccessToken={getAccessToken} onClose={() => setShare(null)} />}
    </>
  );
}

function BalanceMetric({ label, value, detail, tone = "default" }: { label: string; value: string; detail: string; tone?: "default" | "positive" | "negative" }) {
  const color = tone === "positive" ? "text-up" : tone === "negative" ? "text-down" : "text-ink";
  return <div className="bg-panel p-5"><p className="field-label">{label}</p><p className={`mt-3 font-mono text-lg font-semibold ${color}`}>{value}</p><p className="mt-1 text-[10px] text-dim">{detail}</p></div>;
}

function PortfolioPerformanceChart({ performance }: { performance: PortfolioSummary["performance"] }) {
  const rows = Array.isArray(performance?.metrics?.equitySeries) ? performance?.metrics?.equitySeries : [];
  const values = rows.map((row: any) => Number(row.equityLamports || 0) / 1e9).filter(Number.isFinite);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(max - min, 0.000001);
  const points = rows.map((row: any, index: number) => {
    const x = rows.length <= 1 ? 50 : 24 + index / (rows.length - 1) * 512;
    const value = Number(row.equityLamports || 0) / 1e9;
    const y = 150 - (value - min) / span * 112;
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="relative h-72 p-5">
      <svg viewBox="0 0 560 190" className="h-full w-full" role="img" aria-label={rows.length ? `Portfolio equity chart with ${rows.length} observations` : "Portfolio equity history unavailable"}>
        {[30, 70, 110, 150].map((y) => <line key={y} x1="20" y1={y} x2="540" y2={y} stroke="rgb(var(--edge-rgb))" />)}
        {rows.length > 1 && <><polygon points={`24,160 ${points} 536,160`} fill="rgb(var(--toxic-rgb) / .08)" /><polyline points={points} fill="none" stroke="rgb(var(--toxic-rgb))" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></>}
      </svg>
      {rows.length === 0 && <div className="absolute inset-0 grid place-items-center text-center"><div><BarChart3 className="mx-auto text-gold-400" size={22} /><p className="mt-3 text-sm font-semibold text-ink">No reconciled equity series yet</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-dim">The chart appears after performance snapshots are computed from confirmed trades and wallet movements. No synthetic curve is shown.</p></div></div>}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 py-3"><dt className="text-[11px] text-dim">{label}</dt><dd className="max-w-[58%] text-right font-mono text-[10px] leading-4 text-ink">{value}</dd></div>;
}

function WalletHoldings({ portfolio }: { portfolio: Portfolio | null }) {
  if (!portfolio) return <p className="px-5 py-10 text-center text-xs text-dim">Wallet market data is unavailable.</p>;
  if (!portfolio.positions.length) return <p className="px-5 py-10 text-center text-xs text-dim">No priced SPL holdings above the dust threshold.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead className="bg-void font-mono text-[9px] uppercase text-dim"><tr><th className="px-4 py-3">Token</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">24H</th><th className="px-4 py-3">Liquidity</th></tr></thead>
        <tbody>{portfolio.positions.map((position) => <tr key={position.mint} className="border-t border-edge text-xs"><td className="px-4 py-4"><div className="flex items-center gap-3">{position.image ? <img src={position.image} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-edge font-mono text-[9px] text-gold-400">{(position.symbol || "?").slice(0, 2)}</span>}<div><p className="font-semibold text-ink">{position.symbol || "Unknown"}</p><p className="mt-0.5 font-mono text-[9px] text-dim">{position.mint.slice(0, 6)}...{position.mint.slice(-5)}</p></div></div></td><td className="px-4 py-4 font-mono text-ink">{position.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td className="px-4 py-4 font-mono text-ink">{fmtUsd(position.priceUsd)}</td><td className="px-4 py-4 font-mono text-ink">{fmtUsd(position.valueUsd)}</td><td className={`px-4 py-4 font-mono ${(position.change24h || 0) >= 0 ? "text-up" : "text-down"}`}>{position.change24h == null ? "--" : `${position.change24h >= 0 ? "+" : ""}${position.change24h.toFixed(2)}%`}</td><td className="px-4 py-4 font-mono text-dim">{fmtUsd(position.liquidityUsd)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function PositionsTable({ positions, onShare }: { positions: any[]; onShare: (id: string) => void }) {
  return (
    <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
      <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Bot positions</h2><p className="mt-1 text-[11px] text-dim">Configuration and source attribution remain attached to the position snapshot.</p></header>
      {positions.length === 0 ? <p className="px-5 py-12 text-center text-xs text-dim">No bot positions yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left"><thead className="bg-void font-mono text-[9px] uppercase text-dim"><tr><th className="px-4 py-3">Token</th><th className="px-4 py-3">Bot</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Invested</th><th className="px-4 py-3">Realized PnL</th><th className="px-4 py-3">Fees</th><th className="px-4 py-3">Opened</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{positions.map((position) => <tr key={position.id} className="border-t border-edge text-xs"><td className="px-4 py-4"><p className="font-mono text-ink">{position.mint.slice(0, 7)}...{position.mint.slice(-5)}</p></td><td className="px-4 py-4 text-ink">{position.botName || "Unassigned bot"}</td><td className="px-4 py-4"><StatusPill status={position.status} /></td><td className="px-4 py-4 font-mono text-ink">{formatSol(position.costLamports)}</td><td className={`px-4 py-4 font-mono ${Number(position.realizedPnlLamports) >= 0 ? "text-up" : "text-down"}`}>{formatSol(position.realizedPnlLamports)}</td><td className="px-4 py-4 font-mono text-dim">{formatSol(position.feesLamports)}</td><td className="px-4 py-4 font-mono text-[9px] text-dim">{formatWhen(position.opened_at)}</td><td className="px-4 py-4"><div className="flex gap-2"><button type="button" onClick={() => onShare(position.id)} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink"><Share2 size={13} /> Share</button><Link href={`/portfolio/positions/${position.id}`} className="inline-flex min-h-9 items-center rounded-md border border-edge px-3 text-xs font-semibold text-ink">Details</Link></div></td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function TradesTable({ executions, legacy }: { executions: any[]; legacy: any[] }) {
  const rows = [...executions.map((row) => ({ ...row, source: "bot" })), ...legacy.map((row) => ({ ...row, source: "legacy", grossNotionalLamports: row.solAmount == null ? null : String(Math.round(Number(row.solAmount) * 1e9)), networkFeeLamports: row.feeSol == null ? null : String(Math.round(Number(row.feeSol) * 1e9)), status: row.reconciliationStatus || "legacy" }))].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return (
    <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
      <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Trade history</h2><p className="mt-1 text-[11px] text-dim">Confirmed, pending, failed, and legacy execution records remain visible.</p></header>
      {rows.length === 0 ? <p className="px-5 py-12 text-center text-xs text-dim">No trade records yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left"><thead className="bg-void font-mono text-[9px] uppercase text-dim"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Token</th><th className="px-4 py-3">Side / kind</th><th className="px-4 py-3">Notional</th><th className="px-4 py-3">Network fee</th><th className="px-4 py-3">Platform fee</th><th className="px-4 py-3">Creator fee</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Transaction</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.source}-${row.id}`} className="border-t border-edge text-xs"><td className="px-4 py-4 font-mono text-[9px] text-dim">{formatWhen(row.created_at)}</td><td className="px-4 py-4 font-mono text-ink">{row.mint.slice(0, 7)}...{row.mint.slice(-5)}</td><td className="px-4 py-4"><p className={`font-mono uppercase ${row.side === "buy" ? "text-up" : "text-gold-400"}`}>{row.side}</p><p className="mt-1 text-[9px] text-dim">{row.kind || "swap"}</p></td><td className="px-4 py-4 font-mono text-ink">{formatSol(row.grossNotionalLamports)}</td><td className="px-4 py-4 font-mono text-dim">{formatSol(row.networkFeeLamports)}</td><td className="px-4 py-4 font-mono text-dim">{formatSol(row.platformFeeLamports)}</td><td className="px-4 py-4 font-mono text-dim">{formatSol(row.creatorFeeLamports)}</td><td className="px-4 py-4"><StatusPill status={row.status} /></td><td className="px-4 py-4">{row.txSignature ? <a href={`https://solscan.io/tx/${row.txSignature}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gold-400">Solscan <ExternalLink size={12} /></a> : <span className="text-dim">--</span>}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function MovementsTable({ rows }: { rows: any[] }) {
  return (
    <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
      <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Deposit and withdrawal history</h2><p className="mt-1 text-[11px] text-dim">Detected wallet movements are reconciled against Solana transaction signatures.</p></header>
      {rows.length === 0 ? <p className="px-5 py-12 text-center text-xs text-dim">No reconciled wallet movements yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left"><thead className="bg-void font-mono text-[9px] uppercase text-dim"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Fee</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Signature</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-edge text-xs"><td className="px-4 py-4 font-mono text-[9px] text-dim">{formatWhen(row.observed_at)}</td><td className="px-4 py-4 capitalize text-ink">{row.type}</td><td className="px-4 py-4 font-mono text-ink">{formatSol(row.amountLamports)}</td><td className="px-4 py-4 font-mono text-dim">{formatSol(row.networkFeeLamports)}</td><td className="px-4 py-4"><StatusPill status={row.status} /></td><td className="px-4 py-4">{row.txSignature ? <a href={`https://solscan.io/tx/${row.txSignature}`} target="_blank" rel="noreferrer" className="text-gold-400">View</a> : "--"}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function DepositModal({ wallet, onClose }: { wallet: string; onClose: () => void }) {
  const toast = useToast();
  async function copy() {
    try { await navigator.clipboard.writeText(wallet); toast("Deposit address copied"); } catch { toast("Could not copy address", "err"); }
  }
  return (
    <Modal title="Deposit SOL or SPL tokens" onClose={onClose}>
      <div className="rounded-md border border-gold-400/30 bg-gold-400/5 p-4 text-xs leading-5 text-dim">Send only Solana network assets to this address. Verify the address in your wallet before confirming a transfer.</div>
      <div className="mt-4 rounded-md border border-edge bg-void p-4"><p className="field-label">Your Solana address</p><p className="mt-2 break-all font-mono text-xs text-ink">{wallet || "No wallet connected"}</p><button type="button" onClick={copy} disabled={!wallet} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink disabled:opacity-40"><Copy size={14} /> Copy address</button></div>
    </Modal>
  );
}

type WithdrawAvailability = { balanceLamports: string; lockedLamports: string; spendableLamports: string; reserveLamports: string };

/** Parse a decimal SOL string to exact lamports without floating-point arithmetic. */
function solInputToLamports(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 9) return null;
  try {
    return BigInt(whole || "0") * BigInt(1_000_000_000) + BigInt((frac + "000000000").slice(0, 9));
  } catch {
    return null;
  }
}

function lamportsToSolText(value: bigint, digits = 4) {
  const whole = value / BigInt(1_000_000_000);
  const frac = (value % BigInt(1_000_000_000)).toString().padStart(9, "0").slice(0, digits);
  return digits > 0 ? `${whole}.${frac}` : `${whole}`;
}

function WithdrawModal({ wallet, walletId, getAccessToken, identityToken, onClose }: { wallet: string; walletId: string; getAccessToken: () => Promise<string | null>; identityToken: string | null; onClose: () => void }) {
  const toast = useToast();
  const { wallets, ready: walletsReady } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const privyWallet = wallets.find((w) => w.address === wallet);

  const [availability, setAvailability] = useState<WithdrawAvailability | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");

  const load = useCallback(async () => {
    if (!wallet) { setLoading(false); setLoadError("Connect a wallet to withdraw."); return; }
    setLoading(true);
    setLoadError("");
    try {
      const data = await productFetch<WithdrawAvailability>(`/api/product/portfolio/withdraw?wallet=${wallet}`, { getAccessToken, identityToken });
      setAvailability(data);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Balance is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, identityToken, wallet]);

  useEffect(() => { load(); }, [load]);

  const spendable = availability ? BigInt(availability.spendableLamports) : BigInt(0);
  const locked = availability ? BigInt(availability.lockedLamports) : BigInt(0);
  const setPercent = (percent: number) => setAmount(lamportsToSolText((spendable * BigInt(percent)) / BigInt(100), 9).replace(/0+$/, "").replace(/\.$/, ""));

  async function submit() {
    setError("");
    const lamports = solInputToLamports(amount);
    if (lamports == null || lamports <= BigInt(0)) { setError("Enter an amount greater than zero."); return; }
    if (!walletsReady) { setError("Your wallet is still loading. Try again in a moment."); return; }
    if (!privyWallet) { setError("Sign in with the wallet that holds these funds to withdraw."); return; }

    setBusy(true);
    try {
      const built = await productFetch<{ transaction: string; amountLamports: string }>(
        "/api/product/portfolio/withdraw",
        { getAccessToken, identityToken },
        { method: "POST", body: JSON.stringify({ from: wallet, walletId, to: destination.trim(), amountLamports: lamports.toString() }) }
      );
      const raw = Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0));
      const receipt = await signAndSendTransaction({ transaction: raw, wallet: privyWallet, chain: "solana:mainnet" });
      const sig = getBase58Decoder().decode(receipt.signature);
      setSignature(sig);
      toast("Withdrawal submitted");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Withdrawal could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (signature) {
    return (
      <Modal title="Withdraw SOL" onClose={onClose}>
        <p className="text-sm font-semibold text-ink">Withdrawal submitted</p>
        <p className="mt-1 text-xs leading-5 text-dim">The network is confirming your transfer. It will appear in Deposits &amp; withdrawals once reconciled.</p>
        <a href={`https://explorer.solana.com/tx/${signature}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-xs font-semibold text-ink"><ExternalLink size={14} /> View transaction</a>
      </Modal>
    );
  }

  return (
    <Modal title="Withdraw SOL" onClose={onClose}>
      {loading && <div className="space-y-3" aria-busy="true"><div className="h-14 animate-pulse rounded-md bg-void" /><div className="h-10 animate-pulse rounded-md bg-void" /><div className="h-10 animate-pulse rounded-md bg-void" /></div>}

      {!loading && loadError && (
        <div className="rounded-md border border-edge bg-void p-4">
          <p className="text-sm font-semibold text-ink">{loadError}</p>
          <button type="button" onClick={load} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink"><RefreshCw size={14} /> Try again</button>
        </div>
      )}

      {!loading && !loadError && availability && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-edge bg-void p-3"><p className="field-label">Available</p><p className="mt-2 font-mono text-sm text-ink">{lamportsToSolText(spendable)} SOL</p></div>
            <div className="rounded-md border border-edge bg-void p-3"><p className="field-label">Committed to open trades</p><p className="mt-2 font-mono text-sm text-ink">{lamportsToSolText(locked)} SOL</p></div>
          </div>
          <p className="mt-2 text-[10px] text-dim">{lamportsToSolText(BigInt(availability.reserveLamports), 6)} SOL stays in the account for rent and network fees.</p>

          <label className="mt-4 block">
            <span className="field-label">Destination address</span>
            <input value={destination} onChange={(event) => setDestination(event.target.value)} spellCheck={false} placeholder="Solana address" className="mt-2 w-full rounded-md border border-edge bg-void px-3 py-2.5 font-mono text-xs text-ink" />
          </label>

          <label className="mt-4 block">
            <span className="field-label">Amount</span>
            <div className="mt-2 flex items-center gap-2">
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.0" className="w-full rounded-md border border-edge bg-void px-3 py-2.5 font-mono text-sm text-ink" />
              <span className="font-mono text-xs text-dim">SOL</span>
            </div>
          </label>
          <div className="mt-2 flex gap-2">
            {[25, 50, 75, 100].map((percent) => (
              <button key={percent} type="button" onClick={() => setPercent(percent)} disabled={spendable <= BigInt(0)} className="min-h-9 flex-1 rounded-md border border-edge text-xs font-semibold text-ink disabled:opacity-40">{percent === 100 ? "Max" : `${percent}%`}</button>
            ))}
          </div>

          {error && <p role="alert" className="mt-4 rounded-md border border-down/40 bg-down/5 px-3 py-2.5 text-xs text-ink">{error}</p>}

          <button type="button" onClick={submit} disabled={busy || spendable <= BigInt(0) || !destination.trim() || !amount.trim()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-gold px-4 text-sm font-semibold text-black disabled:opacity-40">
            {busy ? <><Loader2 size={15} className="animate-spin" /> Building transaction</> : "Withdraw SOL"}
          </button>
          <p className="mt-2 text-center text-[10px] text-dim">You sign this transfer with your own wallet. DegenAration never holds your keys.</p>
        </>
      )}
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4" onClick={onClose}><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-md border border-edge bg-panel" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b border-edge p-5"><h2 className="text-lg font-semibold text-ink">{title}</h2><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim" aria-label="Close"><X size={15} /></button></header><div className="p-5">{children}</div></div></div>;
}

function PnlShareModal({ subject, period, getAccessToken, onClose }: { subject: { type: "portfolio" | "position"; id?: string }; period: Period; getAccessToken: () => Promise<string | null>; onClose: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl = "";
    getAccessToken().then(async (token) => {
      const query = new URLSearchParams({ type: subject.type, period });
      if (subject.id) query.set("id", subject.id);
      const response = await fetch(`/api/product/pnl-card?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Card is not available");
      }
      objectUrl = URL.createObjectURL(await response.blob());
      setUrl(objectUrl);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Card unavailable"));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [getAccessToken, period, subject.id, subject.type]);

  async function download() {
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `degenaration-${subject.type}-pnl.png`;
    anchor.click();
  }

  async function shareNative() {
    if (!url) return;
    const blob = await fetch(url).then((response) => response.blob());
    const file = new File([blob], `degenaration-${subject.type}-pnl.png`, { type: "image/png" });
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "DegenAration PnL" });
      else {
        await navigator.clipboard.writeText("https://degenaration.vercel.app");
        toast("Share link copied");
      }
    } catch {
      toast("Could not copy the share link", "err");
    }
  }

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-md border border-edge bg-panel" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-edge p-5"><div><p className="font-mono text-[9px] uppercase text-gold-400">Authoritative PnL card</p><h2 className="mt-2 text-lg font-semibold text-ink">Share performance</h2></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim" aria-label="Close share preview"><X size={15} /></button></header>
        <div className="grid min-h-96 place-items-center bg-void p-5">{url ? <img src={url} alt="DegenAration PnL share card" className="max-h-[62vh] w-full rounded-md object-contain" /> : error ? <div className="max-w-md text-center"><ShieldAlert className="mx-auto text-gold-400" /><p className="mt-3 text-sm font-semibold text-ink">Card unavailable</p><p className="mt-2 text-xs leading-5 text-dim">{error}</p></div> : <Loader2 className="animate-spin text-gold-400" />}</div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-edge p-5"><button type="button" onClick={download} disabled={!url} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-xs font-semibold text-ink disabled:opacity-40"><Download size={14} /> Download PNG</button><button type="button" onClick={shareNative} disabled={!url} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-gold-400 px-4 text-xs font-semibold text-[#17110c] disabled:opacity-40"><Share2 size={14} /> Share</button></footer>
      </div>
    </div>
  );
}
