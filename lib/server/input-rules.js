// Pure input validators for the API routes.
//
// These live in .js, and not inside lib/server/guard.ts, for the same reason as
// lib/fee-model.js, lib/numeric-input.js and lib/withdrawal.js: the test runner is plain
// node with no build step, so it cannot require a .ts module. guard.ts re-exports
// everything here, so the 41 routes importing it are untouched and its public API is
// unchanged — the only difference is that these rules are now testable.
//
// They guard the trading path: which mints are addressable, how large a swap may be, and
// what slippage is allowed. They had no test coverage at all before this.

// Solana addresses are base58, 32-44 chars. Excludes 0, O, I and l by construction.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// u64 max — the largest token amount Solana can represent.
const U64_MAX = BigInt("18446744073709551615");
// Fat-finger guard for SOL-denominated inputs (buys): 100 SOL in lamports.
const MAX_SOL_LAMPORTS = BigInt(100) * BigInt(1000000000);
const ZERO = BigInt(0);

const DEFAULT_SLIPPAGE_BPS = 300;
const MAX_SLIPPAGE_BPS = 2000; // 20% — anything beyond is rejected as unintentional

const isMint = (s) => typeof s === "string" && BASE58.test(s);

function validAmount(raw, maxLamports) {
  const cap = maxLamports == null ? 100 * 1e9 : maxLamports;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > cap || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Validate a swap input amount in the input token's BASE UNITS, returned as an exact
 * decimal string (no float precision loss — token balances routinely exceed 2^53).
 * When `isSolInput` is true the amount is SOL lamports, so the 100-SOL fat-finger cap
 * applies; token sells are bounded only by u64 so a whale can fully exit a position.
 */
function validBaseUnits(raw, isSolInput) {
  let v;
  try {
    if (typeof raw === "string") {
      if (!/^\d+$/.test(raw.trim())) return null;
      v = BigInt(raw.trim());
    } else if (typeof raw === "number") {
      if (!Number.isInteger(raw) || raw <= 0) return null;
      v = BigInt(raw);
    } else return null;
  } catch { return null; }
  if (v <= ZERO || v > U64_MAX) return null;
  if (isSolInput && v > MAX_SOL_LAMPORTS) return null;
  return v.toString();
}

/**
 * Slippage in basis points.
 *
 * MUST return an integer. Jupiter parses this as an int and rejects the entire quote
 * otherwise — verified against the live endpoint, which answers
 * "Query parameter slippageBps cannot be parsed: ParseIntError" for 300.7. The app's own
 * callers already round before sending, so flooring here closes the gap for any other
 * caller rather than fixing a live break; a sanitiser that emits a value the downstream
 * API refuses is not sanitising. Floor rather than round so the cap cannot be exceeded.
 */
function validSlippageBps(raw) {
  const n = Number(raw == null ? DEFAULT_SLIPPAGE_BPS : raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SLIPPAGE_BPS;
  return Math.floor(Math.min(n, MAX_SLIPPAGE_BPS));
}

/** Strip the error class prefix and any stack, and bound the length. */
function sanitizeError(e) {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^.*Error:\s*/i, "").split("\n")[0].slice(0, 200);
}

module.exports = {
  BASE58,
  U64_MAX,
  MAX_SOL_LAMPORTS,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  isMint,
  validAmount,
  validBaseUnits,
  validSlippageBps,
  sanitizeError
};
