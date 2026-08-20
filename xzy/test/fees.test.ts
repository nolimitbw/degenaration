import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFee, platformFeeBps, MAX_PLATFORM_FEE_BPS, DEFAULT_PLATFORM_FEE_BPS } from "../lib/trading/fees.ts";

test("a 1% fee on 1 SOL splits 70/30 between platform and channel", () => {
  const split = splitFee({ amountSol: 1, feeBps: 100, channelShareBps: 3000, hasChannel: true });

  assert.equal(split.totalFeeSol, 0.01);
  assert.equal(split.channelSol, 0.003);
  assert.equal(split.platformSol, 0.007);
  assert.equal(split.netSol, 0.99);
});

test("the split always reconstructs the total exactly", () => {
  // Awkward numbers are where independent rounding invents or destroys dust.
  for (const amount of [0.001, 0.037, 1 / 3, 7.77, 99.999]) {
    for (const shareBps of [1, 2500, 3333, 9999]) {
      const split = splitFee({ amountSol: amount, feeBps: 137, channelShareBps: shareBps, hasChannel: true });
      assert.ok(
        Math.abs(split.channelSol + split.platformSol - split.totalFeeSol) < 1e-12,
        `split did not balance for ${amount} at ${shareBps}bps`
      );
      assert.ok(Math.abs(split.netSol + split.totalFeeSol - amount) < 1e-12, "net plus fee must equal the trade");
    }
  }
});

test("a manual trade pays no channel share", () => {
  const split = splitFee({ amountSol: 1, feeBps: 100, channelShareBps: 3000, hasChannel: false });

  assert.equal(split.channelSol, 0);
  assert.equal(split.platformSol, 0.01, "the whole fee stays with the platform, not paid to nobody");
});

test("the fee is capped no matter what is configured", () => {
  const split = splitFee({ amountSol: 1, feeBps: 9_000, hasChannel: false });
  assert.equal(split.totalFeeSol, MAX_PLATFORM_FEE_BPS / 10_000, "clamped to the 5% ceiling");
});

test("nonsense input produces no fee rather than a NaN", () => {
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const split = splitFee({ amountSol: amount, feeBps: 100, hasChannel: true });
    assert.equal(split.totalFeeSol, 0);
    assert.equal(split.netSol, 0);
  }
  assert.equal(splitFee({ amountSol: 1, feeBps: -50, hasChannel: true }).totalFeeSol, 0);
});

test("the configured fee is read from the environment and clamped", () => {
  delete process.env.PLATFORM_FEE_BPS;
  assert.equal(platformFeeBps(), DEFAULT_PLATFORM_FEE_BPS);

  process.env.PLATFORM_FEE_BPS = "250";
  assert.equal(platformFeeBps(), 250);

  process.env.PLATFORM_FEE_BPS = "9999";
  assert.equal(platformFeeBps(), MAX_PLATFORM_FEE_BPS);

  process.env.PLATFORM_FEE_BPS = "not a number";
  assert.equal(platformFeeBps(), 0, "unparseable config takes nothing rather than guessing");

  delete process.env.PLATFORM_FEE_BPS;
});
