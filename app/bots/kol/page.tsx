"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users
} from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  EmptyState,
  LoadingRows,
  Metric,
  PageHeader,
  ProductTabs,
  Segmented,
  StatusPill
} from "@/components/product/Primitives";
import { formatPercentBps, formatSol, formatWhen, productFetch, type KolStrategy } from "@/lib/product-api";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

type Period = "1d" | "7d" | "30d" | "3m";
type Sort = "performance" | "drawdown" | "followers" | "newest" | "fee";

export default function KolMarketplacePage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [sort, setSort] = useState<Sort>("performance");
  const [query, setQuery] = useState("");
  const [strategies, setStrategies] = useState<KolStrategy[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setStrategies(null);
    setError("");
    // Bounded so a hung provider cannot leave the list loading forever (§16).
    productFetch<{ strategies: KolStrategy[] }>(
      `/api/product/marketplace/kol?period=${period}&sort=${sort}`,
      undefined,
      { signal: AbortSignal.timeout(15000) }
    )
      .then((data) => setStrategies(data.strategies || []))
      .catch((reason) => {
        setStrategies([]);
        setError(reason instanceof Error ? reason.message : "Strategy marketplace unavailable");
      });
  }, [period, sort]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (strategies || []).filter((strategy) => !needle || `${strategy.name} ${strategy.description}`.toLowerCase().includes(needle));
  }, [query, strategies]);

  return (
    <AppShell>
      <PageHeader
        title="KOL Strategies"
        description="Copy public strategies built and tracked on DegenAration."
        actions={
          <Link href="/bots/kol/new" className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c]">
            <Bot aria-hidden="true" size={16} />
            Create KOL bot
          </Link>
        }
      />
      <ProductTabs items={TABS} active="/bots/kol" />

      <section className="mt-5 flex flex-col gap-3 border-y border-edge bg-panel/45 px-4 py-3 xl:flex-row xl:items-center">
        <Segmented
          label="Performance period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "1d", label: "1D" },
            { value: "7d", label: "7D" },
            { value: "30d", label: "30D" },
            { value: "3m", label: "3M" }
          ]}
        />
        <label className="flex min-h-11 sm:min-h-10 flex-1 items-center gap-2 rounded-md border border-edge bg-void px-3 focus-within:border-gold-400">
          <Search aria-hidden="true" size={15} className="text-dim" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search strategies" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-dim/70" />
        </label>
        <label className="flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge bg-void px-3 text-xs text-dim">
          <SlidersHorizontal aria-hidden="true" size={14} />
          <span className="sr-only">Sort strategies</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="h-11 sm:h-auto bg-transparent text-xs text-ink outline-none">
            <option value="performance">Best net performance</option>
            <option value="drawdown">Lowest drawdown</option>
            <option value="followers">Most followers</option>
            <option value="newest">Newest</option>
            <option value="fee">Lowest fee</option>
          </select>
        </label>
        <button type="button" onClick={load} className="grid h-11 w-11 place-items-center sm:h-10 sm:w-10 rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh strategies">
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </section>

      <div className="mt-5">
        {strategies == null && <LoadingRows count={4} />}
        {/* A failure and an empty result are different states and get different actions:
            offering "create the first strategy" when the request actually failed is
            misleading, and a retry is what the user needs (§16). */}
        {strategies != null && visible.length === 0 && error && (
          <EmptyState
            icon={Sparkles}
            title="Strategy data could not be loaded"
            description={error}
            action={<button type="button" onClick={load} className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink"><RefreshCw size={15} /> Try again</button>}
          />
        )}
        {strategies != null && visible.length === 0 && !error && (
          <EmptyState
            icon={Sparkles}
            title={query.trim() ? "No strategies match these filters" : "No public KOL strategies yet"}
            description={query.trim() ? "Clear filters or create the first strategy in this view." : "Create a strategy, submit it for review, and it will appear here after approval with measured performance history."}
            action={
              query.trim()
                ? <button type="button" onClick={() => setQuery("")} className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md border border-edge px-4 text-sm font-semibold text-ink">Clear filters</button>
                : <Link href="/bots/kol/new" className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c]">Create KOL bot</Link>
            }
          />
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} />)}
        </div>
      </div>
    </AppShell>
  );
}

function StrategyCard({ strategy }: { strategy: KolStrategy }) {
  const net = Number(strategy.netPnlLamports || 0);
  return (
    <article className="overflow-hidden rounded-md border border-edge bg-panel">
      <header className="flex items-start gap-4 border-b border-edge p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-gold-400/30 bg-gold-400/10 font-mono text-sm font-semibold text-gold-400">
          {strategy.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-ink">{strategy.name}</h2>
            <StatusPill status={strategy.insufficientHistory ? "tracking" : "reviewed"} />
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-dim">{strategy.description || "No public description provided."}</p>
        </div>
        <span className="rounded-sm border border-edge bg-void px-2 py-1 font-mono text-[9px] uppercase text-dim">{strategy.riskTier} risk</span>
      </header>
      <div className="grid grid-cols-4 divide-x divide-edge border-b border-edge py-4">
        <Metric label="Net PnL" value={strategy.insufficientHistory ? "--" : formatSol(strategy.netPnlLamports)} tone={net > 0 ? "positive" : net < 0 ? "negative" : "default"} />
        <Metric label="Win rate" value={strategy.insufficientHistory ? "--" : formatPercentBps(strategy.winRateBps)} />
        <Metric label="Drawdown" value={strategy.insufficientHistory ? "--" : formatPercentBps(strategy.maxDrawdownBps)} />
        <Metric label="Followers" value={strategy.followers} detail={`${strategy.openTrades} open trades`} />
      </div>
      <div className="grid grid-cols-3 divide-x divide-edge border-b border-edge py-3">
        <Metric label="Volume" value={formatSol(strategy.volumeLamports)} />
        <Metric label="Creator fee" value={formatPercentBps(strategy.creatorFeeBps)} />
        <Metric label="Sample" value={strategy.sampleSize} detail={strategy.insufficientHistory ? "Minimum 5" : "Completed trades"} />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-4 text-xs text-dim">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-up" /> Reviewed</span>
          <span className="inline-flex items-center gap-1.5"><Users size={14} /> {strategy.followers}</span>
          <span className="font-mono text-[9px]">Updated {formatWhen(strategy.updatedAt)}</span>
        </div>
        <Link href={`/bots/kol/${strategy.id}`} className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md bg-gold-400 px-4 text-xs font-semibold text-[#17110c]">View and copy</Link>
      </footer>
    </article>
  );
}
