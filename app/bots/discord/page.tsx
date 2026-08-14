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
import { DiscordActivityGrid, DiscordCallCounts } from "@/components/product/DiscordMarketplaceMetrics";
import { formatPercentBps, formatWhen, productFetch, type DiscordSource } from "@/lib/product-api";
import { safeDiscordBotInstall, safeDiscordInvite } from "@/lib/external-url";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

type Period = "1d" | "7d" | "30d";

/** Written out, because "1d" above a column of counts reads as a unit rather than a window. */
const PERIOD_LABEL: Record<Period, string> = { "1d": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };
const periodLabel = (period: Period) => PERIOD_LABEL[period];
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
            <a href={installUrl} target={installUrl.startsWith("https://") ? "_blank" : undefined} rel={installUrl.startsWith("https://") ? "noreferrer" : undefined} className="inline-flex min-h-11 items-center gap-2 px-1 t-meta text-dim transition hover:text-ink sm:min-h-10">
              <Bot aria-hidden="true" size={15} />
              Add our bot to a server
            </a>
            <Link href="/affiliate?tab=discord" className="inline-flex min-h-11 items-center gap-2 px-1 t-meta text-dim transition hover:text-ink sm:min-h-10">
              <Users aria-hidden="true" size={15} />
              List your server
            </Link>
            <Link href="/bots/discord/new" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gold-400 px-4 t-body font-medium text-[#17110c] transition hover:bg-gold-300 sm:min-h-10">
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
            aria-label="Search approved Discord sources"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search approved sources"
            className="min-w-0 flex-1 bg-transparent t-body text-ink outline-none placeholder:text-dim/70"
          />
        </label>
        <label className="flex min-h-11 sm:min-h-10 items-center gap-2 t-label text-dim">
          <input type="checkbox" checked={minimumHistory} onChange={(event) => setMinimumHistory(event.target.checked)} className="h-4 w-4 accent-[#b98b5d]" />
          Minimum {minimumSampleSize} measured calls
        </label>
        <label className="flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge bg-void px-3 t-label text-dim">
          <SlidersHorizontal aria-hidden="true" size={14} />
          <span className="sr-only">Sort sources</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="h-11 sm:h-auto bg-transparent t-label text-ink outline-none">
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
          {visible.map((source) => <SourceCard key={source.id} source={source} minimumSampleSize={minimumSampleSize} period={period} />)}
        </div>
      </div>
    </AppShell>
  );
}

