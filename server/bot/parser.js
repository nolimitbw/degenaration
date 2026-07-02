/**
 * Call parser — extracts a Solana token mint from a Discord call message.
 * SECURITY: message content is UNTRUSTED input. We only ever extract
 * base58 addresses; we never eval or act on any other text.
 */
const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Links we recognize (pump.fun, dexscreener, birdeye, jup.ag)
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
