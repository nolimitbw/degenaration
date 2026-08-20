import { computeStats } from "../lib/trading/scoring.ts";
import type { MeasuredCall } from "../lib/trading/scoring.ts";

/**
 * The performance scanner.
 *
 * Walks recent calls, marks each one's current and peak price, then recomputes each
 * channel's rolling stats. This is what turns "not measured yet" into a real track
 * record — and it measures from OUR record of the price at call time, never from
 * anything a channel claims about itself.
 *
 * Side effects injected, as with the copy engine and monitor.
 */

export type ScannableCall = {
  id: string;
  channelId: string;
  mint: string;
  calledPriceUsd: number | null;
  peakPriceUsd: number | null;
};

export type ScannerDeps = {
  /** Calls recent enough to still be worth tracking. */
  getCallsToScan(limit: number): Promise<ScannableCall[]>;
  getPriceUsd(mint: string): Promise<number | null>;
  updateCallPrices(input: {
    callId: string;
    latestPriceUsd: number;
    peakPriceUsd: number;
  }): Promise<unknown>;
  /** Every measured call for a channel, for the stats recompute. */
  getChannelCalls(channelId: string): Promise<MeasuredCall[]>;
  updateChannelStats(channelId: string, stats: ReturnType<typeof computeStats>): Promise<unknown>;
};

export type ScannerOutcome = {
  scanned: number;
  priced: number;
  channelsUpdated: number;
  errors: number;
};

const DEFAULT_SCAN_LIMIT = 300;

export async function scannerTick(deps: ScannerDeps, limit = DEFAULT_SCAN_LIMIT): Promise<ScannerOutcome> {
  const outcome: ScannerOutcome = { scanned: 0, priced: 0, channelsUpdated: 0, errors: 0 };

  let calls: ScannableCall[];
  try {
    calls = await deps.getCallsToScan(limit);
  } catch {
    return { ...outcome, errors: 1 };
  }

  // One price lookup per distinct mint, however many channels called it.
  const prices = new Map<string, number | null>();
  const priceFor = async (mint: string) => {
    if (!prices.has(mint)) prices.set(mint, await deps.getPriceUsd(mint));
    return prices.get(mint) ?? null;
  };

  const touchedChannels = new Set<string>();

  for (const call of calls) {
    outcome.scanned += 1;
    try {
      const price = await priceFor(call.mint);
      // No price is not a zero. Leave the record untouched so a feed gap cannot be
      // written into a channel's track record as a loss.
      if (price === null) continue;

      const peak = Math.max(price, call.peakPriceUsd ?? 0);
      await deps.updateCallPrices({ callId: call.id, latestPriceUsd: price, peakPriceUsd: peak });
      outcome.priced += 1;
      touchedChannels.add(call.channelId);
    } catch {
      outcome.errors += 1;
    }
  }

  for (const channelId of touchedChannels) {
    try {
      const stats = computeStats(await deps.getChannelCalls(channelId));
      await deps.updateChannelStats(channelId, stats);
      outcome.channelsUpdated += 1;
    } catch {
      outcome.errors += 1;
    }
  }

  return outcome;
}
