/**
 * Shared price feed (DexScreener, keyless). Returns USD price for a mint,
 * picking the deepest-liquidity pair.
 */

/**
 * Choose a USD price from a DexScreener pairs array.
 *
 * Extracted from getPrice so it can be tested: the runner is synchronous and refuses async
 * tests, which is why this decision had no coverage at all despite feeding baseline price
 * capture, PnL and every TP/SL trigger. Picking a price from a shallow pair would make every
 * downstream number wrong without erroring anywhere.
 *
 * Deepest liquidity wins. A missing, zero, negative or non-numeric price yields null rather
 * than a number, so callers fail closed instead of trading against a fabricated quote.
 */
function selectPrice(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  const pair = list
    .slice()
    .sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0))[0];
  const price = Number(pair?.priceUsd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function getPrice(mint) {
  const j = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) })
    .then((r) => r.json()).catch(() => null);
  return selectPrice(j?.pairs);
}

module.exports = { getPrice, selectPrice };
