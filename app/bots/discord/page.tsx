"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  RefreshCw,
  Search,
  SlidersHorizontal,
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
import { formatPercentBps, formatWhen, productFetch, type DiscordSource } from "@/lib/product-api";
import { safeDiscordImage, safeDiscordInvite } from "@/lib/external-url";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

type Period = "1d" | "7d" | "30d";
type Sort = "performance" | "drawdown" | "followers" | "calls" | "newest" | "fee";

export default function DiscordMarketplacePage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [sort, setSort] = useState<Sort>("performance");
  const [query, setQuery] = useState("");
  const [minimumHistory, setMinimumHistory] = useState(true);
  const [sources, setSources] = useState<DiscordSource[] | null>(null);
  const [minimumSampleSize, setMinimumSampleSize] = useState(5);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    setSources(null);
    productFetch<{ sources: DiscordSource[]; minimumSampleSize: number }>(
      `/api/product/marketplace/discord?period=${period}&sort=${sort}`
    )
      .then((data) => {
        setSources(data.sources || []);
        setMinimumSampleSize(data.minimumSampleSize || 5);
      })
      .catch((reason) => {
        setSources([]);
        setError(reason instanceof Error ? reason.message : "Marketplace unavailable");
      });
  }, [period, sort]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (sources || []).filter((source) => {
      if (minimumHistory && source.measuredCalls < minimumSampleSize) return false;
      return !needle || source.name.toLowerCase().includes(needle);
    });
  }, [minimumHistory, minimumSampleSize, query, sources]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Bots / Discord"
        title="Approved Discord sources"
        description="Measured community calls, transparent sample sizes, and configurable execution controls. Only approved channels can produce eligible signals."
        actions={
          <>
            <Link href="/affiliate?tab=discord" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink transition hover:border-toxic/60">
              <Users aria-hidden="true" size={16} />
              List a server
            </Link>
            <Link href="/bots/discord/new" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c]">
              <Bot aria-hidden="true" size={16} />
              New Discord bot
            </Link>
          </>
        }
      />
      <ProductTabs items={TABS} active="/bots/discord" />

      <section className="mt-5 flex flex-col gap-3 border-y border-edge bg-panel/45 px-4 py-3 xl:flex-row xl:items-center">
        <Segmented
          label="Performance period"
          value={period}
          onChange={setPeriod}
          options={[{ value: "1d", label: "1D" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }]}
        />
        <label className="flex min-h-10 flex-1 items-center gap-2 rounded-md border border-edge bg-void px-3 focus-within:border-toxic">
          <Search aria-hidden="true" size={15} className="text-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search approved sources"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-dim/70"
          />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-xs text-dim">
          <input type="checkbox" checked={minimumHistory} onChange={(event) => setMinimumHistory(event.target.checked)} className="h-4 w-4 accent-[#b98b5d]" />
          Minimum {minimumSampleSize} measured calls
        </label>
        <label className="flex min-h-10 items-center gap-2 rounded-md border border-edge bg-void px-3 text-xs text-dim">
          <SlidersHorizontal aria-hidden="true" size={14} />
          <span className="sr-only">Sort sources</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="bg-transparent text-xs text-ink outline-none">
            <option value="performance">Best performance</option>
            <option value="drawdown">Lowest drawdown</option>
            <option value="followers">Most followers</option>
            <option value="calls">Most calls</option>
            <option value="newest">Newest</option>
            <option value="fee">Lowest fee</option>
          </select>
        </label>
        <button type="button" onClick={load} className="grid h-10 w-10 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh marketplace" title="Refresh marketplace">
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </section>

      <div className="mt-5">
        {sources == null && <LoadingRows count={4} />}
        {sources != null && visible.length === 0 && (
          <EmptyState
            icon={BadgeCheck}
            title={error ? "Source data is temporarily unavailable" : "No source matches these filters"}
            description={error || "Turn off minimum history to inspect newly approved communities while their performance sample develops."}
          />
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((source) => <SourceCard key={source.id} source={source} minimumSampleSize={minimumSampleSize} />)}
        </div>
      </div>
    </AppShell>
  );
}

function SourceCard({ source, minimumSampleSize }: { source: DiscordSource; minimumSampleSize: number }) {
  const measured = source.measuredCalls >= minimumSampleSize;
  const initials = source.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const avatarUrl = safeDiscordImage(source.avatarUrl);
  const joinUrl = safeDiscordInvite(source.joinUrl);
  return (
    <article className="overflow-hidden rounded-md border border-edge bg-panel">
      <header className="flex items-start gap-4 border-b border-edge p-5">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-toxic/30 bg-toxic/10 font-mono text-sm font-semibold text-toxic">{initials}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-ink">{source.name}</h2>
            <StatusPill status={source.verificationStatus || "approved"} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-dim">
            <span>{source.members || "Member count unavailable"}</span>
            <span>{source.activeFollowers} active followers</span>
            <span>{formatPercentBps(source.creatorFeeBps)} creator fee</span>
          </p>
        </div>
        {joinUrl && (
          <a href={joinUrl} target="_blank" rel="noreferrer" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label={`Join ${source.name}`} title="Join server">
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        )}
      </header>

      <div className="grid grid-cols-4 divide-x divide-edge border-b border-edge py-4">
        <Metric label="Win rate" value={measured && source.winRate != null ? `${source.winRate.toFixed(1)}%` : "--"} tone={measured ? "positive" : "default"} />
        <Metric label="Median return" value={measured && source.medianReturnX != null ? `${source.medianReturnX.toFixed(2)}x` : "--"} />
        <Metric label="Average return" value={measured && source.averageReturnX != null ? `${source.averageReturnX.toFixed(2)}x` : "--"} />
        <Metric label="Eligible calls" value={source.eligibleCalls} detail={`${source.measuredCalls} measured`} />
      </div>

      <div className="p-5">
        <div className="grid grid-cols-4 gap-2">
          {[
            ["<50%", source.under50, "text-down"],
            ["+50%", source.plus50, "text-toxic"],
            ["2x", source.twoX, "text-up"],
            ["5x+", source.fiveX, "text-up"]
          ].map(([label, value, tone]) => (
            <div key={label as string} className="rounded-sm border border-edge bg-void px-3 py-2 text-center">
              <p className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
              <p className="mt-1 font-mono text-[8px] uppercase text-dim">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-xs font-medium ${measured ? "text-ink" : "text-toxic"}`}>{measured ? "Measured history available" : "Insufficient measured history"}</p>
            <p className="mt-1 font-mono text-[9px] text-dim">Freshness: {formatWhen(source.dataFreshnessAt)}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/bots/discord/${source.id}`} className="inline-flex min-h-10 items-center rounded-md border border-edge px-4 text-xs font-semibold text-ink hover:border-toxic/60">Details</Link>
            <Link href={`/bots/discord/new?source=${source.id}`} className="inline-flex min-h-10 items-center rounded-md bg-toxic px-4 text-xs font-semibold text-[#17110c]">Configure bot</Link>
          </div>
        </div>
      </div>
    </article>
  );
}