function SourceCard({ source, minimumSampleSize, period }: { source: DiscordSource; minimumSampleSize: number; period: Period }) {
  const measured = source.measuredCalls >= minimumSampleSize;
  const joinUrl = safeDiscordInvite(source.joinUrl);
  return (
    <article className="overflow-hidden rounded-lg border border-[color:var(--rule)] bg-panel">
      <header className="flex items-start gap-4 border-b border-[color:var(--rule)] p-5">
        <DiscordSourceAvatar source={source} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate t-section font-semibold text-ink">{source.name}</h2>
            <StatusPill status={source.verificationStatus || "approved"} />
            <IntegrationHealthDot status={source.integrationHealth} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 t-label text-dim">
            {source.members && <span>{source.members}</span>}
            <span>{source.activeFollowers} active followers</span>
          </p>
          <p className="mt-2 line-clamp-2 t-label leading-5 text-dim">{source.description}</p>
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
      {/*
        The call record, as a distribution — how many went which way — instead of four
        statistics about the same calls.

        Replaces two rows. The first was net PnL at 1 day / 7 days / 30 days, which is money
        from COPIED TRADES and reads "Collecting data" until someone has actually copied this
        source; three permanently empty cards above a period selector that already exists is
        what made the periods look broken. The second was Hit rate / Up now / Median peak /
        Median now — four ways of saying the same thing to someone who wants to know whether
        the calls landed.

        Every bucket here is period-scoped already: `period_calls` in
        degenaration-discord-current-return.sql filters `called_at >= v_since`, so changing
        1D/7D/30D above changes all of these.

        All five figures come from the PEAK family, on one basis. Mixing peak and current is
        the defect this codebase shipped once — "win rate 100%, average return 2.00x" for a
        source whose every call touched 2x and went to zero — so the heading says which basis
        it is rather than leaving the reader to assume.
      */}
      <div className="border-b border-[color:var(--rule)] px-5 py-5">
        <p className="ui-label">Best each call reached · {periodLabel(period)}</p>
        <div className="mt-3 grid grid-cols-3 gap-y-4 sm:grid-cols-5">
          <Metric
            label="Hit rate"
            value={measured && source.winRate != null ? `${source.winRate.toFixed(1)}%` : "—"}
            tone={measured ? "positive" : "default"}
            hint="Share of measured calls that traded above entry at any point in this period."
          />
          <Metric
            label="−50%"
            value={measured ? String(source.down50 ?? 0) : "—"}
            tone={measured && (source.down50 ?? 0) > 0 ? "negative" : "default"}
            hint="Calls that never recovered half their entry price."
          />
          <Metric
            label="+50%"
            value={measured ? String(source.plus50 ?? 0) : "—"}
            hint="Calls that reached at least +50% but not 2x."
          />
          <Metric
            label="2x"
            value={measured ? String(source.twoX ?? 0) : "—"}
            tone={measured && (source.twoX ?? 0) > 0 ? "positive" : "default"}
            hint="Calls that reached at least 2x but not 5x."
          />
          <Metric
            label="5x+"
            value={measured ? String(source.fiveX ?? 0) : "—"}
            tone={measured && (source.fiveX ?? 0) > 0 ? "positive" : "default"}
            hint="Calls that reached 5x or better."
          />
        </div>

        {/*
          Where those same calls are NOW, on its own line and labelled as such.

          The five figures above are all peak — the best each call ever reached — and peak
          alone is the exact defect this product shipped once: a source whose every call
          touched 2x and then went to zero read "win rate 100%, average return 2.00x". Five
          flattering counts with nothing saying where the calls ended would restore it in a
          new shape. The heading names the basis; this line supplies the other half.
        */}
        {measured && (
          <p className="mt-4 border-t border-[color:var(--rule)] pt-3 t-label text-dim">
            Where they are now:{" "}
            <span className={source.currentWinRate != null && source.currentWinRate >= 50 ? "text-up" : "text-ink"}>
              {source.currentWinRate == null ? "—" : `${source.currentWinRate.toFixed(1)}% still above entry`}
            </span>
            {source.currentlyDown50 != null && (
              <>
                {" · "}
                <span className={source.currentlyDown50 > 0 ? "text-down" : "text-ink"}>
                  {source.currentlyDown50} down 50%+
                </span>
              </>
            )}
            {source.medianCurrentX != null && <> · median {Number(source.medianCurrentX).toFixed(2)}x</>}
          </p>
        )}
      </div>

      <div className="p-5">
        <DiscordCallCounts source={source} />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-edge pt-4">
          <div className="min-w-0">
            {measured ? (
              <p className="t-label text-dim">{source.measuredCalls} measured calls in this period</p>
            ) : (
              <p
                className="t-label text-dim"
                title="Performance appears after eligible calls receive enough market data."
              >
                {source.approvedAt ? `Tracking started ${formatWhen(source.approvedAt)}` : "No eligible calls yet"}
              </p>
            )}
            {/* The commission is stated only when there is somebody who can receive it.
                Both approved sources carry creator_fee_bps 70 and owner_privy_user_id NULL,
                and settle_execution_into_ledger reads that null and sets the creator share to
                ZERO — silently, with the whole platform fee retained. So the card was
                advertising a payment to a server owner that the settlement path would never
                make, which is the same defect as quoting a platform fee nobody is charged.
                `creatorPayable` is the owner link resolving, not a display name: the name is
                synced from Discord and is present whether or not anyone has claimed the
                server. */}
            {source.creatorPayable ? (
              <p
                className="mt-1 t-label text-dim"
                title={`The server owner receives ${formatPercentBps(source.creatorFeeBps)} of executed notional, paid out of the 2.00% platform fee. You are not charged extra.`}
              >
                {formatPercentBps(source.creatorFeeBps)} goes to the server owner, out of the platform fee
              </p>
            ) : (
              <p
                className="mt-1 t-label text-[color:var(--text-muted)]"
                title="Nobody has claimed this server yet, so no creator share is paid on its calls. It does not cost you more either way — the platform fee is the same."
              >
                No server owner claimed yet
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href={`/bots/discord/${source.id}`} className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md border border-edge px-4 t-label font-semibold text-ink hover:border-gold-400/60">Details</Link>
            <Link href={`/bots/discord/new?source=${source.id}`} className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md bg-gold-400 px-4 t-label font-semibold text-[#17110c]">Configure bot</Link>
          </div>
        </div>
      </div>
    </article>
  );
}
