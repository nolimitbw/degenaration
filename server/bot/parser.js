/**
 * Call parser — extracts Solana token mints from a Discord call message.
 *
 * Product rule (owner, explicit): ANY Solana coin address posted in a registered
 * channel is a call. A message that names three mints is three calls. We do not
 * second-guess, score, or filter the caller's intent here — the journal records
 * everything and the site decides what to do with it.
 *
 * SECURITY: message content is UNTRUSTED input. We only ever extract base58
 * addresses; we never eval or act on any other text.
 */
const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Links we recognize (pump.fun, dexscreener, birdeye, jup.ag)
const LINK_MINT = /(?:pump\.fun\/(?:coin\/)?|dexscreener\.com\/solana\/|birdeye\.so\/token\/|jup\.ag\/swap\/[A-Za-z0-9]+-)([1-9A-HJ-NP-Za-km-z]{32,44})/g;

// One Discord message can only produce so many calls. Bounds a paste-bomb without
// dropping a normal multi-token call.
const MAX_CALLS_PER_MESSAGE = 5;
const MAX_MESSAGE_LENGTH = 2000;

/**
 * parseCalls(text) -> [{ mint, confidence }]
 * Link-wrapped mints rank "high"; bare base58 addresses rank "medium". Order is
 * links first, then bare addresses in the order they appear. Duplicates collapse
 * to the highest confidence seen for that mint.
 */
function parseCalls(text) {
  if (!text || typeof text !== "string" || text.length > MAX_MESSAGE_LENGTH) return [];

  const found = new Map(); // mint -> confidence

  for (const match of text.matchAll(LINK_MINT)) {
    found.set(match[1], "high");
  }
  for (const mint of text.match(BASE58) || []) {
    if (!found.has(mint)) found.set(mint, "medium");
  }

  return [...found.entries()]
    .slice(0, MAX_CALLS_PER_MESSAGE)
    .map(([mint, confidence]) => ({ mint, confidence }));
}

/** Back-compat single-call helper: the first (highest-confidence) mint, or null. */
function parseCall(text) {
  return parseCalls(text)[0] || null;
}

module.exports = { parseCall, parseCalls, MAX_CALLS_PER_MESSAGE };
