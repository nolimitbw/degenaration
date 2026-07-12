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
};

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

  return {
    calls: calls.length,
    measuredCalls: multiples.length,
    hitRate: multiples.length ? multiples.filter((value) => value >= 2).length / multiples.length * 100 : null,
    avgPeakX: multiples.length ? multiples.reduce((sum, value) => sum + value, 0) / multiples.length : null,
    medianPeakX: median,
    bestPeakX: multiples.length ? multiples[multiples.length - 1] : null,
    latestCallAt
  };
}
