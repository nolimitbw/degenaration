/**
 * Evaluates a bot's configured safety filters against fetched market and chain evidence.
 * Spec: docs/launch/FINAL_LAUNCH_SPEC.md §10, §11.2.
 *
 * Before this existed, rugcheck.js hardcoded MIN_LIQUIDITY_USD = 10_000 and ignored the
 * user's configuration entirely. A bot configured with a $500,000 liquidity floor was
 * executed against $10,000. The filters were persisted into the bot config and never
 * read, so the safety controls the interface promised were not the ones applied.
 *
 * Two rules govern everything here:
 *
 *   1. An enabled filter is enforced with the user's own bounds, not a default.
 *   2. An enabled filter whose evidence is unavailable BLOCKS the trade
 *      (unavailableDataBehavior: "fail-closed", §10). Silently skipping it would be
 *      the same defect in a new place.
 *
 * Pure and provider-agnostic so it can be tested without network access.
 */

// Filters this module can evaluate from DexScreener pair data plus an RPC mint lookup.
// Anything outside this set has no wired provider yet and fails closed when enabled.
const EVALUABLE_RANGES = new Set([
  "liquidityUsd",
  "marketCapUsd",
  "volumeUsd",
  "priceChangeBps",
  "tokenAgeMinutes"
]);

const EVALUABLE_FLAGS = new Set([
  "mintAuthorityRevoked",
  "freezeAuthorityRevoked",
  "latinNameSymbol",
  "dexPaid"
]);

const LATIN_SAFE = /^[\x20-\x7E]+$/;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} input
 * @param {object|null} input.pair        DexScreener best pair, or null
 * @param {object|null} input.mintInfo    RPC jsonParsed mint info, or null
 * @param {object|null} input.safety      bot config safetyFilters { ranges, flags, unavailableDataBehavior }
 * @param {number|null} input.nowMs       timestamp for age math; required for tokenAgeMinutes
 * @returns {{ok: boolean, reasons: string[], blockedUnevaluated: string[], evaluated: string[]}}
 */
