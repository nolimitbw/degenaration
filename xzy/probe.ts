/**
 * Reachability and sanity check for the swap path.
 *
 * Run before going live, and after any change to JUPITER_API_URL:
 *   node --experimental-strip-types probe.ts
 *
 * It quotes a real route and derives an entry price the way the copy engine does. A
 * failure here means live trading will not work, regardless of what the tests say —
 * the tests cover our logic, this covers the integration.
 */
import { getQuote, getPriceUsd, WSOL_MINT, LAMPORTS } from "./lib/trading/jupiter.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const quote = await getQuote({
  inputMint: WSOL_MINT,
  outputMint: BONK,
  amount: BigInt(0.1 * LAMPORTS),
  slippageBps: 300
});

if (!quote) {
  console.error("FAIL: no quote returned. Check JUPITER_API_URL and network egress.");
  process.exit(1);
}
console.log(`OK quote: 0.1 SOL -> ${quote.outAmount} BONK (impact ${quote.priceImpactPct}%)`);

const solPrice = await getPriceUsd(WSOL_MINT);
if (!solPrice) {
  console.error("FAIL: no SOL price. Entry marks would be null and exits could not evaluate.");
  process.exit(1);
}
console.log(`OK SOL price: $${solPrice}`);
console.log(`OK derived entry: $${((0.1 * solPrice) / Number(quote.outAmount)).toExponential(4)} per BONK`);
export {};
