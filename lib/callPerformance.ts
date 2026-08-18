export type PerformanceCall = {
  id: string;
  group_id?: string | null;
  group_name?: string | null;
  caller?: string | null;
  mint?: string | null;
  symbol?: string | null;
  called_at?: string | null;
  called_mcap?: number | string | null;
  peak_mcap?: number | string | null;
  latest_mcap?: number | string | null;
  called_price_usd?: number | string | null;
  peak_price_usd?: number | string | null;
  latest_price_usd?: number | string | null;
  trough_price_usd?: number | string | null;
  // Write-once milestone stamps set by the worker's performance scanner. They record
  // what a call actually did, for every call, whether or not anybody copied it.
  hit_down_50_at?: string | null;
  hit_up_50_at?: string | null;
  hit_2x_at?: string | null;
  hit_5x_at?: string | null;
  outcome?: "open" | "win" | "loss" | null;
};

export const MILESTONES = [
  { key: "hit_up_50_at", label: "+50%", tone: "up" },
  { key: "hit_2x_at", label: "2x", tone: "up" },
  { key: "hit_5x_at", label: "5x", tone: "up" },
  { key: "hit_down_50_at", label: "-50%", tone: "down" }
] as const;

/** The milestones a call has actually reached, in order. */
export function reachedMilestones(call: PerformanceCall) {
  return MILESTONES.filter(({ key }) => Boolean(call[key]));
}

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function peakMultiple(call: PerformanceCall): number | null {
  const entryPrice = positive(call.called_price_usd);
  const peakPrice = positive(call.peak_price_usd);
  if (entryPrice && peakPrice) return peakPrice / entryPrice;

  const entryMcap = positive(call.called_mcap);
  const peakMcap = positive(call.peak_mcap);
  return entryMcap && peakMcap ? peakMcap / entryMcap : null;
}

export function currentMultiple(call: PerformanceCall): number | null {
  const entryPrice = positive(call.called_price_usd);
  const currentPrice = positive(call.latest_price_usd);
  if (entryPrice && currentPrice) return currentPrice / entryPrice;

  const entryMcap = positive(call.called_mcap);
  const currentMcap = positive(call.latest_mcap);
  return entryMcap && currentMcap ? currentMcap / entryMcap : null;
}

export type SourceMetrics = {
  calls: number;
  measuredCalls: number;
  hitRate: number | null;
  avgPeakX: number | null;
  medianPeakX: number | null;
  bestPeakX: number | null;
  latestCallAt: string | null;
  // Journaled outcomes. `winRate` is over SETTLED calls only — an open call has not
  // proved anything yet, and counting it either way would misstate the record.
  wins: number;
  losses: number;
  openCalls: number;
  winRate: number | null;
  up50: number;
  x2: number;
  x5: number;
  down50: number;
};

export function sourceMetrics(calls: PerformanceCall[]): SourceMetrics {
  const multiples = calls.map(peakMultiple).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const middle = Math.floor(multiples.length / 2);
  const median = multiples.length
    ? multiples.length % 2 ? multiples[middle] : (multiples[middle - 1] + multiples[middle]) / 2
    : null;
  const latestCallAt = calls.reduce<string | null>((latest, call) => {
    if (!call.called_at) return latest;
    return !latest || call.called_at > latest ? call.called_at : latest;
  }, null);

  const count = (key: "hit_up_50_at" | "hit_2x_at" | "hit_5x_at" | "hit_down_50_at") =>
    calls.filter((call) => Boolean(call[key])).length;
  const wins = calls.filter((call) => call.outcome === "win").length;
  const losses = calls.filter((call) => call.outcome === "loss").length;
  const settled = wins + losses;

  return {
    calls: calls.length,
    measuredCalls: multiples.length,
    wins,
    losses,
    openCalls: calls.length - settled,
    winRate: settled ? (wins / settled) * 100 : null,
    up50: count("hit_up_50_at"),
    x2: count("hit_2x_at"),
    x5: count("hit_5x_at"),
    down50: count("hit_down_50_at"),
    hitRate: multiples.length ? multiples.filter((value) => value >= 2).length / multiples.length * 100 : null,
    avgPeakX: multiples.length ? multiples.reduce((sum, value) => sum + value, 0) / multiples.length : null,
    medianPeakX: median,
    bestPeakX: multiples.length ? multiples[multiples.length - 1] : null,
    latestCallAt
  };
}
