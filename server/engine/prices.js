/**
 * Shared price feed (DexScreener, keyless). Returns USD price for a mint,
 * picking the deepest-liquidity pair.
 *
 * WHY THIS CACHES: the exit monitor prices every open position on every 5s tick, and both
 * performance scanners price calls on their own schedules. Uncached, that is 12 requests
 * per minute per open position against one keyless endpoint, all of it duplicated between
 * the monitor and the scanners. Once DexScreener rate-limits, the response stops parsing,
 * this returns null, and the monitor reads that as PRICE_MISSING and SKIPS the position —
 * so stop-losses quietly stop firing exactly when the desk is busiest.
 *
 * Two guarantees make that safe:
 *   - A price is reused for at most TTL_MS, well under the 5s exit tick, so an exit is
 *     never decided on a materially staler number than before.
 *   - A failure is NEVER cached. Caching null would extend a momentary outage into a
 *     TTL-long blind spot, which is the opposite of what a stop-loss needs.
 */
const TTL_MS = 3_000;
const MAX_ENTRIES = 500;

const cache = new Map();    // mint -> { price, at }
const inflight = new Map(); // mint -> Promise<price>

/** Drop what is already past its TTL, oldest first, so a long-running worker cannot grow without bound. */
function prune(now) {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [mint, entry] of cache) {
    if (now - entry.at >= TTL_MS) cache.delete(mint);
    if (cache.size <= MAX_ENTRIES) return;
  }
  // Still oversized (every entry fresh): evict in insertion order, which is oldest first.
  for (const mint of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) return;
    cache.delete(mint);
  }
}

async function fetchPrice(mint) {
  const j = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) })
    .then((r) => r.json()).catch(() => null);
  const pair = (j?.pairs ?? []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  const price = Number(pair?.priceUsd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * opts is for tests only; production calls this as getPrice(mint).
 *   ttlMs  how long a good price may be reused
 *   now    clock
 *   fetchPrice  the network call
 */
async function getPrice(mint, opts = {}) {
  if (!mint) return null;
  const { ttlMs = TTL_MS, now = Date.now, fetchPrice: fetchOne = fetchPrice } = opts;

  const hit = cache.get(mint);
  if (hit && now() - hit.at < ttlMs) return hit.price;

  // Single-flight: the monitor and both scanners asking for the same mint at the same
  // moment must produce one request, not three.
  const pending = inflight.get(mint);
  if (pending) return pending;

  const promise = (async () => {
    const price = await fetchOne(mint);
    if (price !== null && price !== undefined) {
      const at = now();
      cache.set(mint, { price, at });
      prune(at);
    }
    return price;
  })().finally(() => inflight.delete(mint));

  inflight.set(mint, promise);
  return promise;
}

module.exports = { getPrice, TTL_MS };
