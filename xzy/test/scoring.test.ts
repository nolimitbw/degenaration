import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, peakMultiple, WIN_THRESHOLD_X } from "../lib/trading/scoring.ts";
import { scannerTick } from "../server/scanner.ts";
import type { ScannerDeps, ScannableCall } from "../server/scanner.ts";

test("peak multiple is peak over called price", () => {
  assert.equal(peakMultiple({ calledPriceUsd: 1, peakPriceUsd: 3 }), 3);
  assert.equal(peakMultiple({ calledPriceUsd: 2, peakPriceUsd: 1 }), 0.5);
});

test("an unmeasurable call yields null, never zero", () => {
  assert.equal(peakMultiple({ calledPriceUsd: null, peakPriceUsd: 3 }), null);
  assert.equal(peakMultiple({ calledPriceUsd: 1, peakPriceUsd: null }), null);
  assert.equal(peakMultiple({ calledPriceUsd: 0, peakPriceUsd: 3 }), null);
});

test("a channel with nothing measurable reports null, not a 0% record", () => {
  const stats = computeStats([{ calledPriceUsd: null, peakPriceUsd: null }]);
  assert.deepEqual(stats, {
    callsMeasured: 0,
    wins: 0,
    winRatePct: null,
    avgPeakX: null,
    medianPeakX: null,
    bestPeakX: null
  });
});

test("unmeasured calls are excluded from the average, not counted as losses", () => {
  const stats = computeStats([
    { calledPriceUsd: 1, peakPriceUsd: 2 },
    { calledPriceUsd: null, peakPriceUsd: null },
    { calledPriceUsd: 1, peakPriceUsd: 4 }
  ]);
  assert.equal(stats.callsMeasured, 2, "only the two priced calls count");
  assert.equal(stats.avgPeakX, 3);
});

test("wins are calls that reached the threshold", () => {
  const stats = computeStats([
    { calledPriceUsd: 1, peakPriceUsd: 2 },
    { calledPriceUsd: 1, peakPriceUsd: 1.1 },
    { calledPriceUsd: 1, peakPriceUsd: 0.3 },
    { calledPriceUsd: 1, peakPriceUsd: WIN_THRESHOLD_X }
  ]);
  assert.equal(stats.wins, 2);
  assert.equal(stats.winRatePct, 50);
});

test("median is reported alongside the average so one moonshot cannot carry a channel", () => {
  const stats = computeStats([
    { calledPriceUsd: 1, peakPriceUsd: 0.5 },
    { calledPriceUsd: 1, peakPriceUsd: 0.6 },
    { calledPriceUsd: 1, peakPriceUsd: 400 }
  ]);
  assert.ok(stats.avgPeakX! > 100, "the average is dragged up by the outlier");
  assert.equal(stats.medianPeakX, 0.6, "the median shows what a subscriber actually saw");
  assert.equal(stats.bestPeakX, 400);
});

function scannerHarness(options: { calls?: ScannableCall[]; price?: number | null } = {}) {
  const updates: { callId: string; peak: number }[] = [];
  const stats: string[] = [];
  const calls = options.calls ?? [
    { id: "c1", channelId: "ch1", mint: "mint-a", calledPriceUsd: 1, peakPriceUsd: 2 }
  ];

  const deps: ScannerDeps = {
    async getCallsToScan() {
      return calls;
    },
    async getPriceUsd() {
      return options.price === undefined ? 3 : options.price;
    },
    async updateCallPrices(input) {
      updates.push({ callId: input.callId, peak: input.peakPriceUsd });
    },
    async getChannelCalls() {
      return [{ calledPriceUsd: 1, peakPriceUsd: 3 }];
    },
    async updateChannelStats(channelId) {
      stats.push(channelId);
    }
  };

  return { deps, updates, stats };
}

test("the scanner raises the peak when price makes a new high", async () => {
  const h = scannerHarness({ price: 5 });
  const outcome = await scannerTick(h.deps);

  assert.equal(outcome.priced, 1);
  assert.equal(h.updates[0]?.peak, 5);
  assert.deepEqual(h.stats, ["ch1"]);
});

test("the scanner never lowers a recorded peak", async () => {
  // The peak is the high-water mark. A later, lower price must not erase it.
  const h = scannerHarness({ price: 1.5 });
  await scannerTick(h.deps);
  assert.equal(h.updates[0]?.peak, 2, "the existing peak of 2 stands");
});

test("a missing price leaves the record untouched", async () => {
  const h = scannerHarness({ price: null });
  const outcome = await scannerTick(h.deps);

  assert.equal(outcome.scanned, 1);
  assert.equal(outcome.priced, 0);
  assert.equal(h.updates.length, 0, "a feed gap must not be written in as a loss");
  assert.equal(h.stats.length, 0);
});

test("each mint is priced once no matter how many channels called it", async () => {
  let lookups = 0;
  const h = scannerHarness({
    calls: [
      { id: "c1", channelId: "ch1", mint: "same", calledPriceUsd: 1, peakPriceUsd: 1 },
      { id: "c2", channelId: "ch2", mint: "same", calledPriceUsd: 1, peakPriceUsd: 1 }
    ]
  });
  const deps: ScannerDeps = {
    ...h.deps,
    async getPriceUsd() {
      lookups += 1;
      return 2;
    }
  };

  const outcome = await scannerTick(deps);
  assert.equal(lookups, 1);
  assert.equal(outcome.channelsUpdated, 2);
});

test("a failure loading the journal is reported, not thrown", async () => {
  const h = scannerHarness();
  const outcome = await scannerTick({
    ...h.deps,
    async getCallsToScan() {
      throw new Error("db down");
    }
  });
  assert.deepEqual(outcome, { scanned: 0, priced: 0, channelsUpdated: 0, errors: 1 });
});
