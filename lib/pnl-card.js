/**
 * The financial decisions behind a PnL share card, as pure functions.
 *
 * WHY THIS FILE EXISTS
 *
 * All of this lived inline in app/api/product/pnl-card/route.tsx, inside an async handler
 * that needs a verified Privy session, two RPCs, a price provider and a JSX image renderer
 * before a single assertion can run. server/test/run.js is deliberately synchronous and
 * says so in as many words: extract the pure logic and test that. So none of it was tested —
 * not the winner/loser choice, not the percentage arithmetic, not the refusal conditions,
 * and not whether the QR code points at the same URL the card prints underneath it.
 *
 * A share card is a financial claim the user publishes under their own name. It must be
 * derived from the ledger and it must be arithmetically right, which makes it exactly the
 * kind of thing that should not be untested because it happened to be written inside a
 * route handler.
 *
 * Nothing here reads a request, a session or a provider. Everything is a value in, value
 * out, so the route keeps its authorization and IO and this keeps the arithmetic.
 */

/**
 * Types are declared in JSDoc rather than left to inference. TypeScript widens `ok: true`
 * to `ok: boolean` when it infers from a return statement, which collapses the refusal and
 * success shapes into one object of optionals — and then `if (!result.ok)` narrows nothing,
 * so every consumer has to non-null-assert its way through a financial result. Declaring
 * the literal types keeps the discriminated union intact at the call site.
 *
 * @typedef {{ok: false, status: number, error: string}} CardRefusal
 * @typedef {{
 *   ok: true, variant: "winner" | "loser", title: string,
 *   pnlLamports: bigint, pnlPercent: number,
 *   averageEntrySol: number | null, averageExitSol: number | null, context: string
 * }} ClosedTradeCard
 * @typedef {{
 *   ok: true, variant: "winner" | "loser", title: string,
 *   pnlLamports: bigint, pnlPercent: number
 * }} OpenPositionCard
 * @typedef {{
 *   ok: true, variant: "portfolio", title: string, pair: string,
 *   pnlLamports: bigint, pnlPercent: number, context: string
 * }} PortfolioCard
 * @typedef {bigint | number | string | null | undefined} LamportLike
 */

const LAMPORTS_PER_SOL = 1000000000n;
const CANONICAL_SITE_URL = "https://degenaration.vercel.app";

/** Parse to BigInt without throwing on null, "", or a malformed value.  *
 * @param {LamportLike} value
 * @param {bigint} [fallback]
 * @returns {bigint}
 */
function toLamports(value, fallback = 0n) {
  if (typeof value === "bigint") return value;
  try {
    if (value === null || value === undefined || value === "") return fallback;
    return BigInt(value);
  } catch {
    return fallback;
  }
}

/**
 * A percentage from two integer lamport amounts, via basis points.
 *
 * The multiplication happens BEFORE the division and in BigInt, so the ratio is never
 * computed in floating point. Only the final scaling to a display percentage touches
 * Number, by which point the value is a small integer count of basis points.
 *
 * A zero or negative denominator yields 0 rather than Infinity or NaN: a position with no
 * cost basis has no meaningful percentage, and printing "Infinity%" on a card the user
 * shares publicly would be worse than printing nothing.
  *
 * @param {LamportLike} numerator
 * @param {LamportLike} denominator
 * @returns {number}
 */
function percentFromLamports(numerator, denominator) {
  const num = toLamports(numerator);
  const den = toLamports(denominator);
  if (den <= 0n) return 0;
  return Number((num * 10000n) / den) / 100;
}

/** Lamports as a SOL string. Never throws; a malformed value reads as zero, not as a crash.  *
 * @param {LamportLike} lamports
 * @param {number} [digits]
 * @returns {string}
 */
function formatSol(lamports, digits = 3) {
  return `${(Number(toLamports(lamports)) / Number(LAMPORTS_PER_SOL)).toFixed(digits)} SOL`;
}

