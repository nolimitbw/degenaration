"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Plus,
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
import { DiscordSourceAvatar, IntegrationHealthDot } from "@/components/product/DiscordSourceVisual";
import { DiscordActivityGrid, DiscordCallCounts, DiscordPerformanceGrid } from "@/components/product/DiscordMarketplaceMetrics";
import { formatPercentBps, formatWhen, productFetch, type DiscordSource } from "@/lib/product-api";
import { safeDiscordBotInstall, safeDiscordInvite } from "@/lib/external-url";

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
  const [minimumHistory, setMinimumHistory] = useState(false);
  const [sources, setSources] = useState<DiscordSource[] | null>(null);
  const [minimumSampleSize, setMinimumSampleSize] = useState(5);
  const [error, setError] = useState("");
  const [installUrl, setInstallUrl] = useState("/apply");

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
  useEffect(() => {
    productFetch<{ invite?: string }>("/api/bot/config")
      .then((config) => setInstallUrl(safeDiscordBotInstall(config.invite) || "/apply"))
      .catch(() => setInstallUrl("/apply"));
  }, []);

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
        title="Discord sources"
        description="Communities whose calls we track on chain. Copy any of them."
        /* Three buttons, two of them gold-weighted, and the reader had to choose between
           them before reading the page. Only one is what most people came to do; the other
           two are for server owners and now read as links. */
        actions={
          <>
            <a href={installUrl} target={installUrl.startsWith("https://") ? "_blank" : undefined} rel={installUrl.startsWith("https://") ? "noreferrer" : undefined} className="inline-flex min-h-11 items-center gap-2 px-1 text-[13px] text-dim transition hover:text-ink sm:min-h-10">
              <Bot aria-hidden="true" size={15} />
              Add our bot to a server
            </a>
            <Link href="/affiliate?tab=discord" className="inline-flex min-h-11 items-center gap-2 px-1 text-[13px] text-dim transition hover:text-ink sm:min-h-10">
              <Users aria-hidden="true" size={15} />
              List your server
            </Link>
            <Link href="/bots/discord/new" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gold-400 px-4 text-[14px] font-medium text-[#17110c] transition hover:bg-gold-300 sm:min-h-10">
              <Plus aria-hidden="true" size={16} />
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
        <label className="flex min-h-11 sm:min-h-10 flex-1 items-center gap-2 rounded-md border border-edge bg-void px-3 focus-within:border-gold-400">
          <Search aria-hidden="true" size={15} className="text-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search approved sources"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-dim/70"
          />
        </label>
        <label className="flex min-h-11 sm:min-h-10 items-center gap-2 text-xs text-dim">
          <input type="checkbox" checked={minimumHistory} onChange={(event) => setMinimumHistory(event.target.checked)} className="h-4 w-4 accent-[#b98b5d]" />
          Minimum {minimumSampleSize} measured calls
        </label>
        <label className="flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge bg-void px-3 text-xs text-dim">
          <SlidersHorizontal aria-hidden="true" size={14} />
          <span className="sr-only">Sort sources</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="h-11 sm:h-auto bg-transparent text-xs text-ink outline-none">
            <option value="performance">Best performance</option>
            <option value="drawdown">Lowest drawdown</option>
            <option value="followers">Most followers</option>
            <option value="calls">Most calls</option>
            <option value="newest">Newest</option>
            <option value="fee">Lowest fee</option>
          </select>
        </label>
        <button type="button" onClick={load} className="grid h-11 w-11 place-items-center sm:h-10 sm:w-10 rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh marketplace" title="Refresh marketplace">
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
  const joinUrl = safeDiscordInvite(source.joinUrl);
  return (
    <article className="overflow-hidden rounded-lg border border-[color:var(--rule)] bg-panel">
      <header className="flex items-start gap-4 border-b border-[color:var(--rule)] p-5">
        <DiscordSourceAvatar source={source} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-ink">{source.name}</h2>
            <StatusPill status={source.verificationStatus || "approved"} />
            <IntegrationHealthDot status={source.integrationHealth} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
            {source.members && <span>{source.members}</span>}
            <span>{source.activeFollowers} active followers</span>
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-dim">{source.description}</p>
        </div>
        {joinUrl && (
          <a href={joinUrl} target="_blank" rel="noreferrer" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label={`Join ${source.name}`} title="Join server">
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        )}
      </header>

      {/* Bands separated by rules and spacing rather than by filled boxes on a 1px grid.
          The card held eighteen bordered cells inside a bordered card inside a page. */}
      <div className="border-b border-[color:var(--rule)] px-5 py-4"><DiscordActivityGrid source={source} /></div>
      <div className="border-b border-[color:var(--rule)] px-5 py-4"><DiscordPerformanceGrid source={source} /></div>

      {/* Peak and current are shown side by side, always. Every return figure this card used
          to show was a peak multiple with nothing saying so, so a source whose calls had all
          round-tripped to zero read "Win rate 100% · Average return 2.00x". The pairing is
          the point: one number alone cannot be read honestly. */}
      <div className="grid grid-cols-2 gap-y-4 border-b border-[color:var(--rule)] px-5 py-5 sm:grid-cols-4">
        <Metric
          label="Hit rate (peak)"
          value={measured && source.winRate != null ? `${source.winRate.toFixed(1)}%` : "—"}
          tone={measured ? "positive" : "default"}
          hint="Share of measured calls that traded above entry at any point."
        />
        <Metric
          label="Up now"
          value={measured && source.currentWinRate != null ? `${source.currentWinRate.toFixed(1)}%` : "—"}
          tone={measured && source.currentWinRate != null && source.currentWinRate >= 50 ? "positive" : "default"}
          hint="Share of those same calls trading above entry right now."
        />
        <Metric
          label="Median peak"
          value={measured && source.medianReturnX != null ? `${source.medianReturnX.toFixed(2)}x` : "—"}
          hint="Best multiple the middle call reached. Not where it is now."
        />
        <Metric
          label="Median now"
          value={measured && source.medianCurrentX != null ? `${source.medianCurrentX.toFixed(2)}x` : "—"}
          tone={measured && source.medianCurrentX != null && source.medianCurrentX < 1 ? "negative" : "default"}
          hint="Where the middle call is trading today, on the same set of calls."
        />
      </div>

      <div className="p-5">
        <DiscordCallCounts source={source} />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-edge pt-4">
          <div className="min-w-0">
            {measured ? (
              <p className="text-[12px] text-dim">{source.measuredCalls} measured calls in this period</p>
            ) : (
              <p
                className="text-[12px] text-dim"
                title="Performance appears after eligible calls receive enough market data."
              >
                {source.approvedAt ? `Tracking started ${formatWhen(source.approvedAt)}` : "No eligible calls yet"}
              </p>
            )}
            <p
              className="mt-1 text-[12px] text-dim"
              title={`The creator receives ${formatPercentBps(source.creatorFeeBps)} of executed notional, paid out of the 2.00% platform fee. You are not charged extra.`}
            >
              {formatPercentBps(source.creatorFeeBps)} creator commission included in 2% fee
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href={`/bots/discord/${source.id}`} className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md border border-edge px-4 text-xs font-semibold text-ink hover:border-gold-400/60">Details</Link>
            <Link href={`/bots/discord/new?source=${source.id}`} className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md bg-gold-400 px-4 text-xs font-semibold text-[#17110c]">Configure bot</Link>
          </div>
        </div>
      </div>
    </article>
  );
}
