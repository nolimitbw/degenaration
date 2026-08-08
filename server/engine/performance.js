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
    if (!response.ok) return { provider: "dexscreener", observedAt: new Date().toISOString(), freshness: "unavailable" };
    const pair = bestSolanaPair(await response.json(), mint);
    if (!pair) return { provider: "dexscreener", observedAt: new Date().toISOString(), freshness: "unavailable" };
    return {
      provider: "dexscreener",
      observedAt: new Date().toISOString(),
      freshness: "fresh",
      priceUsd: numberOrNull(pair.priceUsd),
      marketCap: numberOrNull(pair.marketCap) || numberOrNull(pair.fdv),
      liquidityUsd: numberOrNull(pair?.liquidity?.usd)
    };
  } catch {
    return { provider: "dexscreener", observedAt: new Date().toISOString(), freshness: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

async function refreshCallPerformance(deps) {
  const { loadPerformanceCalls, recordCallMarketScan, onEvent = () => {}, quote = quoteToken } = deps;
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
      const result = await recordCallMarketScan(call.id, live);
      onEvent({
        type: result?.measured === false ? "PERFORMANCE_MISSING" : "PERFORMANCE_UPDATED",
        mint: call.mint, call: call.id, provider: live.provider,
        newMilestones: result?.newMilestones || 0
      });
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

module.exports = { bestSolanaPair, quoteToken, refreshCallPerformance, startPerformanceScanner };
