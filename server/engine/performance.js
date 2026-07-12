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

function performanceUpdate(call, quote, now = new Date().toISOString()) {
  const update = { last_scanned_at: now };
  const entryPrice = numberOrNull(call.called_price_usd);
  const currentPrice = numberOrNull(quote?.priceUsd);
  const entryMcap = numberOrNull(call.called_mcap);
  const currentMcap = numberOrNull(quote?.marketCap);

  if (currentPrice) {
    update.latest_price_usd = currentPrice;
    update.peak_price_usd = Math.max(numberOrNull(call.peak_price_usd) || entryPrice || 0, currentPrice);
  }
  if (currentMcap) {
    update.latest_mcap = currentMcap;
    update.peak_mcap = Math.max(numberOrNull(call.peak_mcap) || entryMcap || 0, currentMcap);
  }
  if (numberOrNull(quote?.liquidityUsd)) update.latest_liquidity_usd = quote.liquidityUsd;
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
    await refreshCallPerformance(deps);
    setTimeout(tick, pollMs);
  };
  tick();
}

module.exports = { bestSolanaPair, quoteToken, performanceUpdate, refreshCallPerformance, startPerformanceScanner };
