/**
 * Exit rules: take-profit ladders and stop-loss.
 *
 * Pure decision logic — no clock, no network, no database. Given what a position cost
 * and what it is worth now, decide what to sell. Everything that can go wrong with a
 * take-profit ladder is a maths or ordering mistake, so it is isolated here where it can
 * be tested exhaustively rather than mixed into transaction plumbing.
 */

export type TakeProfitLevel = {
  /** Gain that arms this level, in percent above entry. 100 means "at 2x". */
  gainPct: number;
  /**
   * How much to sell when it fires, as a percentage of the ORIGINAL position — not of
   * what is left. Two levels of 50 sell the whole position, which is what someone
   * setting "50% at 2x, 50% at 3x" means.
   */
  sellPct: number;
  /** Set once the level has fired, so it never fires twice. */
  hit?: boolean;
};

export type ExitRules = {
  takeProfits: TakeProfitLevel[];
  /** Loss that triggers a full exit, in percent below entry. 30 means "sell at -30%". */
  stopLossPct: number | null;
};

export type ExitAction = {
  kind: "take_profit" | "stop_loss";
  /** Index into `takeProfits`, or null for a stop-loss. */
  levelIndex: number | null;
  /** Fraction of the ORIGINAL position to sell, in (0, 1]. */
  sellFraction: number;
  reason: string;
};

export type PositionSnapshot = {
  entryPriceUsd: number;
  currentPriceUsd: number;
  /** Fraction of the original position still held, in [0, 1]. */
  remainingFraction: number;
  rules: ExitRules;
};

export const MAX_TAKE_PROFIT_LEVELS = 5;

/** Percentage change from entry to current, e.g. 100 at 2x, -30 at a 30% loss. */
export function gainPercent(entryPriceUsd: number, currentPriceUsd: number): number {
  if (!(entryPriceUsd > 0)) return 0;
  return ((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 100;
}

/**
 * Decide what to sell right now.
 *
 * Returns an empty list when nothing should happen. Callers must treat the result as
 * the complete instruction for this tick.
 */
export function evaluateExit(snapshot: PositionSnapshot): ExitAction[] {
  const { entryPriceUsd, currentPriceUsd, remainingFraction, rules } = snapshot;

  // Bad or missing price data must never be read as a crash. A zero or negative price
  // is a broken feed, and panic-selling the position on it would be the actual loss.
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return [];
  if (!Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) return [];
  if (!Number.isFinite(remainingFraction) || remainingFraction <= 0) return [];

  const change = gainPercent(entryPriceUsd, currentPriceUsd);

  // Stop-loss is evaluated first and exits everything. If the price gapped straight
  // through a take-profit down to the stop, the position is underwater now — selling
  // into a level it is no longer at would be wrong.
  if (rules.stopLossPct !== null && Number.isFinite(rules.stopLossPct) && rules.stopLossPct > 0) {
    if (change <= -rules.stopLossPct) {
      return [
        {
          kind: "stop_loss",
          levelIndex: null,
          sellFraction: remainingFraction,
          reason: `stop loss at ${change.toFixed(1)}% (trigger -${rules.stopLossPct}%)`
        }
      ];
    }
  }

  const actions: ExitAction[] = [];
  let budget = remainingFraction;

  // Levels fire lowest-first so a gap up through several of them sells in the order the
  // user laid them out, and the ladder stays consistent with what a slower move produces.
  const ordered = rules.takeProfits
    .map((level, index) => ({ level, index }))
    .filter(({ level }) => !level.hit)
    .filter(({ level }) => Number.isFinite(level.gainPct) && Number.isFinite(level.sellPct) && level.sellPct > 0)
    .sort((a, b) => a.level.gainPct - b.level.gainPct);

  for (const { level, index } of ordered) {
    if (change < level.gainPct) break; // sorted, so nothing further can be armed
    if (budget <= 0) break;

    // A ladder whose percentages sum past 100 must not try to sell more than is held;
    // the last level takes whatever remains instead of failing the whole exit.
    const requested = level.sellPct / 100;
    const sellFraction = Math.min(requested, budget);
    if (sellFraction <= 0) continue;

    actions.push({
      kind: "take_profit",
      levelIndex: index,
      sellFraction,
      reason: `take profit ${level.sellPct}% at +${level.gainPct}% (now ${change.toFixed(1)}%)`
    });
    budget -= sellFraction;
  }

  return actions;
}

export type RulesValidation = { ok: true; rules: ExitRules } | { ok: false; error: string };

/**
 * Validate and normalise user-supplied exit rules before they are stored.
 *
 * Rejects ladders that cannot be honoured rather than silently clamping them — someone
 * who typed 60% + 60% meant something, and quietly selling 60% + 40% is not it.
 */
export function validateRules(input: {
  takeProfits?: { gainPct: number; sellPct: number }[];
  stopLossPct?: number | null;
}): RulesValidation {
  const takeProfits = input.takeProfits ?? [];

  if (takeProfits.length > MAX_TAKE_PROFIT_LEVELS) {
    return { ok: false, error: `At most ${MAX_TAKE_PROFIT_LEVELS} take-profit levels.` };
  }

  let totalSell = 0;
  for (const level of takeProfits) {
    if (!Number.isFinite(level.gainPct) || level.gainPct <= 0) {
      return { ok: false, error: "Each take-profit gain must be above 0%." };
    }
    if (!Number.isFinite(level.sellPct) || level.sellPct <= 0 || level.sellPct > 100) {
      return { ok: false, error: "Each take-profit must sell between 1% and 100%." };
    }
    totalSell += level.sellPct;
  }

  if (totalSell > 100) {
    return { ok: false, error: `Take-profit levels sell ${totalSell}% in total, which is more than the position.` };
  }

  const gains = takeProfits.map((level) => level.gainPct);
  if (new Set(gains).size !== gains.length) {
    return { ok: false, error: "Two take-profit levels cannot trigger at the same gain." };
  }

  const stopLossPct = input.stopLossPct ?? null;
  if (stopLossPct !== null) {
    if (!Number.isFinite(stopLossPct) || stopLossPct <= 0 || stopLossPct >= 100) {
      return { ok: false, error: "Stop loss must be between 1% and 99%." };
    }
  }

  return {
    ok: true,
    rules: {
      takeProfits: takeProfits
        .map((level) => ({ gainPct: level.gainPct, sellPct: level.sellPct, hit: false }))
        .sort((a, b) => a.gainPct - b.gainPct),
      stopLossPct
    }
  };
}
