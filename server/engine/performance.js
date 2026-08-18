/**
 * Call-performance scanner. It records live entry, current, and peak values without
 * assuming a subscriber actually traded the call.
 */
const DEX = "https://api.dexscreener.com/latest/dex/tokens/";

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function bestSolanaPair(data, mint) {
  return (data?.pairs || [])
    .filter((pair) => pair?.chainId === "solana" && pair?.baseToken?.address === mint)
    .sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || null;
}

async function quoteToken(mint, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`${DEX}${encodeURIComponent(mint)}`, { signal: controller.signal });
    if (!response.ok) return null;
    const pair = bestSolanaPair(await response.json(), mint);
    if (!pair) return null;
    return {
      priceUsd: numberOrNull(pair.priceUsd),
      marketCap: numberOrNull(pair.marketCap) || numberOrNull(pair.fdv),
      liquidityUsd: numberOrNull(pair?.liquidity?.usd)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Journaled outcomes, in multiples of the entry price. Up legs are measured against the
// call's peak, the down leg against its trough — so a call is credited with what it
// actually did, not with where it happens to sit at scan time.
const MILESTONES = [
  { column: "hit_up_50_at", multiple: 1.5, direction: "up" },
  { column: "hit_2x_at", multiple: 2, direction: "up" },
  { column: "hit_5x_at", multiple: 5, direction: "up" },
  { column: "hit_down_50_at", multiple: 0.5, direction: "down" }
];

function performanceUpdate(call, quote, now = new Date().toISOString()) {
  const update = { last_scanned_at: now };
  const entryPrice = numberOrNull(call.called_price_usd);
  const currentPrice = numberOrNull(quote?.priceUsd);
  const entryMcap = numberOrNull(call.called_mcap);
  const currentMcap = numberOrNull(quote?.marketCap);

  let peakPrice = numberOrNull(call.peak_price_usd) || entryPrice || null;
  let troughPrice = numberOrNull(call.trough_price_usd) || entryPrice || null;

  if (currentPrice) {
    update.latest_price_usd = currentPrice;
    peakPrice = Math.max(peakPrice || 0, currentPrice);
    troughPrice = Math.min(troughPrice || currentPrice, currentPrice);
    update.peak_price_usd = peakPrice;
    update.trough_price_usd = troughPrice;
  }
  if (currentMcap) {
    update.latest_mcap = currentMcap;
    update.peak_mcap = Math.max(numberOrNull(call.peak_mcap) || entryMcap || 0, currentMcap);
  }
  if (numberOrNull(quote?.liquidityUsd)) update.latest_liquidity_usd = quote.liquidityUsd;

  // Without an entry price there is nothing to measure against yet — the call stays open
  // and enrichment or a later scan will backfill it.
  if (!entryPrice) return update;

  for (const { column, multiple, direction } of MILESTONES) {
    if (call[column]) continue; // write-once: a milestone reached is never un-reached
    const reached = direction === "up"
      ? peakPrice && peakPrice >= entryPrice * multiple
      : troughPrice && troughPrice <= entryPrice * multiple;
    if (reached) update[column] = now;
  }

  // Settled on whichever leg came first; still 'open' until one of them does.
  const wonAt = call.hit_up_50_at || update.hit_up_50_at || null;
  const lostAt = call.hit_down_50_at || update.hit_down_50_at || null;
  if (wonAt && lostAt) update.outcome = Date.parse(wonAt) <= Date.parse(lostAt) ? "win" : "loss";
  else if (wonAt) update.outcome = "win";
  else if (lostAt) update.outcome = "loss";
  else if (!call.outcome) update.outcome = "open";

  return update;
}

async function refreshCallPerformance(deps) {
  const { loadPerformanceCalls, updateCallPerformance, onEvent = () => {}, quote = quoteToken } = deps;
  let calls = [];
  try { calls = await loadPerformanceCalls(); }
  catch (error) { onEvent({ type: "PERFORMANCE_LOAD_ERROR", error: error.message }); return; }

  const quotes = new Map();
  for (const call of calls || []) {
    if (!call?.id || !call?.mint) continue;
    if (!quotes.has(call.mint)) quotes.set(call.mint, quote(call.mint));
    const live = await quotes.get(call.mint);
    if (!live) { onEvent({ type: "PERFORMANCE_MISSING", mint: call.mint }); continue; }
    try {
      await updateCallPerformance(call.id, performanceUpdate(call, live));
      onEvent({ type: "PERFORMANCE_UPDATED", mint: call.mint, call: call.id });
    } catch (error) {
      onEvent({ type: "PERFORMANCE_WRITE_ERROR", mint: call.mint, error: error.message });
    }
  }
}

function startPerformanceScanner(deps, pollMs = 300_000) {
  const tick = async () => {
    try { await refreshCallPerformance(deps); }
    catch (error) { deps.onEvent?.({ type: "PERFORMANCE_TICK_ERROR", error: error.message }); }
    finally { setTimeout(tick, pollMs); }
  };
  tick();
}

module.exports = { bestSolanaPair, quoteToken, performanceUpdate, refreshCallPerformance, startPerformanceScanner };
