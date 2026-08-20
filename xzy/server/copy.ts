import { evaluateSpend, spendDay } from "../lib/trading/caps.ts";
import type { SpendLimits } from "../lib/trading/caps.ts";
import type { ExitRules } from "../lib/trading/rules.ts";

/**
 * Copy engine: turn one recorded call into a buy for every subscriber whose limits allow
 * it. Side effects are injected, so the fan-out — who gets copied, who is skipped, and
 * why — is testable without a chain, a wallet, or a database.
 */

export type Subscriber = {
  subscriptionId: string;
  userId: string;
  walletAddress: string;
  encryptedSecret: string;
  limits: SpendLimits;
  rules: ExitRules;
  slippageBps: number;
  paused: boolean;
};

export type CopyDeps = {
  getSubscribers(channelId: string): Promise<Subscriber[]>;
  getSpentToday(userId: string, day: string): Promise<number>;
  getWalletBalance(address: string): Promise<number | null>;
  /** Buys `amountSol` of `mint`, returning what was actually filled. */
  buy(input: {
    subscriber: Subscriber;
    mint: string;
    amountSol: number;
  }): Promise<{ ok: true; signature: string; tokensOut: string; entryPriceUsd: number | null } | { ok: false; error: string }>;
  openPosition(input: {
    subscriptionId: string;
    userId: string;
    callId: string;
    mint: string;
    amountSol: number;
    tokensOut: string;
    entryPriceUsd: number | null;
    signature: string;
    rules: ExitRules;
  }): Promise<{ id: string } | null>;
  recordSpend(input: { userId: string; day: string; amountSol: number }): Promise<unknown>;
  notify(userId: string, message: string): Promise<unknown>;
  /** True when a position for this (subscription, call) already exists. */
  alreadyCopied(subscriptionId: string, callId: string): Promise<boolean>;
  now(): Date;
};

export type CopyOutcome = {
  attempted: number;
  filled: number;
  skipped: { subscriptionId: string; reason: string }[];
};

export async function copyCall(
  call: { id: string; channelId: string; mint: string; symbol?: string | null },
  deps: CopyDeps
): Promise<CopyOutcome> {
  const outcome: CopyOutcome = { attempted: 0, filled: 0, skipped: [] };
  const subscribers = await deps.getSubscribers(call.channelId);
  const day = spendDay(deps.now());
  const label = call.symbol ? `$${call.symbol}` : `${call.mint.slice(0, 4)}…${call.mint.slice(-4)}`;

  for (const subscriber of subscribers) {
    if (subscriber.paused) {
      outcome.skipped.push({ subscriptionId: subscriber.subscriptionId, reason: "paused" });
      continue;
    }

    // The same call can reach us twice — a Telegram redelivery, an edited post, or a
    // retried worker tick. Buying twice off one call is real money lost, so this is
    // checked per subscriber rather than trusted from upstream dedup alone.
    if (await deps.alreadyCopied(subscriber.subscriptionId, call.id)) {
      outcome.skipped.push({ subscriptionId: subscriber.subscriptionId, reason: "already copied" });
      continue;
    }

    const [spentToday, balance] = await Promise.all([
      deps.getSpentToday(subscriber.userId, day),
      deps.getWalletBalance(subscriber.walletAddress)
    ]);

    const decision = evaluateSpend({
      limits: subscriber.limits,
      spentTodaySol: spentToday,
      walletBalanceSol: balance ?? 0
    });

    if (!decision.allowed) {
      outcome.skipped.push({ subscriptionId: subscriber.subscriptionId, reason: decision.reason });
      await deps.notify(subscriber.userId, `Skipped ${label} — ${decision.reason}`);
      continue;
    }

    outcome.attempted += 1;

    // Spend is recorded before the buy, not after. If the process dies mid-trade we
    // would rather have over-counted today's spend (costing one skipped copy) than
    // under-counted it and blown through the daily cap on restart.
    await deps.recordSpend({ userId: subscriber.userId, day, amountSol: decision.amountSol });

    const result = await deps.buy({ subscriber, mint: call.mint, amountSol: decision.amountSol });

    if (!result.ok) {
      outcome.skipped.push({ subscriptionId: subscriber.subscriptionId, reason: result.error });
      // The trade never happened, so give the budget back.
      await deps.recordSpend({ userId: subscriber.userId, day, amountSol: -decision.amountSol });
      await deps.notify(subscriber.userId, `Could not buy ${label} — ${result.error}`);
      continue;
    }

    await deps.openPosition({
      subscriptionId: subscriber.subscriptionId,
      userId: subscriber.userId,
      callId: call.id,
      mint: call.mint,
      amountSol: decision.amountSol,
      tokensOut: result.tokensOut,
      entryPriceUsd: result.entryPriceUsd,
      signature: result.signature,
      rules: subscriber.rules
    });

    outcome.filled += 1;
    await deps.notify(
      subscriber.userId,
      `Bought ${label} for ${decision.amountSol} SOL. Take-profit and stop-loss are now active.`
    );
  }

  return outcome;
}
