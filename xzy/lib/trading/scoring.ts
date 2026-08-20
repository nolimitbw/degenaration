/**
 * Turning a channel's recorded calls into a score.
 *
 * Pure, so the definition of "good channel" is inspectable and testable rather than
 * buried in a query. The rule throughout: a call we could not measure is excluded, never
 * counted as a zero — averaging in unmeasured calls would quietly punish channels whose
 * tokens our price feed simply did not cover.
 */

export type MeasuredCall = {
  calledPriceUsd: number | null;
  peakPriceUsd: number | null;
};

export type ChannelStats = {
  callsMeasured: number;
  wins: number;
  /** Wins as a percentage of measured calls, or null when nothing is measured. */
  winRatePct: number | null;
  avgPeakX: number | null;
  medianPeakX: number | null;
  bestPeakX: number | null;
};

/** A call "wins" if it ever traded meaningfully above where it was called. */
export const WIN_THRESHOLD_X = 1.5;

/** Peak multiple of a single call, e.g. 3 for a token that tripled. */
export function peakMultiple(call: MeasuredCall): number | null {
  if (call.calledPriceUsd === null || call.peakPriceUsd === null) return null;
  if (!(call.calledPriceUsd > 0) || !(call.peakPriceUsd > 0)) return null;
  return call.peakPriceUsd / call.calledPriceUsd;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function computeStats(calls: MeasuredCall[]): ChannelStats {
  const multiples = calls.map(peakMultiple).filter((value): value is number => value !== null);

  if (multiples.length === 0) {
    // Nothing measurable. Every field stays null so the UI shows "not measured yet"
    // rather than a 0% that reads like a track record of failure.
    return { callsMeasured: 0, wins: 0, winRatePct: null, avgPeakX: null, medianPeakX: null, bestPeakX: null };
  }

  const wins = multiples.filter((value) => value >= WIN_THRESHOLD_X).length;
  const sum = multiples.reduce((total, value) => total + value, 0);

  return {
    callsMeasured: multiples.length,
    wins,
    winRatePct: (wins / multiples.length) * 100,
    avgPeakX: sum / multiples.length,
    // The median is the honest headline: one 400x call drags an average somewhere no
    // subscriber would actually have experienced.
    medianPeakX: median(multiples),
    bestPeakX: Math.max(...multiples)
  };
}
