"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import AppShell from "@/components/AppShell";
import { EmptyState, LoadingRows, PageHeader, ProductTabs, StatusPill } from "@/components/product/Primitives";
import { DiscordSourceAvatar, IntegrationHealthDot } from "@/components/product/DiscordSourceVisual";
import DiscordSignalIcon from "@/components/icons/DiscordSignalIcon";
import KolStrategyIcon from "@/components/icons/KolStrategyIcon";
import DegenBotIcon from "@/components/icons/DegenBotIcon";
import {
  formatSol,
  formatWhen,
  productFetch,
  type DiscordSource,
  type KolStrategy,
  type ProductBot
} from "@/lib/product-api";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

/**
 * Overview was two marketing panels: a 208px-tall card per product, each with a headline, a
 * paragraph and three metrics, and a strip underneath. It described the products instead of
 * showing them, so the first screen of the app carried almost no information — every real
 * number lived a click away on /bots/discord.
 *
 * This is the same screen as a desk: one compact metric row, then the actual sources and the
 * user's actual bots, in dense rows, with the operational state on each. Nothing here is
 * decorative and nothing is fetched that is not shown.
 *
 * `null` is used throughout for "not known yet" and is rendered as a dash. It is never
 * collapsed to 0 — reporting zero approved sources because a request failed states the
 * opposite of the truth, and there are two.
 */
