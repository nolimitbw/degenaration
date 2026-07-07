/**
 * Tiny in-memory TTL cache with in-flight request coalescing for upstream JSON APIs.
 * Free data sources (GeckoTerminal, DexScreener) rate-limit hard; this collapses bursts
 * of identical requests into one upstream call and serves repeats from cache for `ttlMs`.
 * Single-instance only (fine for the free tier); swap for Redis if you scale horizontally.
 */
type Entry = { at: number; data: any };
const STORE = new Map<string, Entry>();
const INFLIGHT = new Map<string, Promise<any>>();
const MAX_ENTRIES = 500;

// Fetch `url` as JSON, caching the parsed body for `ttlMs`. Concurrent callers share one fetch.
export async function ttlFetch(url: string, ttlMs = 15_000, init?: RequestInit): Promise<any> {
  const now = Date.now();
  const hit = STORE.get(url);
  if (hit && now - hit.at < ttlMs) return hit.data;

  const pending = INFLIGHT.get(url);
  if (pending) return pending;

  const p = fetch(url, { cache: "no-store", ...init })
    .then((r) => {
      // A non-2xx (e.g. upstream rate-limit) can still have a parseable JSON body
      // shaped nothing like the real payload — never cache that as if it were data.
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      return r.json();
    })
    .then((data) => {
      STORE.set(url, { at: Date.now(), data });
      if (STORE.size > MAX_ENTRIES) {
        const oldest = STORE.keys().next().value;
        if (oldest !== undefined) STORE.delete(oldest);
      }
      return data;
    })
    .finally(() => INFLIGHT.delete(url));

  INFLIGHT.set(url, p);
  return p;
}

// Serve last-known-good on upstream failure so a blip does not blank the UI.
export async function ttlFetchSafe(url: string, ttlMs = 15_000, init?: RequestInit): Promise<any> {
  try {
    return await ttlFetch(url, ttlMs, init);
  } catch (e) {
    const stale = STORE.get(url);
    if (stale) return stale.data;
    throw e;
  }
}
