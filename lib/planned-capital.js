// How much capital a bot plans to commit — one formula, in integer lamports.
//
// THE DEFECT THIS CLOSES
//
// The builder showed two capital figures on the same screen and they disagreed, because each
// was computed inline at its point of use and only one of them counted DCA:
//
//   Minimum planned capital  (buyAmountSol + dcaCapital) * maxOpenTrades   -- WITH DCA
//   Maximum exposure         min(maximumCapitalSol, buyAmountSol * maxOpenTrades)  -- WITHOUT
//
// With the shipped defaults — 0.05 entry, two enabled 0.25 DCA levels, 10 open trades — the
// screen read "Maximum exposure 0.50 SOL" directly above "Minimum planned capital 5.50 SOL".
// One of those says the bot can never deploy more than half a SOL; the other says it cannot
// start without five and a half. Both were rendered as fact, neither was labelled, and a user
// sizing a wallet from the smaller one would have had entries refused for a reason no screen
// explained.
//
// WHY A MODULE
//
// The two expressions were three hundred lines apart in a .tsx file, which is why they drifted
// and why nothing could test them: `server/test/run.js` is plain synchronous node with no build
// step, so it cannot import a component. Everything below is pure and integer-only, so the
// regression tests drive the same code the builder renders.
//
// INTEGER MONEY
//
// Every amount here is a BigInt of lamports. `0.05 + 0.25 + 0.25` in IEEE-754 doubles is
// 0.5500000000000001, and multiplying that by 10 gives 5.500000000000001 — which `toFixed(3)`
// happened to hide. Rounding each SOL input to lamports ONCE at the boundary and summing
// integers thereafter means the displayed total is the total the claim will measure against,
// exactly. `solToLamports` rounds rather than floors for the reason recorded in
// server/engine/jupiter.js: flooring buys less than the user configured.
//
// WHAT IS DELIBERATELY NOT IN HERE
//
// Take profit and stop loss. They describe how a position is CLOSED and commit no capital to
// open it, so including them would inflate the requirement and refuse bots that are fine.
// The network, priority-fee and rent reserve is also excluded from planned trading capital and
// reported separately by `reserveLamports` — it is not capital the strategy deploys, and
// merging the two is how a "minimum capital" figure stops meaning anything.

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * SOL to integer lamports, at the boundary and only here.
 *
 * Rounds, matching lib/product-api.solToLamports and server/engine/jupiter.solToLamports. A
 * non-finite or non-positive amount is 0n rather than NaN, so one bad field cannot poison the
 * whole total into something that renders as "NaN SOL".
 */
function toLamports(sol) {
  const amount = Number(sol);
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  return BigInt(Math.round(amount * 1e9));
}

/** Lamports back to a SOL number, for display only. Never fed back into arithmetic. */
function toSol(lamports) {
  return Number(lamports) / 1e9;
}

/**
 * The rent-exempt minimum plus fee headroom the wallet must retain.
 *
 * The same constant `lib/withdrawal.js` reserves, for the same reason: a wallet drained to zero
 * cannot pay for the transaction that would trade out of a position. Reported beside planned
 * capital, never added into it.
 */
const RESERVE_LAMPORTS = 15_890_880n;

/**
 * The DCA allocations that will actually be placed for ONE position.
 *
 * Two gates, both of which must be honoured or the figure lies:
 *   - the master switch. Off means no staged entries at all, whatever the levels say.
 *   - each level's own switch. `BotBuilder.buildConfig()` persists an off level as ABSENT, so
 *     a disabled level must not be counted here either, or the editor's total and the saved
 *     total disagree the moment the bot is reloaded.
 */
function enabledDcaLamports(dca) {
  if (!dca || dca.enabled === false) return 0n;
  const levels = Array.isArray(dca.levels) ? dca.levels : [];
  return levels
    .filter((level) => level && level.enabled !== false)
    .reduce((total, level) => total + toLamports(level.buyAmountSol), 0n);
}

/**
 * The whole capital picture for one configuration.
 *
 *   perPositionLamports = entry + every enabled DCA allocation for that position
 *   plannedLamports     = perPositionLamports * maximumOpenTrades
 *
 * `maximumOpenTrades` is floored at 1: a bot that may hold no positions is not a bot, and a
 * zero would report a planned requirement of nothing, which is the most misleading answer
 * available.
 */
