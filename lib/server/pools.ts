import { ttlFetchSafe } from "./cache";

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

/** Return the deepest-liquidity GeckoTerminal pool address for a mint, or null. Cached 60s. */
export async function deepestPool(mint: string): Promise<string | null> {
  const pools = await ttlFetchSafe(`${GT}/tokens/${mint}/pools?page=1`, 60_000);
  const list: any[] = pools?.data ?? [];
  if (!list.length) return null;
  let best = list[0];
  let bestLiq = Number(best?.attributes?.reserve_in_usd ?? 0);
  for (const p of list) {
    const liq = Number(p?.attributes?.reserve_in_usd ?? 0);
    if (liq > bestLiq) { best = p; bestLiq = liq; }
  }
  return best?.attributes?.address ?? null;
}
