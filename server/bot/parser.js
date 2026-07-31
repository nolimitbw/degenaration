/**
 * Call parser — extracts a Solana token mint from a Discord call message.
 * SECURITY: message content is UNTRUSTED input. We only ever extract
 * base58 addresses; we never eval or act on any other text.
 */
const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Links we recognize (pump.fun, dexscreener, birdeye, jup.ag)
//
// KNOWN GAP — dexscreener.com/solana/<addr>. That path segment is the PAIR (pool) address
// in DexScreener's canonical URL form, not the token mint. The engine then queries
// api.dexscreener.com/latest/dex/tokens/<addr>, which is a TOKEN endpoint, so a pair
// address returns nothing. Measured against the live API:
//
//   /dex/tokens/<BONK mint>          -> 30 pairs
//   /dex/tokens/<one of those pairs> -> 0 pairs
//
// With no pair, rugCheck fails closed and the call is skipped. It fails SAFE - no wrong
// token is ever bought - but the call silently never executes, and call channels post
// DexScreener links constantly, so a source could have most of its calls dropped with no
// visible reason. DexScreener also serves token addresses on the same path, so some of
// these links do work, which makes the failure look intermittent rather than systematic.
//
// The fix is a fallback in the engine, not here: when /dex/tokens/<addr> yields nothing,
// query /latest/dex/pairs/solana/<addr> and take the token side of the pool. That needs a
// deliberate choice of baseToken vs quoteToken - a SOL-quoted pool has the token as base,
// but not every pool is SOL-quoted - and it adds a network call to the execution path. Not
// guessed at here. See OPEN_BLOCKERS B-2.
const LINK_MINT = /(?:pump\.fun\/(?:coin\/)?|dexscreener\.com\/solana\/|birdeye\.so\/token\/|jup\.ag\/swap\/[A-Za-z0-9]+-)([1-9A-HJ-NP-Za-km-z]{32,44})/;

function parseCall(text) {
  if (!text || text.length > 2000) return null;

  // 1) Prefer explicit links — highest confidence
  const link = text.match(LINK_MINT);
  if (link) return { mint: link[1], confidence: "high" };

  // 2) Raw base58 address in message
  const addrs = text.match(BASE58) || [];
  // Filter obvious non-mints (wallet flexes etc.) — engine re-validates on-chain anyway
  if (addrs.length === 1) return { mint: addrs[0], confidence: "medium" };

  return null; // ticker-only calls ($WIF) are ignored in v1 — too ambiguous, too easy to spoof
}

module.exports = { parseCall };
