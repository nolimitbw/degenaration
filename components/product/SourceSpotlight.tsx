"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { DiscordSourceAvatar } from "@/components/product/DiscordSourceVisual";
import { EmptyState } from "@/components/product/Primitives";
import DiscordSignalIcon from "@/components/icons/DiscordSignalIcon";
import type { DiscordSource } from "@/lib/product-api";

/**
 * The card row at the top of the workspace, from the owner's dashboard reference.
 *
 * The reference cards each carry a price sparkline. We have no per-source time series to draw
 * one from, and inventing a curve on a card that also shows a win rate would read as measured
 * history — so the graphic is a real distribution bar instead: the share of a source's
 * measured calls that are up right now, against the share that are down.
 *
 * Everything shown comes from the CURRENT family (`currentWinRate`, `medianCurrentX`,
 * `measuredCurrent`) and never the peak family. Mixing them is the defect this project already
 * shipped once: "win rate 100%, average return 2.00x" for a source whose every call touched 2x
 * and then went to zero. Peak answers "did it ever" and current answers "is it now", and a
 * card that draws one number from each answers neither.
 *
 * A source with nothing measured shows its call count and the word Tracking. It never shows a
 * 0% win rate, because no measured calls and every call losing are different facts.
 */
export default function SourceSpotlight({
  sources,
  loading = false
}: {
  sources: DiscordSource[] | null;
  loading?: boolean;
}) {
  const top = (sources || []).slice(0, 3);

  return (
    <section className="mt-7" aria-labelledby="spotlight">
      <header className="flex flex-wrap items-baseline justify-between gap-3 pb-3">
        <div className="flex items-baseline gap-2.5">
          <h2 id="spotlight" className="t-section font-medium text-ink">Most active sources</h2>
          <span className="ui-label">By calls recorded</span>
        </div>
        <Link
          href="/bots/discord"
          className="inline-flex min-h-11 items-center gap-1 t-meta font-medium text-ink transition-colors duration-150 hover:text-gold-400 sm:min-h-0"
        >
          All sources <ArrowRight aria-hidden="true" size={13} className="text-[color:var(--text-muted)]" />
        </Link>
      </header>

      {/* The three states the dense table used to carry. They moved here with it rather than
          being dropped: a request that fails and a marketplace with nothing in it are
          different facts, and neither may render as an empty row of cards. */}
      {loading && sources == null && (
        <p className="rounded-2xl border border-edge bg-panel p-6 t-meta text-dim">Loading sources…</p>
      )}
      {sources == null && !loading && (
        <EmptyState
          icon={DiscordSignalIcon}
          title="Could not load sources"
          description="The marketplace did not answer. Refresh to try again."
        />
      )}
      {sources != null && sources.length === 0 && (
        <EmptyState
          icon={DiscordSignalIcon}
          title="No approved sources yet"
          description="Call communities show up here once a server passes review."
        />
      )}

      {top.length > 0 && (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {top.map((source) => <SpotlightCard key={source.id} source={source} />)}

        {/* The reference's promoted card. Gold is spent once per screen and this is the one
            action the whole screen exists to lead to. */}
        <article className="spotlight-cta relative isolate flex flex-col justify-between overflow-hidden rounded-2xl border border-[color:var(--border-strong)] p-5">
          <div aria-hidden="true" className="stage-bloom" />
          <div className="relative z-10">
            <p className="ui-label">Start here</p>
            <h3 className="mt-2 text-lg font-semibold leading-tight text-ink">Copy a source</h3>
            <p className="mt-2 t-meta leading-6 text-dim">
              Set your buy size, take profit and stop loss. Your limits, not the caller&apos;s.
            </p>
          </div>
          <Link
            href="/bots/discord/new"
            className="relative z-10 mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gold-400 px-5 t-meta font-semibold text-[#17110c] transition-colors duration-150 hover:bg-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200"
          >
            Build a bot <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </article>
      </div>
      )}
    </section>
  );
}

function SpotlightCard({ source }: { source: DiscordSource }) {
  const measured = Number(source.measuredCurrent ?? 0);
  const winRate = source.currentWinRate;
  const median = source.medianCurrentX;
  // `currentWinRate` arrives as a percentage share of measured calls that are up now.
  const upShare = measured > 0 && winRate != null ? Math.max(0, Math.min(100, Number(winRate))) : null;
  // The peak family, shown beside the current one rather than instead of it.
  const peakShare = measured > 0 && source.winRate != null ? Number(source.winRate) : null;
  const peakMedian = measured > 0 && source.medianReturnX != null ? Number(source.medianReturnX) : null;
  const href = source.publicSlug ? `/source/${source.publicSlug}` : "/bots/discord";

  return (
    <article className="group relative flex flex-col rounded-2xl border border-edge bg-panel p-5 transition-colors duration-150 hover:border-[color:var(--border-strong)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <DiscordSourceAvatar source={source} size="md" />
          <div className="min-w-0">
            <p className="ui-label">Discord source</p>
            <p className="truncate t-body font-medium text-ink">{source.name}</p>
          </div>
        </div>
        <Link
          href={href}
          aria-label={`Open ${source.name}`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-edge text-dim transition-colors duration-150 group-hover:border-gold-400 group-hover:text-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
        >
          <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </div>

      {upShare == null ? (
        <div className="mt-6">
          <p className="ui-figure text-2xl leading-none text-ink">
            {source.totalCalls == null ? "—" : source.totalCalls.toLocaleString()}
          </p>
          <p className="mt-2 t-label text-dim">Calls recorded · Tracking</p>
        </div>
      ) : (
        <div className="mt-6">
          <p className="ui-label">Hit rate — up now</p>
          <p className="ui-figure mt-1 text-3xl leading-none text-ink">{upShare.toFixed(1)}%</p>
          {/* Peak beside current, always, never one alone.
              A source whose every call touched 2x and then went to zero reads 72.2% peak and
              33.3% up now — the pair is the whole story and either number by itself is a
              different, wrong one. This product shipped the peak-only version once. */}
          <p className="mt-1.5 t-label text-dim">
            {peakShare != null && <>Peak {peakShare.toFixed(1)}% · </>}
            {median != null && <>Median now {Number(median).toFixed(2)}x · </>}
            {peakMedian != null && <>peak {Number(peakMedian).toFixed(2)}x · </>}
            {measured} measured
          </p>
          {/* The distribution, as real proportions. Text states it too — colour never carries
              the meaning on its own. */}
          <div
            className="mt-4 flex h-1.5 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`${upShare.toFixed(1)} percent of ${measured} measured calls are up now`}
          >
            <span className="bg-up" style={{ width: `${upShare}%` }} />
            <span className="flex-1 bg-[color:var(--rule-strong,var(--rule))]" />
          </div>
        </div>
      )}
    </article>
  );
}
