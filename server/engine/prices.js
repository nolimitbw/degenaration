/**
 * Shared price feed (DexScreener, keyless). Returns USD price for a mint,
 * picking the deepest-liquidity pair.
 */
async function getPrice(mint) {
  const j = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store" })
    .then((r) => r.json()).catch(() => null);
  const pair = (j?.pairs ?? []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  return pair ? Number(pair.priceUsd) || null : null;
}

module.exports = { getPrice };
