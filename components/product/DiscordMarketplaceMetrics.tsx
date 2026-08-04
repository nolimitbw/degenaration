"use client";

import {
  formatSol,
  formatWhen,
  type DiscordSource,
  type DiscordSourcePerformance
} from "@/lib/product-api";

export function DiscordActivityGrid({ source }: { source: DiscordSource }) {
  return (
    <div className="grid gap-px bg-edge sm:grid-cols-3">
      <ActivityState label="Last processed call" value={activityTime(source.lastProcessedCallAt, "No processed calls yet")} />
      <ActivityState label="Last successful execution" value={activityTime(source.lastSuccessfulExecutionAt, "No successful execution yet")} />
      <ActivityState label="Data freshness" value={freshnessState(source)} />
    </div>
  );
}

export function DiscordPerformanceGrid({ source }: { source: DiscordSource }) {
  return (
    <div className="grid gap-px bg-edge sm:grid-cols-3">
      <PerformanceState label="1D performance" performance={source.performance1d} />
      <PerformanceState label="7D performance" performance={source.performance7d} />
      <PerformanceState label="30D performance" performance={source.performance30d} />
    </div>
  );
}

export function DiscordCallCounts({ source }: { source: DiscordSource }) {
  return (
    <div className="grid grid-cols-2 gap-px bg-edge sm:grid-cols-4">
      <CountState label="Accepted" value={source.acceptedCalls ?? source.eligibleCalls} />
      <CountState label="Rejected" value={source.rejectedCalls} />
      <CountState label="Executed" value={source.executedCalls} />
      {/* Call performance and copied-trade performance are deliberately reported apart.
          This is the second: what subscribers actually confirmed on chain through this
          source, in integer lamports from the ledger. Zero here is a fact, not a gap. */}
      <CountState label="Copied volume" value={source.copiedVolumeLamports == null ? undefined : formatSol(source.copiedVolumeLamports)} />
    </div>
  );
}

function ActivityState({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-void px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-dim">{label}</p>
      <p className="mt-1.5 text-[11px] leading-5 text-ink">{value}</p>
    </div>
  );
}

function PerformanceState({ label, performance }: { label: string; performance?: DiscordSourcePerformance | null }) {
  const value = performance?.netPnlLamports;
  const amount = value == null ? null : Number(value);
  const tone = amount == null || amount === 0 ? "text-ink" : amount > 0 ? "text-up" : "text-down";
  return (
    <div className="bg-void px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-dim">{label}</p>
      <p className={`mt-1.5 font-mono text-sm font-semibold tabular-nums ${tone}`}>
        {value == null ? "Collecting data" : formatSol(value)}
      </p>
      <p className="mt-1 font-mono text-[8px] text-dim">
        {performance ? `${performance.sampleSize} reconciled trades · ${formatWhen(performance.asOf)}` : "Ledger history is still developing"}
      </p>
    </div>
  );
}

function CountState({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="bg-void px-3 py-2.5 text-center">
      <p className="font-mono text-sm font-semibold tabular-nums text-ink">{value == null ? "Collecting" : value}</p>
      <p className="mt-1 font-mono text-[8px] uppercase text-dim">{label}</p>
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