/**
 * Price per WHOLE TOKEN, in SOL, as a Number for display only.
 *
 * The tokenScale argument is not optional decoration — it is the whole point. Quantities are
 * stored in base units, so lamports/quantity gives SOL per base unit, which for a 9-decimal
 * token is a billionth of the price a human means. The open-position branch of the card
 * always applied 10^decimals; the closed-trade branch did not, so the same "AVERAGE ENTRY"
 * label printed 2.0000 SOL while a position was open and 2.0000e-9 SOL once it closed.
 * Same trade, same label, published publicly. That is the same defect shape as take-profit
 * firing at 2% instead of 2x: two readers of one quantity disagreeing about its unit.
 *
 * There is now one formula and both branches call it, which is what stops them drifting
 * again.
 *
 * Returns null rather than 0 when the quantity or the scale is unknown, so a caller cannot
 * print "0.00000 SOL" — or a mis-scaled number — for a price it does not actually have.
  *
 * @param {LamportLike} lamports
 * @param {LamportLike} quantityBaseUnits
 * @param {LamportLike} tokenScale
 * @returns {number | null}
 */
function perUnitSol(lamports, quantityBaseUnits, tokenScale) {
  const qty = toLamports(quantityBaseUnits);
  const scale = toLamports(tokenScale);
  if (qty <= 0n || scale <= 0n) return null;
  // lamports * scale / (qty * 1e9)  ==  (lamports/1e9) / (qty/scale)  ==  SOL per whole token
  return Number(toLamports(lamports) * scale) / Number(qty * LAMPORTS_PER_SOL);
}

/**
 * A decimal price string as a scaled integer.
 *
 * This is how a market price becomes money: everything downstream multiplies and divides
 * with it in BigInt, so a wrong parse here is a wrong valuation on a published card. It
 * refuses rather than coerces — anything that is not plain digits with at most one decimal
 * point returns null, including scientific notation, a negative, an empty string and
 * whatever a provider returns when it has no price. The caller treats null as "no fresh
 * market evidence" and declines to render, which is the correct fail-closed answer.
 *
 * Fractional digits beyond `scale` are truncated, never rounded up: a price must not be
 * inflated by parsing.
 *
 * @param {unknown} value
 * @param {number} [scale] fractional digits to keep
 * @returns {bigint | null}
 */
function decimalToScaled(value, scale = 18) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const scaled = `${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`.replace(/^0+(?=\d)/, "");
  try {
    return BigInt(scaled || "0");
  } catch {
    return null;
  }
}

/**
 * Elapsed-time label. `now` is injectable so the output is deterministic under test.
 * @param {string} start
 * @param {string | null | undefined} end
 * @param {number} [now]
 * @returns {string}
 */
