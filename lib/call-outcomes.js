// Signal outcome and marketplace aggregation maths.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §9.5, §9.6.
//
// CommonJS so the TypeScript app and the CommonJS test runner share one implementation
// (same pattern as lib/fee-model.js and lib/referral-rules.js).
//
// These are ranking and display figures, not ledger values, so ordinary numbers are
// appropriate here — unlike lib/fee-model.js, nothing computed here reaches a payout.
// Basis-point outputs are still integers.

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Peak return as a multiple of entry. Prefers price, falls back to market cap. */
function peakMultiple(call) {
  const entryPrice = positive(call && call.called_price_usd);
  const peakPrice = positive(call && call.peak_price_usd);
  if (entryPrice && peakPrice) return peakPrice / entryPrice;
  const entryMcap = positive(call && call.called_mcap);
  const peakMcap = positive(call && call.peak_mcap);
  return entryMcap && peakMcap ? peakMcap / entryMcap : null;
}

/**
 * Maximum adverse excursion from the measured peak, in integer basis points.
 *
 * Returns null when the call was never measured. An unmeasured call and a call that
 * never drew down are different facts and must not render identically.
 */
function maxDrawdownBps(call) {
  const peak = positive(call && call.peak_price_usd) || positive(call && call.peak_mcap);
  const latest = positive(call && call.latest_price_usd) || positive(call && call.latest_mcap);
  if (!peak || !latest) return null;
  if (latest >= peak) return 0;
  return Math.round(((peak - latest) / peak) * 10000);
}

/** Marketplace outcome buckets. A measured call falls in exactly one. */
function outcomeBucket(call) {
  const peak = peakMultiple(call);
  if (peak == null) return null;
  if (peak >= 5) return "fiveX";
  if (peak >= 2) return "twoX";
  if (peak >= 1.5) return "plus50";
  return "under50";
}

function outcomeDistribution(calls) {
  const counts = { under50: 0, plus50: 0, twoX: 0, fiveX: 0 };
  for (const call of calls || []) {
    const bucket = outcomeBucket(call);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Full marketplace aggregate for one period (§9.6).
 *
 * `measured` is the honest gate: below the minimum sample the figures exist but must be
 * presented as "Tracking", never as a ranking-grade result. Callers must never
 * substitute a fabricated value when `measured` is false — a missing metric is a bug
 * report, not a display problem.
 */
function sourceAggregate(calls, options) {
  const list = calls || [];
  const minimumSampleSize = (options && options.minimumSampleSize) || 5;
  const multiples = list.map(peakMultiple).filter((value) => value !== null);
  const drawdowns = list.map(maxDrawdownBps).filter((value) => value !== null);

  const lastCallAt = list.reduce((latest, call) => {
    if (!call || !call.called_at) return latest;
    return !latest || call.called_at > latest ? call.called_at : latest;
  }, null);

  return {
    eligibleCalls: list.length,
    measuredCalls: multiples.length,
    measured: multiples.length >= minimumSampleSize,
    minimumSampleSize,
    // A win is any call that went up at all. Distinct from a 2x "hit".
    winRate: multiples.length ? (multiples.filter((value) => value > 1).length / multiples.length) * 100 : null,
    medianReturnX: median(multiples),
    averageReturnX: multiples.length ? multiples.reduce((sum, value) => sum + value, 0) / multiples.length : null,
    maxDrawdownBps: drawdowns.length ? Math.max.apply(null, drawdowns) : null,
    distribution: outcomeDistribution(list),
    lastCallAt,
    freshnessAt: (options && options.freshnessAt) || null
  };
}

/**
 * Deduplication key for a raw source event (§9.1).
 * Cross-posts of the same mint in the same channel collapse to one signal; an edited
 * message keeps the original event identity.
 */
function deduplicationKey(event) {
  const e = event || {};
  return [
    String(e.sourceId || "").trim(),
    String(e.channelId || "").trim(),
    String(e.mint || "").trim()
  ].join(":");
}

function dedupeSignals(events) {
  const seen = new Set();
  const out = [];
  for (const event of events || []) {
    const key = deduplicationKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

module.exports = {
  peakMultiple,
  maxDrawdownBps,
  outcomeBucket,
  outcomeDistribution,
  sourceAggregate,
  deduplicationKey,
  dedupeSignals
};