function evaluateSafety(input) {
  const opts = input || {};
  const pair = opts.pair || null;
  const mintInfo = opts.mintInfo || null;
  const safety = opts.safety || {};
  const ranges = safety.ranges || {};
  const flags = safety.flags || {};
  const failClosed = (safety.unavailableDataBehavior || "fail-closed") === "fail-closed";

  const reasons = [];
  const blockedUnevaluated = [];
  const evaluated = [];

  // Evidence derived once, so a missing provider response is detectable per filter
  // rather than silently coerced to zero.
  const evidence = {
    liquidityUsd: pair ? num(pair.liquidity && pair.liquidity.usd) : null,
    marketCapUsd: pair ? (num(pair.marketCap) ?? num(pair.fdv)) : null,
    volumeUsd: pair ? num(pair.volume && pair.volume.h24) : null,
    priceChangeBps: pair && num(pair.priceChange && pair.priceChange.h24) !== null
      ? Math.round(num(pair.priceChange.h24) * 100)
      : null,
    tokenAgeMinutes: pair && num(pair.pairCreatedAt) !== null && num(opts.nowMs) !== null
      ? Math.floor((opts.nowMs - num(pair.pairCreatedAt)) / 60000)
      : null
  };

  for (const [key, config] of Object.entries(ranges)) {
    if (!config || !config.enabled) continue;

    if (!EVALUABLE_RANGES.has(key)) {
      // Enabled but no provider wired. Blocking is the honest outcome: the user asked
      // for this constraint and the platform cannot confirm it.
      if (failClosed) {
        blockedUnevaluated.push(key);
        reasons.push(`${key}: enabled but no evidence provider is wired (blocked)`);
      }
      continue;
    }

    const value = evidence[key];
    if (value === null) {
      if (failClosed) {
        blockedUnevaluated.push(key);
        reasons.push(`${key}: required evidence unavailable (blocked)`);
      }
      continue;
    }

    evaluated.push(key);
    const min = num(config.min);
    const max = num(config.max);
    if (min !== null && value < min) reasons.push(`${key} ${value} below configured minimum ${min}`);
    // `max: 0` means NO MAXIMUM here, not "a maximum of zero". That convention is what the
    // `max > 0` guard implements, and the suite pins it: a liquidity filter of
    // { min: 100000, max: 0 } is expected to pass. The builder ships positive defaults, and
    // clearing a max field resolves it to 0 — so treating 0 as a real ceiling would block
    // EVERY token for that bot.
    //
    // This was nearly "fixed" as a copy of the clamp() bug in lib/numeric-input.js, which
    // looked identical. It is not the same: there, no caller used 0 to mean unbounded and
    // the guard only hid a bug; here it IS the contract. The existing test is what caught
    // the mistake.
    //
    // The residual sharp edge, recorded rather than silently changed: a user who genuinely
    // wants "priceChangeBps at most 0" (nothing that has already pumped) cannot express it,
    // because 0 reads as unbounded. Fixing that needs a distinct sentinel — null for
    // unbounded, 0 for zero — across the builder, the stored config and this module, which
    // is a config migration, not a one-line change.
    if (max !== null && max > 0 && value > max) reasons.push(`${key} ${value} above configured maximum ${max}`);
  }

  for (const [key, enabled] of Object.entries(flags)) {
    if (!enabled) continue;

    if (!EVALUABLE_FLAGS.has(key)) {
      if (failClosed) {
        blockedUnevaluated.push(key);
        reasons.push(`${key}: enabled but no evidence provider is wired (blocked)`);
      }
      continue;
    }

    if (key === "mintAuthorityRevoked" || key === "freezeAuthorityRevoked") {
      if (!mintInfo) {
        blockedUnevaluated.push(key);
        reasons.push(`${key}: could not verify on-chain authority (blocked)`);
        continue;
      }
      evaluated.push(key);
      if (key === "mintAuthorityRevoked" && mintInfo.mintAuthority) {
        reasons.push("mint authority NOT revoked (can print more tokens)");
      }
      if (key === "freezeAuthorityRevoked" && mintInfo.freezeAuthority) {
        reasons.push("freeze authority NOT revoked (can freeze your tokens)");
      }
      continue;
    }

    if (key === "latinNameSymbol") {
      const base = pair && pair.baseToken;
      if (!base || (!base.symbol && !base.name)) {
        if (failClosed) {
          blockedUnevaluated.push(key);
          reasons.push("latinNameSymbol: token metadata unavailable (blocked)");
        }
        continue;
      }
      evaluated.push(key);
      const bad = [base.symbol, base.name].filter(Boolean).find((text) => !LATIN_SAFE.test(String(text)));
      if (bad) reasons.push(`token metadata contains non-Latin characters: ${String(bad).slice(0, 24)}`);
      continue;
    }

    if (key === "dexPaid") {
      // DexScreener only returns an enhanced `info` profile for paid listings, so its
      // presence is the signal. Named as a proxy in the reason so it is never mistaken
      // for a direct payment confirmation.
      if (!pair) {
        if (failClosed) {
          blockedUnevaluated.push(key);
          reasons.push("dexPaid: pair data unavailable (blocked)");
        }
        continue;
      }
      evaluated.push(key);
      const info = pair.info || {};
      const enhanced = Boolean(
        (info.socials && info.socials.length) || (info.websites && info.websites.length) || info.imageUrl
      );
      if (!enhanced) reasons.push("no paid DEX listing profile detected (enhanced info absent)");
      continue;
    }
  }

  return { ok: reasons.length === 0, reasons, blockedUnevaluated, evaluated };
}

module.exports = { evaluateSafety, EVALUABLE_RANGES, EVALUABLE_FLAGS };
