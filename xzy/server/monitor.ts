import { evaluateExit, gainPercent } from "../lib/trading/rules.ts";
import type { ExitRules } from "../lib/trading/rules.ts";

/**
 * Position monitor: one tick over every open position, selling whatever the exit rules
 * say to sell. Runs on a schedule; each tick must be safe to repeat, because a retried
 * or overlapping tick is normal operation rather than an error.
 */

export type OpenPosition = {
  id: string;
  userId: string;
  mint: string;
  symbol: string | null;
  entryPriceUsd: number | null;
  /** Fraction of the original position still held, in (0, 1]. */
  remainingFraction: number;
  tokensRemaining: string;
  rules: ExitRules;
  slippageBps: number;
  walletAddress: string;
  encryptedSecret: string;
};

export type MonitorDeps = {
  getOpenPositions(limit: number): Promise<OpenPosition[]>;
  getPriceUsd(mint: string): Promise<number | null>;
  sell(input: {
    position: OpenPosition;
    fractionOfOriginal: number;
  }): Promise<{ ok: true; signature: string; solOut: number } | { ok: false; error: string }>;
  recordExit(input: {
    positionId: string;
    kind: "take_profit" | "stop_loss";
    levelIndex: number | null;
    fractionOfOriginal: number;
    solOut: number;
    signature: string;
    priceUsd: number;
  }): Promise<unknown>;
  closePosition(positionId: string): Promise<unknown>;
  notify(userId: string, message: string): Promise<unknown>;
};

export type MonitorOutcome = {
  checked: number;
  exits: number;
  closed: number;
  errors: number;
};

/** A position is treated as fully exited below this much of the original. */
const DUST_FRACTION = 0.005;
const DEFAULT_POSITION_LIMIT = 200;

export async function monitorTick(deps: MonitorDeps, limit = DEFAULT_POSITION_LIMIT): Promise<MonitorOutcome> {
  const outcome: MonitorOutcome = { checked: 0, exits: 0, closed: 0, errors: 0 };

  let positions: OpenPosition[];
  try {
    positions = await deps.getOpenPositions(limit);
  } catch {
    // The scheduler calls this on a timer. Reporting a failed load as an outcome keeps
    // the endpoint answering rather than throwing a 500 every tick.
    return { ...outcome, errors: 1 };
  }

  // Price each distinct mint once per tick rather than once per position: many
  // subscribers hold the same call, and a per-position fetch would multiply the rate
  // limit by the size of the user base.
  const priceCache = new Map<string, number | null>();
  const priceFor = async (mint: string) => {
    if (!priceCache.has(mint)) priceCache.set(mint, await deps.getPriceUsd(mint));
    return priceCache.get(mint) ?? null;
  };

  for (const position of positions) {
    outcome.checked += 1;
    try {
      await tickPosition(position, deps, priceFor, outcome);
    } catch {
      // One position must never stop the rest of the book from being checked: a single
      // corrupt row would otherwise block every other user's stop-loss from firing.
      outcome.errors += 1;
    }
  }

  return outcome;
}

async function tickPosition(
  position: OpenPosition,
  deps: MonitorDeps,
  priceFor: (mint: string) => Promise<number | null>,
  outcome: MonitorOutcome
): Promise<void> {
  {
    if (position.entryPriceUsd === null || position.entryPriceUsd <= 0) return;

    const price = await priceFor(position.mint);
    // No price this tick means no decision this tick. Acting on missing data is how a
    // healthy position gets stopped out by a feed outage.
    if (price === null) return;

    const actions = evaluateExit({
      entryPriceUsd: position.entryPriceUsd,
      currentPriceUsd: price,
      remainingFraction: position.remainingFraction,
      rules: position.rules
    });
    if (actions.length === 0) return;

    const label = position.symbol ? `$${position.symbol}` : `${position.mint.slice(0, 4)}…${position.mint.slice(-4)}`;
    let remaining = position.remainingFraction;

    for (const action of actions) {
      const fraction = Math.min(action.sellFraction, remaining);
      if (fraction <= 0) break;

      const result = await deps.sell({ position, fractionOfOriginal: fraction });
      if (!result.ok) {
        outcome.errors += 1;
        await deps.notify(position.userId, `Could not exit ${label} — ${result.error}. Will retry.`);
        // Leave the level un-hit so the next tick tries again. A failed sell must not
        // consume the level, or a transient RPC error would silently cancel the exit.
        break;
      }

      await deps.recordExit({
        positionId: position.id,
        kind: action.kind,
        levelIndex: action.levelIndex,
        fractionOfOriginal: fraction,
        solOut: result.solOut,
        signature: result.signature,
        priceUsd: price
      });

      remaining -= fraction;
      outcome.exits += 1;

      const change = gainPercent(position.entryPriceUsd, price);
      const verb = action.kind === "stop_loss" ? "Stopped out of" : "Took profit on";
      await deps.notify(
        position.userId,
        `${verb} ${label} — sold ${(fraction * 100).toFixed(0)}% at ${change >= 0 ? "+" : ""}${change.toFixed(1)}% for ${result.solOut.toFixed(4)} SOL.`
      );
    }

    if (remaining <= DUST_FRACTION) {
      await deps.closePosition(position.id);
      outcome.closed += 1;
    }
  }
}
