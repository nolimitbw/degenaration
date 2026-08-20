import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSpend, validateLimits, spendDay, MAX_TRADE_SOL } from "../lib/trading/caps.ts";

const limits = { perTradeSol: 0.5, maxDailySol: 2 };

test("allows a trade inside both limits", () => {
  const decision = evaluateSpend({ limits, spentTodaySol: 0, walletBalanceSol: 1 });
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.equal(decision.amountSol, 0.5);
});

test("refuses once the daily limit is exhausted", () => {
  const decision = evaluateSpend({ limits, spentTodaySol: 2, walletBalanceSol: 10 });
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.match(decision.reason, /already reached/);
});

test("refuses rather than part-filling a trade that would cross the daily cap", () => {
  // 1.8 spent of 2.0 leaves 0.2, less than the 0.5 per-trade size. A half-size position
  // carries different risk than the one configured, so it is refused outright.
  const decision = evaluateSpend({ limits, spentTodaySol: 1.8, walletBalanceSol: 10 });
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.match(decision.reason, /left of today/);
});

test("keeps a fee reserve so the wallet is never spent to zero", () => {
  // Balance exactly equals the trade size: without a reserve there is nothing left for fees.
  const decision = evaluateSpend({ limits, spentTodaySol: 0, walletBalanceSol: 0.5 });
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.match(decision.reason, /Not enough SOL/);

  assert.equal(evaluateSpend({ limits, spentTodaySol: 0, walletBalanceSol: 0.51 }).allowed, true);
});

test("treats a missing balance as zero rather than as unlimited", () => {
  assert.equal(evaluateSpend({ limits, spentTodaySol: 0, walletBalanceSol: Number.NaN }).allowed, false);
});

test("refuses configurations beyond the hard ceilings", () => {
  assert.equal(evaluateSpend({ limits: { perTradeSol: 500, maxDailySol: 900 }, spentTodaySol: 0, walletBalanceSol: 10_000 }).allowed, false);
  assert.equal(evaluateSpend({ limits: { perTradeSol: 0.0001, maxDailySol: 1 }, spentTodaySol: 0, walletBalanceSol: 10 }).allowed, false);
});

test("daily spend buckets by UTC day", () => {
  assert.equal(spendDay(new Date("2026-03-05T23:59:59Z")), "2026-03-05");
  assert.equal(spendDay(new Date("2026-03-06T00:00:01Z")), "2026-03-06");
});

test("validateLimits rejects a daily cap below one trade", () => {
  // Otherwise the very first copy is refused, which reads as a broken bot.
  const result = validateLimits({ perTradeSol: 1, maxDailySol: 0.5 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /smaller than the per-trade/);
});

test("validateLimits rejects junk input", () => {
  assert.equal(validateLimits({ perTradeSol: "abc", maxDailySol: 5 }).ok, false);
  assert.equal(validateLimits({ perTradeSol: -1, maxDailySol: 5 }).ok, false);
  assert.equal(validateLimits({ perTradeSol: 0.5, maxDailySol: 0 }).ok, false);
  assert.equal(validateLimits({ perTradeSol: MAX_TRADE_SOL + 1, maxDailySol: 500 }).ok, false);
});

test("validateLimits accepts a normal configuration", () => {
  const result = validateLimits({ perTradeSol: "0.25", maxDailySol: "5" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.limits, { perTradeSol: 0.25, maxDailySol: 5 });
});