function durationLabel(start, end, now = Date.now()) {
  const endMs = end ? new Date(end).getTime() : now;
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const minutes = Math.floor(Math.max(0, endMs - startMs) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Where the card's QR code points, and what it prints beneath it.
 *
 * These are returned together, from one input, because they must never disagree. A QR that
 * resolves somewhere other than the visible link is indistinguishable from a phishing card
 * once the image leaves the product, and the user cannot see the difference before posting
 * it. Deriving both from one value is what makes them impossible to drift apart.
  *
 * @param {string | null | undefined} referralCode
 * @param {string | null | undefined} [siteUrl]
 * @returns {{url: string, label: string}}
 */
function shareTarget(referralCode, siteUrl = CANONICAL_SITE_URL) {
  const base = String(siteUrl || CANONICAL_SITE_URL).replace(/\/+$/, "");
  const code = typeof referralCode === "string" ? referralCode.trim() : "";
  const url = code ? `${base}/r/${code}` : base;
  return { url, label: url.replace(/^https?:\/\//, "") };
}

/**
 * A completed trade, priced from app_private.position_exits.
 *
 * Average entry is released basis / quantity and average exit is proceeds / quantity — both
 * divisions of integers the ledger recorded. No price feed is consulted and nothing is
 * inferred, which is what makes a closed-trade card statable at all.
 *
 * Refuses rather than guesses when the record is incomplete, and distinguishes the two
 * reasons: an exit whose proceeds the worker never reported is a different problem from a
 * position that never had an exit, and telling the user which one it is decides whether
 * they should wait or whether there is nothing to wait for.
  *
 * @param {any} aggregate
 * @param {LamportLike} tokenScale
 * @returns {CardRefusal | ClosedTradeCard}
 */
function closedTradeCard(aggregate, tokenScale) {
  if (!aggregate || aggregate.fullyMeasured !== true) {
    return {
      ok: false,
      status: 409,
      error: aggregate && aggregate.unpricedExits
        ? "This position closed with an exit whose proceeds were not recorded, so its exit price cannot be stated."
        : "This position has no recorded exit, so a closed-trade card cannot be generated."
    };
  }

  const exitedQuantity = toLamports(aggregate.exitedQuantityBaseUnits);
  const proceeds = toLamports(aggregate.proceedsLamports);
  const basis = toLamports(aggregate.releasedBasisLamports);
  const realized = toLamports(aggregate.realizedPnlLamports);
  const measuredExits = Number(aggregate.measuredExits || 0);
  const positive = realized >= 0n;

  return {
    ok: true,
    variant: positive ? "winner" : "loser",
    title: positive ? "Trade closed in profit" : "Trade closed at a loss",
    pnlLamports: realized,
    pnlPercent: percentFromLamports(realized, basis),
    averageEntrySol: perUnitSol(basis, exitedQuantity, tokenScale),
    averageExitSol: perUnitSol(proceeds, exitedQuantity, tokenScale),
    context: `closed in ${measuredExits} exit${measuredExits === 1 ? "" : "s"} · realized, net of recorded fees`
  };
}

/**
 * An open position, priced from live market evidence.
 *
 * Net PnL is current value plus already-realized proceeds, less cost and less recorded
 * fees. Fees are subtracted rather than ignored: a card that reports gross PnL as though it
 * were the user's result overstates every position by the platform fee, and the spec
 * requires the figure to be net.
  *
 * @param {{currentValueLamports: LamportLike, realizedPnlLamports: LamportLike,
 *          costLamports: LamportLike, feesLamports: LamportLike}} input
 * @returns {OpenPositionCard}
 */
function openPositionCard({ currentValueLamports, realizedPnlLamports, costLamports, feesLamports }) {
  const value = toLamports(currentValueLamports);
  const realized = toLamports(realizedPnlLamports);
  const cost = toLamports(costLamports);
  const fees = toLamports(feesLamports);
  const pnl = value + realized - cost - fees;
  const positive = pnl >= 0n;

  return {
    ok: true,
    variant: positive ? "winner" : "loser",
    title: positive ? "Position in profit" : "Position drawdown",
    pnlLamports: pnl,
    pnlPercent: percentFromLamports(pnl, cost)
  };
}

/**
 * Portfolio performance over a period.
 *
 * Refuses when there is no reconciled snapshot. That refusal is the whole point: the
 * alternative is a card reading 0.00% that a viewer cannot distinguish from a real,
 * measured, break-even result.
  *
 * @param {any} performance
 * @param {string} period
 * @returns {CardRefusal | PortfolioCard}
 */
function portfolioCard(performance, period) {
  if (!performance) {
    return {
      ok: false,
      status: 409,
      error: "A reconciled portfolio snapshot is required before a share card can be generated."
    };
  }
  const pnl = toLamports(performance.netPnlLamports);
  const capital = toLamports(
    (performance.metrics && performance.metrics.averageCapitalLamports) || performance.volumeLamports
  );
  const sampleSize = Number(performance.sampleSize || 0);

  return {
    ok: true,
    variant: "portfolio",
    title: "Portfolio performance",
    pair: String(period || "").toUpperCase(),
    pnlLamports: pnl,
    pnlPercent: percentFromLamports(pnl, capital),
    context: `${sampleSize} completed executions · net of recorded fees`
  };
}

/** The card's accent colour. Portfolio is always gold; a trade is signed.  *
 * @param {string} variant
 * @param {LamportLike} pnlLamports
 * @returns {string}
 */
function accentFor(variant, pnlLamports) {
  if (variant === "portfolio") return "#c29463";
  return toLamports(pnlLamports) >= 0n ? "#55b987" : "#d56f6f";
}

/**
 * The one thing a caller may NOT influence.
 *
 * Every field a card prints is derived above from ledger values. This lists the only query
 * parameters the route reads, so a test can assert that no financial quantity is among them
 * — a client that could pass its own percentage could publish any claim it liked under the
 * product's branding.
 */
const CLIENT_SUPPLIED_PARAMS = Object.freeze(["type", "period", "id"]);

module.exports = {
  LAMPORTS_PER_SOL,
  CANONICAL_SITE_URL,
  CLIENT_SUPPLIED_PARAMS,
  toLamports,
  percentFromLamports,
  formatSol,
  perUnitSol,
  decimalToScaled,
  durationLabel,
  shareTarget,
  closedTradeCard,
  openPositionCard,
  portfolioCard,
  accentFor
};
