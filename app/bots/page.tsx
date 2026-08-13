"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import AppShell from "@/components/AppShell";
import { EmptyState, LoadingRows, PageHeader, ProductTabs, StatusPill } from "@/components/product/Primitives";
import { DiscordSourceAvatar, IntegrationHealthDot } from "@/components/product/DiscordSourceVisual";
import SourceSpotlight from "@/components/product/SourceSpotlight";
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
            {/* One gold control per screen. "My Bots" was a second filled-weight button
                duplicating a tab two rows below it, so neither read as the primary move. */}
            <button type="button" onClick={loadPublic} className="grid h-11 w-11 place-items-center rounded-md text-dim transition hover:bg-[color:var(--rule)] hover:text-ink sm:h-10 sm:w-10" aria-label="Refresh" title="Refresh">
              <RefreshCw aria-hidden="true" size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <Link href="/bots/discord/new" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gold-400 px-4 t-body font-medium text-[#17110c] transition hover:bg-gold-300 sm:min-h-10">
              <Plus aria-hidden="true" size={16} /> New bot
            </Link>
          </>
        }
      />
      {/* No tab strip. The rail already lists Discord sources, KOL strategies and My bots, so
          this was the same four destinations twice on one screen, six inches apart. Two
          navigations for one set of pages is the thing that makes a product feel unfinished —
          and it leaves the user to work out whether they differ. They did not. */}

      {/* The ledger rail: figures on the canvas between two hairlines, read number-first.
          This was six bordered cells with the value at 18px above a 9px caption — the money
          and its name were within a hair of each other, so neither one led. */}
      <section className="rail mt-7 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Totals across the last seven days">
        <Tile label="Approved sources" value={totals.sources} />
        <Tile label="KOL strategies" value={totals.strategies} />
        <Tile label="Calls measured" value={totals.measured} />
        <Tile label="Volume copied" value={totals.copied == null ? null : formatSol(totals.copied)} />
        <Tile label="Your bots" value={totals.bots} detail={authenticated ? undefined : "Connect to view"} />
        <Tile label="Running" value={totals.active} tone={totals.active ? "positive" : "default"} />
      </section>

      {/* The card row from the dashboard reference, above the dense list rather than instead
          of it. The rail answers "how much", these answer "which one", and the list below
          answers "all of them" — three questions, in the order someone opening the app asks
          them. Renders nothing until real sources have loaded. */}
      {/* One presentation of the sources, not two. The dense table that sat here repeated
          these same rows immediately below the cards — with two approved sources it was
          literally the same two, twice. The full table still exists at /bots/discord, which
          is where "All sources" goes. */}
      <SourceSpotlight sources={sources} loading={loading} />

      <section className="mt-11 grid gap-11 xl:grid-cols-2 xl:gap-10">
        <div>
          <header className="flex items-baseline justify-between gap-3 pb-1">
            <h2 className="t-section font-medium text-ink">Your bots</h2>
            <Link href="/bots/manage" className="inline-flex min-h-11 items-center gap-1 t-meta font-medium text-ink transition hover:text-gold-400 sm:min-h-0">
              Manage <ArrowRight aria-hidden="true" size={13} className="text-[color:var(--text-muted)]" />
            </Link>
          </header>
          {!authenticated && (
            <EmptyState compact icon={DegenBotIcon} title="Connect your wallet to see your bots" description="Your setups and their performance are private to your account." />
          )}
          {authenticated && bots != null && bots.length === 0 && (
            <EmptyState
              compact
              icon={DegenBotIcon}
              title="You have not built a bot yet"
              description="Pick a source above to copy its calls, or write your own market rules."
              action={
                <Link href="/bots/kol/new" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[color:var(--rule-strong)] px-3.5 t-meta font-medium text-ink transition hover:border-gold-400/60 sm:min-h-9">
                  Build a KOL strategy
                </Link>
              }
            />
          )}
          {authenticated && bots != null && bots.length > 0 && (
            <ul className="border-t border-[color:var(--rule)]">
              {bots.slice(0, 6).map((bot) => (
                <li key={bot.id} className="flex items-center justify-between gap-3 border-b border-[color:var(--rule)] py-3.5">
                  <div className="min-w-0">
                    <p className="truncate t-body font-medium text-ink">{bot.name}</p>
                    <p className="mt-0.5 truncate t-label text-dim">
                      {bot.kind === "discord" ? bot.sourceName || "Discord source" : "KOL strategy"} · version {bot.version}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <StatusPill status={bot.status} />
                    <Link href={`/bots/${bot.kind}/${bot.id}/edit`} className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--rule-strong)] px-3 t-meta font-medium text-ink transition hover:border-gold-400/60 sm:min-h-8">Edit</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <header className="flex items-baseline justify-between gap-3 pb-1">
            <h2 className="t-section font-medium text-ink">KOL strategies</h2>
            <Link href="/bots/kol" className="inline-flex min-h-11 items-center gap-1 t-meta font-medium text-ink transition hover:text-gold-400 sm:min-h-0">
              All strategies <ArrowRight aria-hidden="true" size={13} className="text-[color:var(--text-muted)]" />
            </Link>
          </header>
          {strategies != null && strategies.length === 0 && (
            <EmptyState compact icon={KolStrategyIcon} title="Nothing published yet" description="Publish a strategy from the KOL builder and it appears here." />
          )}
          {strategies == null && !loading && (
            <EmptyState compact icon={KolStrategyIcon} title="Could not load strategies" description="The marketplace did not answer. Refresh to try again." />
          )}
          {strategies != null && strategies.length > 0 && (
            <ul className="border-t border-[color:var(--rule)]">
              {strategies.slice(0, 6).map((strategy) => (
                <li key={strategy.id} className="flex items-center justify-between gap-3 border-b border-[color:var(--rule)] py-3.5">
                  <div className="min-w-0">
                    <p className="truncate t-body font-medium text-ink">{strategy.name}</p>
                    <p className="mt-0.5 truncate t-label text-dim">
                      {strategy.creatorName} · {strategy.sampleSize} trades
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    {strategy.netPnlLamports == null ? (
                      <span className="t-label text-[color:var(--text-muted)]">Collecting data</span>
                    ) : (
                      <span className={`ui-figure t-body ${Number(strategy.netPnlLamports) >= 0 ? "text-up" : "text-down"}`}>
                        {formatSol(strategy.netPnlLamports)}
                      </span>
                    )}
                    <Link href={`/bots/kol/${strategy.id}`} className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--rule-strong)] px-3 t-meta font-medium text-ink transition hover:border-gold-400/60 sm:min-h-8">Open</Link>
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

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th scope="col" className={`ui-label pb-2.5 font-normal ${right ? "pr-4 text-right last:pr-0" : "pr-4"}`}>{children}</th>;
}

function Faint({ children }: { children: React.ReactNode }) {
  return <span className="text-[color:var(--text-muted)]">{children}</span>;
}

/** One figure in the mobile card, with its current value beneath when the pair exists. */
function CardStat({ label, value, now }: { label: string; value: string | null; now?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="ui-label">{label}</dt>
      <dd className={`ui-figure mt-1 t-body ${value == null ? "ui-absent" : "text-ink"}`}>{value ?? "—"}</dd>
      {now !== undefined && (
        <dd className={`ui-figure t-label ${now == null ? "ui-absent" : "text-dim"}`}>{now ?? "—"}</dd>
      )}
    </div>
  );
}

function Tile({ label, value, detail, tone = "default" }: {
  label: string;
  value: number | string | null;
  detail?: string;
  tone?: "default" | "positive";
}) {
  return (
    <div className="min-w-0">
      <p className={`ui-figure t-title leading-none lg:t-figure-lg ${tone === "positive" ? "text-up" : "text-ink"}`}>
        {value == null ? <span className="ui-absent">—</span> : value}
      </p>
      <p className="ui-label mt-2 truncate">{label}</p>
      {detail && <p className="mt-1 truncate t-label text-[color:var(--text-muted)]">{detail}</p>}
    </div>
  );
}

/**
 * A statistic at its peak beside the same statistic right now, in one cell.
 *
 * Both must be present. The peak alone is the defect migration 10 exists to fix: a source
 * whose ten calls each touched 2x and then went to zero reads as a flawless record if only the
 * peak is shown. Current sits underneath in a quieter tone — same number, less claim.
 *
 * An absent value is an em dash, never 0. A source with nothing measured has no hit rate, and
 * "0.0%" states something about its record rather than the absence of one.
 */
function Pair({ peak, now, suffix, digits }: {
  peak: number | null | undefined;
  now: number | null | undefined;
  suffix: string;
  digits: number;
}) {
  const fmt = (value: number | null | undefined) =>
    value == null ? null : `${value.toFixed(digits)}${suffix}`;
  const peakText = fmt(peak);
  const nowText = fmt(now);
  const nowTone = now == null ? "ui-absent" : suffix === "x" && now < 1 ? "text-down" : "text-dim";
  return (
    <td className="py-3.5 pr-4 text-right">
      <span className={`ui-figure block t-body ${peakText == null ? "ui-absent" : "text-ink"}`}>
        {peakText ?? "—"}
      </span>
      <span className={`ui-figure mt-0.5 block t-label ${nowTone}`}>{nowText ?? "—"}</span>
    </td>
  );
}
