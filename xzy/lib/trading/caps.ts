/**
 * Spend limits.
 *
 * Two questions, both answered before any money moves: is this single trade within the
 * per-trade size, and does it fit inside what is left of today's budget? Pure logic, so
 * the arithmetic that stands between a user and an emptied wallet is testable directly.
 */

export type SpendLimits = {
  /** SOL committed to a single copied call. */
  perTradeSol: number;
  /** Ceiling on total SOL spent across all copies in one UTC day. */
  maxDailySol: number;
};

export type SpendDecision =
  | { allowed: true; amountSol: number }
  | { allowed: false; reason: string; shortfallSol?: number };

export const MIN_TRADE_SOL = 0.001;
/**
 * A hard ceiling no configuration may exceed. Not a judgement about how much anyone
 * should trade — a backstop so a mistyped figure cannot become a 1000 SOL order.
 */
export const MAX_TRADE_SOL = 100;
export const MAX_DAILY_SOL = 1000;

/** The UTC day a timestamp falls in, as YYYY-MM-DD. Daily caps reset at UTC midnight. */
export function spendDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Decide whether a copy trade may proceed.
 *
 * `spentTodaySol` is what has already been committed in the same UTC day. A trade that
 * would cross the daily cap is refused outright rather than part-filled: a half-size
 * position has a different risk profile than the one the user configured, and silently
 * substituting one for the other is not a decision to make on their behalf.
 */
export function evaluateSpend(input: {
  limits: SpendLimits;
  spentTodaySol: number;
  walletBalanceSol: number;
  /** Kept back for transaction fees and rent so a wallet cannot be spent to zero. */
  feeReserveSol?: number;
}): SpendDecision {
  const { limits, spentTodaySol, walletBalanceSol } = input;
  const feeReserve = input.feeReserveSol ?? 0.01;

  if (!Number.isFinite(limits.perTradeSol) || limits.perTradeSol < MIN_TRADE_SOL) {
    return { allowed: false, reason: `Per-trade size must be at least ${MIN_TRADE_SOL} SOL.` };
  }
  if (limits.perTradeSol > MAX_TRADE_SOL) {
    return { allowed: false, reason: `Per-trade size above the ${MAX_TRADE_SOL} SOL ceiling.` };
  }
  if (!Number.isFinite(limits.maxDailySol) || limits.maxDailySol <= 0) {
    return { allowed: false, reason: "Daily limit must be above 0 SOL." };
  }
  if (limits.maxDailySol > MAX_DAILY_SOL) {
    return { allowed: false, reason: `Daily limit above the ${MAX_DAILY_SOL} SOL ceiling.` };
  }

  const amountSol = limits.perTradeSol;
  const spent = Number.isFinite(spentTodaySol) && spentTodaySol > 0 ? spentTodaySol : 0;
  const remainingToday = limits.maxDailySol - spent;

  if (remainingToday <= 0) {
    return { allowed: false, reason: `Daily limit of ${limits.maxDailySol} SOL already reached.` };
  }
  if (amountSol > remainingToday) {
    return {
      allowed: false,
      reason: `Only ${remainingToday.toFixed(3)} SOL left of today's ${limits.maxDailySol} SOL limit.`,
      shortfallSol: amountSol - remainingToday
    };
  }

  const spendable = walletBalanceSol - feeReserve;
  if (!Number.isFinite(walletBalanceSol) || spendable < amountSol) {
    return {
      allowed: false,
      reason: `Not enough SOL. Need ${(amountSol + feeReserve).toFixed(3)} including fees.`,
      shortfallSol: amountSol - Math.max(spendable, 0)
    };
  }

  return { allowed: true, amountSol };
}

export type LimitsValidation = { ok: true; limits: SpendLimits } | { ok: false; error: string };

/** Validate user-entered limits at the edge, before they are ever stored. */
export function validateLimits(input: { perTradeSol?: unknown; maxDailySol?: unknown }): LimitsValidation {
  const perTradeSol = Number(input.perTradeSol);
  const maxDailySol = Number(input.maxDailySol);

  if (!Number.isFinite(perTradeSol) || perTradeSol < MIN_TRADE_SOL) {
    return { ok: false, error: `Per-trade size must be at least ${MIN_TRADE_SOL} SOL.` };
  }
  if (perTradeSol > MAX_TRADE_SOL) {
    return { ok: false, error: `Per-trade size cannot exceed ${MAX_TRADE_SOL} SOL.` };
  }
  if (!Number.isFinite(maxDailySol) || maxDailySol <= 0) {
    return { ok: false, error: "Daily limit must be above 0 SOL." };
  }
  if (maxDailySol > MAX_DAILY_SOL) {
    return { ok: false, error: `Daily limit cannot exceed ${MAX_DAILY_SOL} SOL.` };
  }
  // A daily cap below one trade means the very first copy is refused, which reads as a
  // broken bot rather than as a limit working.
  if (maxDailySol < perTradeSol) {
    return { ok: false, error: "Daily limit cannot be smaller than the per-trade size." };
  }

  return { ok: true, limits: { perTradeSol, maxDailySol } };
}