function plannedCapital({ buyAmountSol, maxOpenTrades, dca, perTokenExposureSol } = {}) {
  const entryLamports = toLamports(buyAmountSol);
  const dcaLamports = enabledDcaLamports(dca);
  const perPositionLamports = entryLamports + dcaLamports;

  const trades = Number(maxOpenTrades);
  const positions = Number.isFinite(trades) && trades >= 1 ? Math.floor(trades) : 1;
  const plannedLamports = perPositionLamports * BigInt(positions);

  const dcaLevels = !dca || dca.enabled === false
    ? []
    : (Array.isArray(dca.levels) ? dca.levels : []).filter((level) => level && level.enabled !== false);

  return {
    entryLamports,
    dcaLamports,
    dcaLevelCount: dcaLevels.length,
    perPositionLamports,
    positions,
    plannedLamports,
    // Kept apart from planned capital on purpose — see the header.
    reserveLamports: RESERVE_LAMPORTS,
    totalWithReserveLamports: plannedLamports + RESERVE_LAMPORTS,
    entrySol: toSol(entryLamports),
    dcaSol: toSol(dcaLamports),
    perPositionSol: toSol(perPositionLamports),
    plannedSol: toSol(plannedLamports),
    reserveSol: toSol(RESERVE_LAMPORTS),
    perTokenExposureLamports: toLamports(perTokenExposureSol)
  };
}

/**
 * The per-token exposure limit measured against what one position actually plans to commit.
 *
 * A limit below the per-position requirement is not a conservative setting, it is a bot that
 * cannot complete a single position: the entry is claimed, then the first DCA leg that would
 * cross the limit is refused with `per-token exposure limit reached`, leaving the position
 * half-built. The shipped defaults produced exactly this — 0.50 SOL per token against a 0.55
 * SOL position — so it is a real state a user could reach without doing anything unusual.
 *
 * Returns null when the pair is fine, or a message naming both numbers. Callers must treat a
 * message as a blocking validation error rather than a warning.
 */
function perTokenExposureError(plan, { enabled = true } = {}) {
  if (!enabled) return null;
  if (plan.perTokenExposureLamports <= 0n) return null;
  if (plan.perTokenExposureLamports >= plan.perPositionLamports) return null;
  return (
    `Per-token exposure of ${format(plan.perTokenExposureLamports)} SOL is below the ` +
    `${format(plan.perPositionLamports)} SOL one position plans to commit ` +
    `(${format(plan.entryLamports)} entry + ${format(plan.dcaLamports)} DCA). ` +
    `Raise it to at least ${format(plan.perPositionLamports)} SOL, or reduce the entry or DCA amounts.`
  );
}

/**
 * Lamports as a SOL string, trailing zeros trimmed.
 *
 * `toFixed(3)` was what hid the float error: 5.500000000000001 renders as "5.500". Formatting
 * from the integer means the string cannot disagree with the number the engine enforces.
 */
function format(lamports) {
  const negative = lamports < 0n;
  const value = negative ? -lamports : lamports;
  const whole = value / LAMPORTS_PER_SOL;
  const fraction = (value % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * The calculation, spelled out, as the builder shows it.
 *
 * A total with no working is the thing that made the previous two figures unfalsifiable: a user
 * who thought 5.50 was wrong had nothing to check it against.
 */
function explain(plan) {
  const lines = [`${format(plan.entryLamports)} entry`];
  if (plan.dcaLamports > 0n) {
    lines.push(`+ ${format(plan.dcaLamports)} enabled DCA (${plan.dcaLevelCount} ${plan.dcaLevelCount === 1 ? "level" : "levels"})`);
  }
  lines.push(`= ${format(plan.perPositionLamports)} SOL per position`);
  lines.push(`${format(plan.perPositionLamports)} × ${plan.positions} ${plan.positions === 1 ? "position" : "positions"}`);
  lines.push(`= ${format(plan.plannedLamports)} SOL minimum capital`);
  return lines;
}

module.exports = {
  LAMPORTS_PER_SOL,
  RESERVE_LAMPORTS,
  toLamports,
  toSol,
  enabledDcaLamports,
  plannedCapital,
  perTokenExposureError,
  format,
  explain
};