export default function BotsPage() {
  const { authenticated, getAccessToken } = usePrivy();
  const [sources, setSources] = useState<DiscordSource[] | null>(null);
  const [strategies, setStrategies] = useState<KolStrategy[] | null>(null);
  const [bots, setBots] = useState<ProductBot[] | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPublic = useCallback(() => {
    setLoading(true);
    // allSettled, not all: a failing KOL request must not blank the Discord table.
    Promise.allSettled([
      productFetch<{ sources: DiscordSource[] }>("/api/product/marketplace/discord?period=7d&sort=performance"),
      productFetch<{ strategies: KolStrategy[] }>("/api/product/marketplace/kol")
    ])
      .then(([discord, kol]) => {
        setSources(discord.status === "fulfilled" ? discord.value.sources || [] : null);
        setStrategies(kol.status === "fulfilled" ? kol.value.strategies || [] : null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadPublic(); }, [loadPublic]);

  useEffect(() => {
    if (!authenticated) { setBots(null); return; }
    productFetch<{ bots: ProductBot[] }>("/api/product/bots", { getAccessToken })
      .then((data) => setBots(data.bots || []))
      .catch(() => setBots(null));
  }, [authenticated, getAccessToken]);

  const totals = useMemo(() => {
    const copied = (sources || []).reduce((sum, source) => sum + Number(source.copiedVolumeLamports ?? 0), 0);
    const measured = (sources || []).reduce((sum, source) => sum + (source.measuredCalls || 0), 0);
    return {
      sources: sources?.length ?? null,
      strategies: strategies?.length ?? null,
      measured: sources ? measured : null,
      copied: sources ? String(copied) : null,
      bots: authenticated ? bots?.length ?? null : null,
      active: authenticated && bots ? bots.filter((bot) => bot.status === "active").length : null
    };
  }, [authenticated, bots, sources, strategies]);

  return (
    <AppShell>
      <PageHeader
        title="Bots"
        description="Automate approved Discord calls or run a community strategy."
        actions={
          <>
            <button type="button" onClick={loadPublic} className="grid h-11 w-11 place-items-center rounded-md border border-edge text-dim hover:text-ink sm:h-10 sm:w-10" aria-label="Refresh" title="Refresh">
              <RefreshCw aria-hidden="true" size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <Link href="/bots/manage" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink transition hover:border-gold-400/60 sm:min-h-10">
              <DegenBotIcon size={16} /> My Bots
            </Link>
            <Link href="/bots/discord/new" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c] sm:min-h-10">
              <Plus aria-hidden="true" size={16} /> New bot
            </Link>
          </>
        }
      />
      <ProductTabs items={TABS} active="/bots" />

      {/* One compact row, tabular numerals, no card chrome. */}
      <section className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-3 xl:grid-cols-6" aria-label="Workspace totals">
        <Tile label="Approved sources" value={totals.sources} />
        <Tile label="KOL strategies" value={totals.strategies} />
        <Tile label="Measured calls 7D" value={totals.measured} />
        <Tile label="Copied volume 7D" value={totals.copied == null ? null : formatSol(totals.copied)} />
        <Tile label="Your bots" value={totals.bots} detail={authenticated ? undefined : "Connect to view"} />
        <Tile label="Active" value={totals.active} tone={totals.active ? "positive" : "default"} />
      </section>

      <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
          <div className="flex items-center gap-2">
            <DiscordSignalIcon size={16} className="text-gold-400" />
            <h2 className="text-sm font-semibold text-ink">Discord sources</h2>
            <span className="font-mono text-[10px] text-dim">7D</span>
          </div>
          <Link href="/bots/discord" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-gold-400 sm:min-h-0">
            All sources <ArrowRight aria-hidden="true" size={13} />
          </Link>
        </header>
        {loading && sources == null ? <LoadingRows count={2} /> : null}
        {sources != null && sources.length === 0 && (
          <EmptyState icon={DiscordSignalIcon} title="No approved sources yet" description="Approved call communities appear here once a server is reviewed." />
        )}
        {sources == null && !loading && (
          <EmptyState icon={DiscordSignalIcon} title="Source data is unavailable" description="The marketplace did not respond. Refresh to try again." />
        )}
        {sources != null && sources.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="bg-void font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
                <tr>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Last call</th>
                  <th className="px-4 py-2.5 text-right">Measured</th>
                  <th className="px-4 py-2.5 text-right">Hit rate</th>
                  <th className="px-4 py-2.5 text-right">Up now</th>
                  <th className="px-4 py-2.5 text-right">Median peak</th>
                  <th className="px-4 py-2.5 text-right">Median now</th>
                  <th className="px-4 py-2.5 text-right">Followers</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id} className="border-t border-edge text-xs">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <DiscordSourceAvatar source={source} />
                        <span className="truncate font-semibold text-ink">{source.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><IntegrationHealthDot status={source.integrationHealth} /></td>
                    <td className="px-4 py-3 font-mono text-[10px] text-dim">
                      {source.lastSignalAt ? formatWhen(source.lastSignalAt) : "Monitoring"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{source.measuredCalls}</td>
                    <Cell value={source.winRate} suffix="%" positive />
                    <Cell value={source.currentWinRate ?? null} suffix="%" />
                    <Cell value={source.medianReturnX} suffix="x" digits={2} />
                    <Cell value={source.medianCurrentX ?? null} suffix="x" digits={2} lowIsBad />
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-dim">{source.activeFollowers}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/bots/discord/new?source=${source.id}`} className="inline-flex min-h-11 items-center rounded-md border border-edge px-3 text-[11px] font-semibold text-ink hover:border-gold-400/60 sm:min-h-8">
                        Configure
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="overflow-hidden rounded-md border border-edge bg-panel">
          <header className="flex items-center justify-between border-b border-edge px-4 py-3">
            <div className="flex items-center gap-2">
              <DegenBotIcon size={16} className="text-gold-400" />
              <h2 className="text-sm font-semibold text-ink">Your bots</h2>
            </div>
            <Link href="/bots/manage" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-gold-400 sm:min-h-0">
              Manage <ArrowRight aria-hidden="true" size={13} />
            </Link>
          </header>
          {!authenticated && (
            <EmptyState compact icon={DegenBotIcon} title="Connect to see your bots" description="Bot configuration and performance are private account data." />
          )}
          {authenticated && bots != null && bots.length === 0 && (
            <EmptyState compact icon={DegenBotIcon} title="No bots yet" description="Pick an approved source above, or build a KOL strategy." />
          )}
          {authenticated && bots != null && bots.length > 0 && (
            <ul className="divide-y divide-edge">
              {bots.slice(0, 6).map((bot) => (
                <li key={bot.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{bot.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-dim">
                      {bot.kind === "discord" ? bot.sourceName || "Discord source" : "KOL strategy"} · v{bot.version}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusPill status={bot.status} />
                    <Link href={`/bots/${bot.kind}/${bot.id}/edit`} className="inline-flex min-h-11 items-center rounded-md border border-edge px-3 text-[11px] font-semibold text-ink sm:min-h-8">Edit</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="overflow-hidden rounded-md border border-edge bg-panel">
          <header className="flex items-center justify-between border-b border-edge px-4 py-3">
            <div className="flex items-center gap-2">
              <KolStrategyIcon size={16} className="text-up" />
              <h2 className="text-sm font-semibold text-ink">KOL strategies</h2>
            </div>
            <Link href="/bots/kol" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-gold-400 sm:min-h-0">
              All strategies <ArrowRight aria-hidden="true" size={13} />
            </Link>
          </header>
          {strategies != null && strategies.length === 0 && (
            <EmptyState compact icon={KolStrategyIcon} title="No published strategies yet" description="Publish one from the KOL builder to list it here." />
          )}
          {strategies == null && !loading && (
            <EmptyState compact icon={KolStrategyIcon} title="Strategy data is unavailable" description="The marketplace did not respond. Refresh to try again." />
          )}
          {strategies != null && strategies.length > 0 && (
            <ul className="divide-y divide-edge">
              {strategies.slice(0, 6).map((strategy) => (
                <li key={strategy.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{strategy.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-dim">
                      {strategy.creatorName} · {strategy.sampleSize} trades
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`font-mono text-xs tabular-nums ${Number(strategy.netPnlLamports ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                      {strategy.netPnlLamports == null ? "Collecting data" : formatSol(strategy.netPnlLamports)}
                    </span>
                    <Link href={`/bots/kol/${strategy.id}`} className="inline-flex min-h-11 items-center rounded-md border border-edge px-3 text-[11px] font-semibold text-ink sm:min-h-8">Open</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function Tile({ label, value, detail, tone = "default" }: {
  label: string;
  value: number | string | null;
  detail?: string;
  tone?: "default" | "positive";
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-dim">{label}</p>
      <p className={`mt-1.5 font-mono text-lg font-semibold tabular-nums ${tone === "positive" ? "text-up" : "text-ink"}`}>
        {value == null ? "--" : value}
      </p>
      {detail && <p className="mt-0.5 truncate font-mono text-[9px] text-dim">{detail}</p>}
    </div>
  );
}

/**
 * A measured statistic, or a dash. Never 0 for an absent value: a source with no measured
 * calls has no hit rate, and "0.0%" is a claim about its record rather than an absence of one.
 */
function Cell({ value, suffix, digits = 1, positive = false, lowIsBad = false }: {
  value: number | null | undefined;
  suffix: string;
  digits?: number;
  positive?: boolean;
  lowIsBad?: boolean;
}) {
  const tone = value == null
    ? "text-dim"
    : lowIsBad && value < 1
      ? "text-down"
      : positive
        ? "text-up"
        : "text-ink";
  return (
    <td className={`px-4 py-3 text-right font-mono tabular-nums ${tone}`}>
      {value == null ? "--" : `${value.toFixed(digits)}${suffix}`}
    </td>
  );
}
