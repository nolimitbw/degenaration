"use client";

import {
  formatSol,
  formatWhen,
  type DiscordSource,
  type DiscordSourcePerformance
} from "@/lib/product-api";

/**
 * The three metric bands on a source card.
 *
 * Every cell here used to be its own filled box on a 1px grid — eighteen boxes per card,
 * inside a card, inside a page. And the captions were set at **8px**, well under any
 * readable floor, so the card was simultaneously loud in structure and unreadable in detail.
 *
 * Now: hairlines between cells, one type size for names and one for figures.
 */

export function DiscordActivityGrid({ source }: { source: DiscordSource }) {
  return (
    <div className="grid gap-y-4 sm:grid-cols-3 sm:gap-y-0">
      {/* `lastSignalAt` is max(called_at) — when a caller actually posted.
          `lastProcessedCallAt` is max(executed_at), which the ENGINE stamps when it handles a
          call, including when the rug check rejects it. Labelling the second "Last call seen"
          made the card report a source as active hours after its last real call, because the
          engine had just walked the backlog. A source that has gone quiet must look quiet. */}
      <ActivityState label="Last call seen" value={activityTime(source.lastSignalAt, "None yet")} />
      <ActivityState label="Last trade filled" value={activityTime(source.lastSuccessfulExecutionAt, "None yet")} />
      <ActivityState label="Data updated" value={freshnessState(source)} />
    </div>
  );
}

export function DiscordPerformanceGrid({ source }: { source: DiscordSource }) {
  return (
    <div className="grid gap-y-4 sm:grid-cols-3 sm:gap-y-0">
      <PerformanceState label="1 day" performance={source.performance1d} />
      <PerformanceState label="7 days" performance={source.performance7d} />
      <PerformanceState label="30 days" performance={source.performance30d} />
    </div>
  );
}

export function DiscordCallCounts({ source }: { source: DiscordSource }) {
  return (
    <div className="grid grid-cols-4 gap-y-4">
      <CountState label="Signals" value={source.totalCalls} />
      <CountState label="Accepted" value={source.acceptedCalls ?? source.eligibleCalls} />
      <CountState label="Rejected" value={source.rejectedCalls} />
      <CountState label="Retracted" value={source.retractedCalls} />
      <CountState label="Watching" value={source.activeMonitoring} />
      <CountState label="Measured" value={source.measuredCalls} />
      <CountState label="Copied" value={source.copiedExecutions} />
      {/* Call performance and copied-trade performance are deliberately reported apart.
          This is the second: what subscribers actually confirmed on chain through this
          source, in integer lamports from the ledger. Zero here is a fact, not a gap. */}
      <CountState label="Volume" value={source.copiedVolumeLamports == null ? undefined : formatSol(source.copiedVolumeLamports)} />
    </div>
  );
}

function ActivityState({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 sm:border-l sm:border-[color:var(--rule)] sm:px-4 sm:first:border-l-0 sm:first:pl-0">
      <p className="ui-label">{label}</p>
      <p className="mt-1 t-meta leading-5 text-ink">{value}</p>
    </div>
  );
}

function PerformanceState({ label, performance }: { label: string; performance?: DiscordSourcePerformance | null }) {
  const value = performance?.netPnlLamports;
  const amount = value == null ? null : Number(value);
  const tone = amount == null || amount === 0 ? "text-ink" : amount > 0 ? "text-up" : "text-down";
  return (
    <div className="min-w-0 sm:border-l sm:border-[color:var(--rule)] sm:px-4 sm:first:border-l-0 sm:first:pl-0">
      <p className="ui-label">{label}</p>
      <p className={`ui-figure mt-1 t-section ${value == null ? "text-[color:var(--text-muted)]" : tone}`}>
        {value == null ? "Collecting data" : formatSol(value)}
      </p>
      <p className="mt-0.5 truncate t-label text-[color:var(--text-muted)]">
        {performance ? `${performance.sampleSize} trades · ${formatWhen(performance.asOf)}` : "Not enough history yet"}
      </p>
    </div>
  );
}

function CountState({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="min-w-0 border-l border-[color:var(--rule)] px-3 first:border-l-0 first:pl-0 [&:nth-child(5)]:border-l-0 [&:nth-child(5)]:pl-0">
      <p className={`ui-figure truncate t-body ${value == null ? "ui-absent" : "text-ink"}`}>
        {value == null ? "—" : value}
      </p>
      <p className="ui-label mt-0.5 truncate">{label}</p>
    </div>
  );
}

function activityTime(value: string | null | undefined, empty: string) {
  if (value === undefined) return "Collecting data";
  return value ? formatWhen(value) : empty;
}

function freshnessState(source: DiscordSource) {
  if (source.integrationHealth === "unavailable") return "Scanner unavailable";
  if (source.integrationHealth === "degraded") return "Processing delayed";
  if (!source.dataFreshnessAt) return "Collecting data";
  const timestamp = new Date(source.dataFreshnessAt).getTime();
  if (!Number.isFinite(timestamp)) return "Collecting data";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Last updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Last updated ${formatWhen(source.dataFreshnessAt)}`;
}
