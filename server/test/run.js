// Minimal zero-dependency test runner for the Degenaration server logic.
const assert = require("assert");
const { parseCall } = require("../bot/parser");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + " — " + e.message); }
}

console.log("parser");
test("extracts mint from pump.fun link", () => {
  const r = parseCall("APE pump.fun/coin/6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP now");
  assert.strictEqual(r.mint, "6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP");
  assert.strictEqual(r.confidence, "high");
});
test("extracts mint from dexscreener link", () => {
  const r = parseCall("chart: dexscreener.com/solana/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
  assert.strictEqual(r.confidence, "high");
});
test("extracts a lone base58 address (medium)", () => {
  const r = parseCall("new one 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU dyor");
  assert.strictEqual(r.confidence, "medium");
});
test("ignores ticker-only calls", () => {
  assert.strictEqual(parseCall("$WIF is pumping"), null);
});
test("ignores plain chatter", () => {
  assert.strictEqual(parseCall("gm frens wagmi"), null);
});
test("ignores empty / oversized input", () => {
  assert.strictEqual(parseCall(""), null);
  assert.strictEqual(parseCall("x".repeat(3000)), null);
});
test("does not misfire on two addresses (ambiguous)", () => {
  const two = "a 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU b 6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP";
  assert.strictEqual(parseCall(two), null);
});

console.log("fee model (integer lamport arithmetic, spec 13 / 22.1)");
const feeModel = require("../../lib/fee-model");
const SOL = BigInt(1000000000);
const HUNDRED_SOL = SOL * BigInt(100);
const lam = (n) => BigInt(n);

test("200 bps on a confirmed buy leg", () => {
  assert.strictEqual(feeModel.bpsOf(HUNDRED_SOL, 200), SOL * BigInt(2));
});
test("200 bps on the later sell leg (round trip charges each leg)", () => {
  const buy = feeModel.bpsOf(HUNDRED_SOL, 200);
  const sell = feeModel.bpsOf(HUNDRED_SOL, 200);
  assert.strictEqual(buy + sell, SOL * BigInt(4));
});
test("Discord creator takes 70 bps FROM the 200 bps fee, retained is 130 bps", () => {
  const a = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, sourceKind: "discord" });
  assert.strictEqual(a.platformFeeLamports, SOL * BigInt(2));
  assert.strictEqual(a.creatorLamports, feeModel.bpsOf(HUNDRED_SOL, 70));
  assert.strictEqual(a.retainedLamports, feeModel.bpsOf(HUNDRED_SOL, 130));
  assert.ok(feeModel.isBalancedAllocation(a));
});
test("KOL creator takes 20 bps FROM the fee, retained is 180 bps", () => {
  const a = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, sourceKind: "kol" });
  assert.strictEqual(a.creatorLamports, feeModel.bpsOf(HUNDRED_SOL, 20));
  assert.strictEqual(a.retainedLamports, feeModel.bpsOf(HUNDRED_SOL, 180));
  assert.ok(feeModel.isBalancedAllocation(a));
});
test("user is never charged 2.00% + creator share", () => {
  const discord = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, sourceKind: "discord" });
  const none = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL });
  assert.strictEqual(discord.platformFeeLamports, none.platformFeeLamports);
});
test("referral pays 10% of the COLLECTED FEE, not of volume", () => {
  const a = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, referralEligible: true });
  assert.strictEqual(a.referralLamports, feeModel.bpsOf(a.platformFeeLamports, 1000));
  assert.strictEqual(a.referralLamports, SOL / BigInt(5)); // 0.2 SOL = 10% of 2 SOL
});
test("no referral means no referral allocation", () => {
  const a = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL });
  assert.strictEqual(a.referralLamports, BigInt(0));
});
test("creator + referral combined still balances to the collected fee", () => {
  const a = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, sourceKind: "discord", referralEligible: true });
  assert.strictEqual(a.creatorLamports + a.referralLamports + a.retainedLamports, a.platformFeeLamports);
  assert.ok(feeModel.isBalancedAllocation(a));
});
test("referral is funded from retained revenue, never from the creator share", () => {
  const withRef = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, sourceKind: "discord", referralEligible: true });
  const noRef = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, sourceKind: "discord" });
  assert.strictEqual(withRef.creatorLamports, noRef.creatorLamports);
  assert.ok(withRef.retainedLamports < noRef.retainedLamports);
});
test("rounds down at the smallest unit and still balances", () => {
  assert.strictEqual(feeModel.bpsOf(lam(1), 200), BigInt(0));
  assert.strictEqual(feeModel.bpsOf(lam(50), 200), BigInt(1));
  const a = feeModel.allocatePlatformFee({ notionalLamports: lam(12345), sourceKind: "discord", referralEligible: true });
  assert.ok(feeModel.isBalancedAllocation(a));
});
test("zero collected fee allocates nothing to anyone", () => {
  const a = feeModel.allocatePlatformFee({ notionalLamports: HUNDRED_SOL, sourceKind: "discord", referralEligible: true, feeBps: 0 });
  assert.strictEqual(a.platformFeeLamports, BigInt(0));
  assert.strictEqual(a.creatorLamports, BigInt(0));
  assert.strictEqual(a.referralLamports, BigInt(0));
});
test("rejects floating-point and negative lamport input instead of rounding it", () => {
  assert.throws(() => feeModel.toLamports(1.5));
  assert.throws(() => feeModel.toLamports(-1));
  assert.throws(() => feeModel.toLamports(NaN));
});
test("fee is off until PLATFORM_FEE_ACCOUNT is configured", () => {
  assert.strictEqual(feeModel.configuredPlatformFeeBps({}), 0);
  assert.strictEqual(feeModel.configuredPlatformFeeBps({ PLATFORM_FEE_ACCOUNT: "F".repeat(44) }), 200);
});
test("fee label renders as 2.00%", () => {
  assert.strictEqual(feeModel.formatBpsPercent(200), "2.00%");
});

// The database trigger app_private.validate_execution_fees() recomputes every fee and
// rejects the row if it disagrees. These vectors pin lib/fee-model.js to the SQL formulas
// in supabase/degenaration-fee-allocation-integrity.sql so a write built in JS can never be
// rejected by the trigger.
//
// HOW MUCH THIS PROVES, precisely. `sqlFloorBps` below is a JS RESTATEMENT of the SQL
// expression, not the SQL itself — these tests run with no database, so they cannot be
// anything else. On its own that only shows lib/fee-model.js agrees with a transcription,
// and it would keep passing if the deployed SQL ever diverged from it.
//
// The gap is closed by LIVE_SQL_VECTORS below: values executed against the deployed
// database on 2026-07-31 and pasted back as literals. Those are real observations, so a
// divergence between the JS model and production shows up here rather than in a ledger.
// Re-capture them with:
//
//   select notional,
//          floor(notional::numeric * 200 / 10000)::bigint,
//          floor(notional::numeric *  70 / 10000)::bigint,
//          floor(notional::numeric *  20 / 10000)::bigint,
//          floor(floor(notional::numeric * 200 / 10000)::numeric * 1000 / 10000)::bigint
//
console.log("fee model parity with the database trigger");

// floor(gross::numeric * bps / 10000)::bigint — a transcription, see the note above.
const sqlFloorBps = (amount, bps) => (BigInt(amount) * BigInt(bps)) / BigInt(10000);

// [notional, platform@200, creator@70, creator@20, referral@1000-of-fee]
// Captured from the LIVE database, not computed here.
const LIVE_SQL_VECTORS = [
  [1, 0, 0, 0, 0], [3, 0, 0, 0, 0], [7, 0, 0, 0, 0], [33, 0, 0, 0, 0],
  [99, 1, 0, 0, 0], [100, 2, 0, 0, 0], [333, 6, 2, 0, 0], [999, 19, 6, 1, 1],
  [1000, 20, 7, 2, 2], [3333, 66, 23, 6, 6], [4999, 99, 34, 9, 9],
  [5000, 100, 35, 10, 10], [9999, 199, 69, 19, 19], [10000, 200, 70, 20, 20],
  [33333, 666, 233, 66, 66], [333333, 6666, 2333, 666, 666],
  [3333333, 66666, 23333, 6666, 6666], [33333333, 666666, 233333, 66666, 66666],
  [123456789, 2469135, 864197, 246913, 246913],
  [333333333, 6666666, 2333333, 666666, 666666],
  [1000000000, 20000000, 7000000, 2000000, 2000000],
  [1500000007, 30000000, 10500000, 3000000, 3000000],
  [7777777777, 155555555, 54444444, 15555555, 15555555],
  [999999999999, 19999999999, 6999999999, 1999999999, 1999999999]
];

test("fee model matches values captured from the LIVE database", () => {
  for (const [notional, platform, creatorDiscord, creatorKol, referral] of LIVE_SQL_VECTORS) {
    const n = BigInt(notional);
    const d = feeModel.allocatePlatformFee({ notionalLamports: n, sourceKind: "discord", referralEligible: true });
    const k = feeModel.allocatePlatformFee({ notionalLamports: n, sourceKind: "kol", referralEligible: true });
    assert.strictEqual(d.platformFeeLamports, BigInt(platform), `platform fee at notional ${notional}`);
    assert.strictEqual(d.creatorLamports, BigInt(creatorDiscord), `discord creator at notional ${notional}`);
    assert.strictEqual(k.creatorLamports, BigInt(creatorKol), `kol creator at notional ${notional}`);
    assert.strictEqual(d.referralLamports, BigInt(referral), `referral at notional ${notional}`);
    assert.ok(feeModel.isBalancedAllocation(d), `discord allocation balances at ${notional}`);
    assert.ok(feeModel.isBalancedAllocation(k), `kol allocation balances at ${notional}`);
  }
});

test("platform fee matches the SQL expected_platform formula", () => {
  for (const notional of [HUNDRED_SOL, SOL, lam(123456789), lam(12345), lam(50), lam(1)]) {
    const a = feeModel.allocatePlatformFee({ notionalLamports: notional });
    assert.strictEqual(a.platformFeeLamports, sqlFloorBps(notional, 200));
  }
});
test("creator fee matches the SQL expected_creator formula (from notional, not from fee)", () => {
  for (const notional of [HUNDRED_SOL, SOL, lam(123456789), lam(12345)]) {
    const discord = feeModel.allocatePlatformFee({ notionalLamports: notional, sourceKind: "discord" });
    assert.strictEqual(discord.creatorLamports, sqlFloorBps(notional, 70));
    const kol = feeModel.allocatePlatformFee({ notionalLamports: notional, sourceKind: "kol" });
    assert.strictEqual(kol.creatorLamports, sqlFloorBps(notional, 20));
  }
});
test("referral matches the SQL expected_referral formula (from collected fee)", () => {
  for (const notional of [HUNDRED_SOL, SOL, lam(123456789), lam(12345)]) {
    const a = feeModel.allocatePlatformFee({ notionalLamports: notional, referralEligible: true });
    assert.strictEqual(a.referralLamports, sqlFloorBps(a.platformFeeLamports, 1000));
  }
});
test("canonical rates never trigger the creator clamp, so JS always satisfies the trigger", () => {
  // The trigger demands creator === floor(notional*bps/10000) exactly AND
  // creator <= platform_fee. Clamping would break the first condition, so assert the
  // canonical rates keep us clear of it.
  assert.ok(feeModel.DISCORD_CREATOR_BPS <= feeModel.PLATFORM_FEE_BPS);
  assert.ok(feeModel.KOL_CREATOR_BPS <= feeModel.PLATFORM_FEE_BPS);
  for (const notional of [HUNDRED_SOL, SOL, lam(123456789), lam(12345), lam(50), lam(1)]) {
    const a = feeModel.allocatePlatformFee({ notionalLamports: notional, sourceKind: "discord", referralEligible: true });
    assert.strictEqual(a.creatorLamports, sqlFloorBps(notional, 70));
    assert.ok(a.creatorLamports + a.referralLamports <= a.platformFeeLamports);
  }
});
test("retained equals the generated-column expression", () => {
  // retained_fee_lamports is GENERATED ALWAYS AS
  //   (platform_fee_lamports - creator_fee_lamports - referral_fee_lamports)
  const a = feeModel.allocatePlatformFee({ notionalLamports: lam(123456789), sourceKind: "discord", referralEligible: true });
  assert.strictEqual(
    a.retainedLamports,
    a.platformFeeLamports - a.creatorLamports - a.referralLamports
  );
  assert.ok(a.retainedLamports >= BigInt(0));
});
const jupiterPath = require.resolve("../engine/jupiter");
test("worker fee rate never drifts from the canonical fee model", () => {
  // The worker deploys with rootDir: server, so it cannot import lib/fee-model.js and
  // mirrors the rate instead. This guard fails the build if the two ever disagree.
  delete require.cache[jupiterPath];
  const worker = require("../engine/jupiter");
  assert.strictEqual(worker.PLATFORM_FEE_BPS, feeModel.PLATFORM_FEE_BPS);
  delete require.cache[jupiterPath];
});
test("worker fee uses exact integer lamport arithmetic", () => {
  const previous = process.env.PLATFORM_FEE_ACCOUNT;
  process.env.PLATFORM_FEE_ACCOUNT = "F".repeat(44);
  delete require.cache[jupiterPath];
  const jup = require("../engine/jupiter");
  // The fee account is verified by a network probe in production; tests declare the
  // resolved state so the ledger math stays deterministic and offline.
  jup.__setFeeAccountUsable(true);
  const { platformFeeLamports } = jup;
  assert.strictEqual(platformFeeLamports(HUNDRED_SOL), feeModel.bpsOf(HUNDRED_SOL, 200));
  assert.strictEqual(platformFeeLamports(lam(1)), BigInt(0));

  // Jupiter collects the ExactIn platform fee in the OUTPUT mint, so the fee may only be
  // requested when the configured account holds that mint. Verified against the live quote
  // endpoint: SOL -> BONK with platformFeeBps=200 reports platformFee.amount in BONK units.
  //
  // Without this gate the worker hands Jupiter a wSOL account on a BUY, the transaction
  // builds because Jupiter does not validate feeAccount, and it then fails ON CHAIN.
  const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  jup.__setFeeAccountUsable(true, jup.SOL_MINT);
  assert.strictEqual(jup.feeAppliesToOutput(jup.SOL_MINT), true,  "sell into wSOL collects the fee");
  assert.strictEqual(jup.feeAppliesToOutput(BONK), false, "buy paying out BONK must NOT request the fee");
  jup.__setFeeAccountUsable(false);
  assert.strictEqual(jup.feeAppliesToOutput(jup.SOL_MINT), false, "no usable account, no fee");
  jup.__setFeeAccountUsable(true, jup.SOL_MINT);
  if (previous) process.env.PLATFORM_FEE_ACCOUNT = previous;
  else delete process.env.PLATFORM_FEE_ACCOUNT;
  delete require.cache[jupiterPath];
});
test("worker records zero commission when no fee account is configured", () => {
  const previous = process.env.PLATFORM_FEE_ACCOUNT;
  delete process.env.PLATFORM_FEE_ACCOUNT;
  delete require.cache[jupiterPath];
  const { platformFeeSol } = require("../engine/jupiter");
  assert.strictEqual(platformFeeSol(1.2), 0);
  if (previous) process.env.PLATFORM_FEE_ACCOUNT = previous;
  delete require.cache[jupiterPath];
});
test("worker records the configured commission when a fee account is present", () => {
  const previous = process.env.PLATFORM_FEE_ACCOUNT;
  process.env.PLATFORM_FEE_ACCOUNT = "F".repeat(44);
  delete require.cache[jupiterPath];
  const jupSol = require("../engine/jupiter");
  jupSol.__setFeeAccountUsable(true);
  assert.ok(Math.abs(jupSol.platformFeeSol(1.2) - 0.024) < 1e-9);
  if (previous) process.env.PLATFORM_FEE_ACCOUNT = previous;
  else delete process.env.PLATFORM_FEE_ACCOUNT;
  delete require.cache[jupiterPath];
});

// Fixture-driven verification of the outcome and aggregation layer (§22.3). This does
// NOT prove the live pipeline journals anything — that needs database access, see
// OPEN_BLOCKERS B-4. It proves the maths a journaled call feeds into is correct, and
// that an unmeasured source is reported honestly rather than filled in.
console.log("performance journal outcomes (spec 9.5 / 9.6 / 22.3)");
const outcomes = require("../../lib/call-outcomes");
const call = (peak, latest, at) => ({
  called_price_usd: 1, peak_price_usd: peak, latest_price_usd: latest,
  called_at: at || "2026-07-01T00:00:00Z"
});

test("classifies +50%, 2x and 5x outcomes into the right buckets", () => {
  assert.strictEqual(outcomes.outcomeBucket(call(1.2, 1.2)), "under50");
  assert.strictEqual(outcomes.outcomeBucket(call(1.5, 1.5)), "plus50");
  assert.strictEqual(outcomes.outcomeBucket(call(2, 2)), "twoX");
  assert.strictEqual(outcomes.outcomeBucket(call(5, 5)), "fiveX");
  assert.strictEqual(outcomes.outcomeBucket(call(9, 9)), "fiveX");
});
test("an unmeasured call has no bucket rather than defaulting to the worst one", () => {
  assert.strictEqual(outcomes.outcomeBucket({ called_price_usd: 1 }), null);
  assert.strictEqual(outcomes.outcomeBucket({}), null);
});
test("maximum drawdown is integer basis points from the peak", () => {
  assert.strictEqual(outcomes.maxDrawdownBps(call(2, 1)), 5000);   // -50% off peak
  assert.strictEqual(outcomes.maxDrawdownBps(call(4, 3)), 2500);
  assert.strictEqual(outcomes.maxDrawdownBps(call(2, 2)), 0);      // never drew down
});
test("drawdown is null when unmeasured, not zero", () => {
  // Zero would claim "never drew down", which is a different fact from "not measured".
  assert.strictEqual(outcomes.maxDrawdownBps({ called_price_usd: 1 }), null);
});
test("distribution counts each measured call exactly once", () => {
  const dist = outcomes.outcomeDistribution([call(1.1, 1.1), call(1.6, 1.6), call(3, 3), call(6, 6), {}]);
  assert.deepStrictEqual(dist, { under50: 1, plus50: 1, twoX: 1, fiveX: 1 });
});
test("aggregates win rate, median, average and drawdown over a period", () => {
  const agg = outcomes.sourceAggregate([call(2, 1), call(3, 3), call(0.5, 0.5), call(4, 2), call(1.5, 1.5)]);
  assert.strictEqual(agg.eligibleCalls, 5);
  assert.strictEqual(agg.measuredCalls, 5);
  assert.strictEqual(agg.measured, true);
  assert.strictEqual(agg.winRate, 80);                 // 4 of 5 above 1x
  assert.strictEqual(agg.medianReturnX, 2);
  assert.strictEqual(agg.maxDrawdownBps, 5000);        // worst single drawdown
});
test("below the minimum sample a source is not measured", () => {
  const agg = outcomes.sourceAggregate([call(2, 2), call(3, 3)], { minimumSampleSize: 5 });
  assert.strictEqual(agg.measured, false);
  assert.strictEqual(agg.measuredCalls, 2);
  // The real count is still reported so the UI can say "2 of 5 measured".
  assert.strictEqual(agg.eligibleCalls, 2);
});
test("a source with no measured calls reports nulls, never zeros", () => {
  const agg = outcomes.sourceAggregate([{}, {}]);
  assert.strictEqual(agg.measured, false);
  assert.strictEqual(agg.winRate, null);
  assert.strictEqual(agg.medianReturnX, null);
  assert.strictEqual(agg.averageReturnX, null);
  assert.strictEqual(agg.maxDrawdownBps, null);
});
test("eligible and measured counts stay distinct", () => {
  const agg = outcomes.sourceAggregate([call(2, 2), {}, {}]);
  assert.strictEqual(agg.eligibleCalls, 3);
  assert.strictEqual(agg.measuredCalls, 1);
});
test("last call timestamp is the most recent one", () => {
  const agg = outcomes.sourceAggregate([
    call(2, 2, "2026-07-01T00:00:00Z"),
    call(2, 2, "2026-07-29T00:00:00Z"),
    call(2, 2, "2026-07-15T00:00:00Z")
  ]);
  assert.strictEqual(agg.lastCallAt, "2026-07-29T00:00:00Z");
});
test("cross-posted duplicates collapse to one signal", () => {
  const events = [
    { sourceId: "s1", channelId: "c1", mint: "M" },
    { sourceId: "s1", channelId: "c1", mint: "M" },  // repost
    { sourceId: "s1", channelId: "c2", mint: "M" },  // different channel
    { sourceId: "s2", channelId: "c1", mint: "M" }   // different source
  ];
  assert.strictEqual(outcomes.dedupeSignals(events).length, 3);
});
test("an edited message keeps the original signal identity", () => {
  const first = { sourceId: "s1", channelId: "c1", mint: "M", messageId: "m1" };
  const edited = { sourceId: "s1", channelId: "c1", mint: "M", messageId: "m1", edited: true };
  assert.strictEqual(outcomes.deduplicationKey(first), outcomes.deduplicationKey(edited));
  assert.strictEqual(outcomes.dedupeSignals([first, edited]).length, 1);
});

console.log("per-subscriber safety enforcement (B-6)");
const { subscriberSafety } = require("../engine/store");

test("a legacy subscription runs on the platform baseline, not failed closed", () => {
  const r = subscriberSafety({ id: "legacy" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.safety, null);
  assert.strictEqual(r.fromBuilder, false);
});
test("a builder subscription supplies its own filters", () => {
  const r = subscriberSafety({
    bot_profile_id: "b1",
    extended_config: { safetyFilters: { ranges: { liquidityUsd: { enabled: true, min: 5000 } }, flags: { mintAuthorityRevoked: true } } }
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.safety.ranges.liquidityUsd.min, 5000);
  assert.strictEqual(r.safety.ranges.liquidityUsd.enabled, true);
  assert.strictEqual(r.fromBuilder, true);
});
test("a builder subscription with UNREADABLE filters refuses to execute", () => {
  // The failure this guards: running someone's bot without the risk settings they chose.
  for (const row of [
    { bot_profile_id: "b1", extended_config: {} },
    { config_version_id: "v1", extended_config: null },
    { bot_profile_id: "b1" }
  ]) {
    const r = subscriberSafety(row);
    assert.strictEqual(r.ok, false, JSON.stringify(row));
    assert.match(r.reason, /unavailable/i);
  }
});
test("a malformed safetyFilters value is treated as unreadable, not as empty", () => {
  const r = subscriberSafety({ bot_profile_id: "b1", extended_config: { safetyFilters: "nope" } });
  assert.strictEqual(r.ok, false);
});
test("a range with no enabled flag is not evaluated (row-level opt-in)", () => {
  const { evaluateSafety } = require("../engine/safety");
  const verdict = evaluateSafety({
    pair: { liquidity: { usd: 1 } },
    mintInfo: null,
    safety: { ranges: { liquidityUsd: { min: 999999999 } }, flags: {} }
  });
  assert.strictEqual(verdict.ok, true, "an un-enabled range must not block");
});
test("one subscriber's filters cannot leak into another's decision", () => {
  const strict = subscriberSafety({ bot_profile_id: "a", extended_config: { safetyFilters: { ranges: { liquidityUsd: { enabled: true, min: 999999999 } }, flags: {} } } });
  const loose = subscriberSafety({ bot_profile_id: "b", extended_config: { safetyFilters: { ranges: {}, flags: {} } } });
  assert.notDeepStrictEqual(strict.safety, loose.safety);
  const { evaluateSafety } = require("../engine/safety");
  const evidence = { pair: { liquidity: { usd: 50000 } }, mintInfo: null };
  const strictVerdict = evaluateSafety({ ...evidence, safety: strict.safety });
  const looseVerdict = evaluateSafety({ ...evidence, safety: loose.safety });
  assert.strictEqual(strictVerdict.ok, false); // 50k < the strict minimum
  assert.strictEqual(looseVerdict.ok, true);   // no bound set
});

console.log("numeric input editing rules (spec 5)");
const num = require("../../lib/numeric-input");
const SOLF = num.PRESETS.sol;

test("an empty field is a valid editing state, so the field can be cleared", () => {
  // The defect: numeric state + Number("") -> 0 -> re-render "0". Clearing was impossible.
  assert.strictEqual(num.isEditable("", SOLF), true);
});
test("a trailing dot is editable and is NOT committed early", () => {
  // The defect: Number("0.") === 0 ate the dot, so 0.5 could never be typed.
  assert.strictEqual(num.isEditable("0.", SOLF), true);
  assert.strictEqual(num.isCommittable("0."), false);
  assert.strictEqual(num.isCommittable("0.5"), true);
});
test("a leading zero is stripped, so typing 5 into a zero field gives 5 not 05", () => {
  assert.strictEqual(num.normalizeWhileTyping("05"), "5");
  assert.strictEqual(num.normalizeWhileTyping("0"), "0");
  assert.strictEqual(num.normalizeWhileTyping("0.5"), "0.5");
  // Regression: an all-zero body stripped to "" and the field erased itself mid-typing.
  assert.strictEqual(num.normalizeWhileTyping("00"), "0");
  assert.strictEqual(num.normalizeWhileTyping("000"), "0");
  assert.strictEqual(num.normalizeWhileTyping("-00"), "-0");
  // Regression: clamp skipped any max of 0 or below, so an upper bound of 0 did nothing.
  assert.strictEqual(num.clamp(50, 0, 0), 0);
  assert.strictEqual(num.clamp(5, null, -1), -1);
  assert.strictEqual(num.clamp(150, 0, 100), 100);
  assert.strictEqual(num.clamp(-5, 0, 100), 0);
  assert.strictEqual(num.normalizeWhileTyping("00012"), "12");
});
test("blur resolves partial input instead of leaving it broken", () => {
  assert.strictEqual(num.resolveOnBlur("", SOLF).value, 0);
  assert.strictEqual(num.resolveOnBlur(".", SOLF).value, 0);
  assert.strictEqual(num.resolveOnBlur("0.", SOLF).value, 0);
  assert.strictEqual(num.resolveOnBlur(".5", SOLF).value, 0.5);
  assert.strictEqual(num.resolveOnBlur("5.", SOLF).value, 5);
});
test("small decimals survive — 0.01 must not round to 0", () => {
  assert.strictEqual(num.isEditable("0.01", SOLF), true);
  assert.strictEqual(num.resolveOnBlur("0.01", SOLF).value, 0.01);
});
test("precision beyond the field's decimals is rejected at keystroke time", () => {
  assert.strictEqual(num.isEditable("0.12345", SOLF), false);   // sol preset is 4dp
  assert.strictEqual(num.isEditable("0.1234", SOLF), true);
  assert.strictEqual(num.isEditable("1.5", num.PRESETS.integer), false);
});
test("exponent, separators and stray characters are rejected", () => {
  for (const bad of ["1e5", "1,5", "1 5", "abc", "1.2.3", "--5", "+5"]) {
    assert.strictEqual(num.isEditable(bad, SOLF), false, bad);
  }
});
test("negatives are rejected unless the field allows them", () => {
  assert.strictEqual(num.isEditable("-5", SOLF), false);
  assert.strictEqual(num.isEditable("-5", { decimals: 2, allowNegative: true }), true);
});
test("blur clamps to the field bounds", () => {
  assert.strictEqual(num.resolveOnBlur("999", { ...SOLF, max: 100 }).value, 100);
  assert.strictEqual(num.resolveOnBlur("0", { ...SOLF, min: 1 }).value, 1);
  assert.strictEqual(num.resolveOnBlur("50", num.PRESETS.percent).value, 50);
  assert.strictEqual(num.resolveOnBlur("150", num.PRESETS.percent).value, 100);
});
test("NaN never reaches state", () => {
  assert.strictEqual(num.resolveOnBlur("abc", SOLF).value, 0);
  assert.ok(Number.isFinite(num.resolveOnBlur("", SOLF).value));
});
test("display trims trailing zeros but keeps a bare zero", () => {
  assert.strictEqual(num.format(0.5, 4), "0.5");
  assert.strictEqual(num.format(0, 4), "0");
  assert.strictEqual(num.format(1.0, 4), "1");
  assert.strictEqual(num.format(0.01, 4), "0.01");
});
test("a pasted value is validated by the same rule as typing", () => {
  assert.strictEqual(num.isEditable("2.5", SOLF), true);
  assert.strictEqual(num.isEditable("2.5abc", SOLF), false);
});

console.log("user withdrawals (spec 12 / 22.2)");
const wd = require("../../lib/withdrawal");
const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const DEST = "6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP";
const withdraw = (over) => wd.validateWithdrawal(Object.assign({
  owner: OWNER,
  destination: DEST,
  amountLamports: SOL,
  balanceLamports: SOL * BigInt(10),
  lockedLamports: BigInt(0)
}, over || {}));

test("a user with spendable principal can withdraw", () => {
  const r = withdraw();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.amountLamports, SOL);
});
test("zero balance is a validation state, not a disabled feature", () => {
  const r = withdraw({ balanceLamports: BigInt(0) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "zero-balance");
  // Must not read as an admin-permission or feature-lock message (spec 12.4, 23).
  assert.ok(!/approval|locked|unavailable|permission/i.test(r.message));
});
test("amount above available is rejected with the actual available figure", () => {
  const r = withdraw({ amountLamports: SOL * BigInt(50) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "exceeds-spendable");
});
test("locked capital is explained exactly, not hidden", () => {
  const r = withdraw({ balanceLamports: SOL * BigInt(2), lockedLamports: SOL * BigInt(2) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "locked-capital");
  assert.strictEqual(r.lockedLamports, SOL * BigInt(2));
  assert.ok(/open positions/i.test(r.message));
});
test("rent and network fee reserve is retained", () => {
  const r = withdraw({ balanceLamports: wd.REQUIRED_RESERVE_LAMPORTS, amountLamports: BigInt(1) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "below-reserve");
});
test("spendable never goes negative", () => {
  assert.strictEqual(wd.spendableLamports({ balanceLamports: BigInt(0) }), BigInt(0));
  assert.strictEqual(wd.spendableLamports({ balanceLamports: SOL, lockedLamports: SOL * BigInt(5) }), BigInt(0));
  // A negative locked or pending figure must never INCREASE what can be withdrawn. Before
  // this was floored, balance 1 SOL with locked -1 SOL reported ~2 SOL spendable and
  // validateWithdrawal approved 1.5 SOL against a 1 SOL balance. These values come from the
  // database, so this guards an accounting bug rather than a hostile caller.
  assert.strictEqual(
    wd.spendableLamports({ balanceLamports: SOL, lockedLamports: -SOL }),
    wd.spendableLamports({ balanceLamports: SOL, lockedLamports: BigInt(0) })
  );
  assert.strictEqual(
    wd.spendableLamports({ balanceLamports: SOL, pendingWithdrawalLamports: -SOL }),
    wd.spendableLamports({ balanceLamports: SOL, pendingWithdrawalLamports: BigInt(0) })
  );
  // Spendable can never exceed what the account actually holds, whatever the inputs claim.
  assert.ok(wd.spendableLamports({ balanceLamports: SOL, lockedLamports: -SOL * BigInt(9) }) < SOL);
  {
    const over = wd.validateWithdrawal({
      owner: "FSF99fXBhfr15KBzjA2uQWf8vmAnawd3eTD5LdcTQbh9",
      destination: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      balanceLamports: SOL,
      lockedLamports: -SOL,
      amountLamports: SOL + BigInt(500000000)
    });
    assert.strictEqual(over.ok, false, "must not approve more than the balance");
    assert.strictEqual(over.code, "exceeds-spendable");
  }
});
test("invalid and self-destination addresses are rejected", () => {
  assert.strictEqual(withdraw({ destination: "not-an-address" }).code, "invalid-destination");
  assert.strictEqual(withdraw({ destination: "0OIl" + "x".repeat(35) }).code, "invalid-destination");
  assert.strictEqual(withdraw({ destination: OWNER }).code, "same-address");
});
test("non-positive and fractional amounts are rejected", () => {
  assert.strictEqual(withdraw({ amountLamports: BigInt(0) }).code, "invalid-amount");
  assert.strictEqual(withdraw({ amountLamports: "-5" }).code, "invalid-amount");
  assert.strictEqual(withdraw({ amountLamports: 1.5 }).code, "invalid-amount");
});
test("percent selectors floor to whole lamports and never exceed spendable", () => {
  const spendable = wd.spendableLamports({ balanceLamports: SOL * BigInt(10) });
  assert.strictEqual(wd.percentOfSpendable(spendable, 100), spendable);
  assert.strictEqual(wd.percentOfSpendable(spendable, 50), spendable / BigInt(2));
  assert.ok(wd.percentOfSpendable(spendable, 25) < spendable);
  for (const pct of [25, 50, 75, 100]) {
    assert.strictEqual(withdraw({ amountLamports: wd.percentOfSpendable(spendable, pct) }).ok, true);
  }
});
test("a retried submission produces the same idempotency key", () => {
  const args = { owner: OWNER, destination: DEST, amountLamports: "1000", requestId: "abc" };
  assert.strictEqual(wd.withdrawalIdempotencyKey(args), wd.withdrawalIdempotencyKey(args));
  assert.notStrictEqual(
    wd.withdrawalIdempotencyKey(args),
    wd.withdrawalIdempotencyKey(Object.assign({}, args, { amountLamports: "1001" }))
  );
});
test("principal withdrawal does not inherit the affiliate payout minimum or fee", () => {
  // Affiliate payout rules (0.1 SOL minimum, 0.043 SOL fee) stay separate (spec 12.6).
  const AFFILIATE_MINIMUM = SOL / BigInt(10);
  const r = withdraw({ amountLamports: AFFILIATE_MINIMUM / BigInt(2) });
  assert.strictEqual(r.ok, true);
});

// The bot's configured safety filters were persisted and never read: rugcheck.js
// hardcoded a $10,000 liquidity floor, so a bot asking for $500,000 was executed against
// $10,000. These cover the enforcement layer that closes that gap (spec 10, 11.2).
// The Portfolio page is authentication-gated, so its Statistics panel cannot be exercised
// in a browser without a real session. The arithmetic lives in a pure module so it is
// verifiable at all (spec 17.1, reference R5 "Main Stats").
console.log("portfolio statistics (spec 17.1)");
const { portfolioStatistics } = require("../../lib/portfolio-stats");
const exec = (side, sol) => ({ side, mint: "M" + sol, grossNotionalLamports: String(sol * 1e9), created_at: "2026-07-2" + (sol % 9) + "T00:00:00Z" });
const pos = (status, pnlSol) => ({ status, realizedPnlLamports: String(pnlSol * 1e9), costLamports: "1000000000" });

test("buy and sell volume are summed separately", () => {
  const s = portfolioStatistics({ executions: [exec("buy", 12), exec("buy", 8), exec("sell", 15)] });
  assert.strictEqual(s.buyVolumeSol, 20);
  assert.strictEqual(s.sellVolumeSol, 15);
  assert.strictEqual(s.buyCount, 2);
  assert.strictEqual(s.sellCount, 1);
});
test("wins and losses count only closed positions", () => {
  const s = portfolioStatistics({ positions: [pos("closed", 0.9), pos("closed", -0.4), pos("closed", 0.7), pos("open", 0)] });
  assert.strictEqual(s.closedPositions, 3);
  assert.strictEqual(s.wins, 2);
  assert.strictEqual(s.losses, 1);
});
test("no closed positions reports null, not 0/0", () => {
  // "nothing has closed" and "an even win/loss split" are different facts (spec 23).
  const s = portfolioStatistics({ positions: [pos("open", 0)] });
  assert.strictEqual(s.wins, null);
  assert.strictEqual(s.losses, null);
});
test("a break-even close counts as neither a win nor a loss", () => {
  const s = portfolioStatistics({ positions: [pos("closed", 0)] });
  assert.strictEqual(s.wins, 0);
  assert.strictEqual(s.losses, 0);
  assert.strictEqual(s.closedPositions, 1);
});
test("gas fees are reported separately from total fees", () => {
  const s = portfolioStatistics({ performance: { networkFeesLamports: "60000", platformFeesLamports: "800000000", creatorFeesLamports: "280000000" } });
  assert.ok(Math.abs(s.networkFeesSol - 0.00006) < 1e-9);
  assert.ok(Math.abs(s.allFeesSol - 1.08006) < 1e-9);
});
test("unique tokens counts executions and legacy trades together", () => {
  const s = portfolioStatistics({ executions: [exec("buy", 1), exec("buy", 1)], legacyTrades: [{ mint: "OTHER", created_at: "2026-07-01T00:00:00Z" }] });
  assert.strictEqual(s.uniqueTokens, 2);
  assert.strictEqual(s.totalSwaps, 3);
});
test("last swap is the most recent across both sources", () => {
  const s = portfolioStatistics({
    executions: [{ side: "buy", mint: "A", grossNotionalLamports: "0", created_at: "2026-07-10T00:00:00Z" }],
    legacyTrades: [{ mint: "B", created_at: "2026-07-29T00:00:00Z" }]
  });
  assert.strictEqual(s.lastSwapAt, "2026-07-29T00:00:00Z");
});
test("risk-flagged tokens is null when the server supplied no risk evidence", () => {
  assert.strictEqual(portfolioStatistics({ performance: {} }).riskFlaggedTokens, null);
  assert.strictEqual(portfolioStatistics({ performance: { metrics: { riskFlaggedTokens: 2 } } }).riskFlaggedTokens, 2);
});
test("an empty summary produces zeros and nulls without throwing", () => {
  const s = portfolioStatistics(null);
  assert.strictEqual(s.totalSwaps, 0);
  assert.strictEqual(s.buyVolumeSol, 0);
  assert.strictEqual(s.wins, null);
  assert.strictEqual(s.lastSwapAt, null);
});

console.log("configured safety filters (spec 10)");
const { evaluateSafety } = require("../engine/safety");
const pairFixture = (over) => Object.assign({
  liquidity: { usd: 250000 },
  marketCap: 5000000,
  volume: { h24: 900000 },
  priceChange: { h24: -6 },
  pairCreatedAt: 1_700_000_000_000,
  baseToken: { symbol: "DEGEN", name: "Degen Token" },
  info: { socials: [{ type: "twitter", url: "https://x.com/x" }] }
}, over || {});
const range = (key, cfg) => ({ ranges: { [key]: Object.assign({ enabled: true }, cfg) }, flags: {} });

test("a configured liquidity floor is enforced instead of the hardcoded default", () => {
  // The exact defect: $250k liquidity passes the old $10k floor but fails the user's $500k.
  const r = evaluateSafety({ pair: pairFixture(), safety: range("liquidityUsd", { min: 500000, max: 0 }) });
  assert.strictEqual(r.ok, false);
  assert.ok(/liquidityUsd 250000 below configured minimum 500000/.test(r.reasons.join("|")));
});
test("a configured filter that passes does not block", () => {
  const r = evaluateSafety({ pair: pairFixture(), safety: range("liquidityUsd", { min: 100000, max: 0 }) });
  assert.strictEqual(r.ok, true);
  assert.ok(r.evaluated.includes("liquidityUsd"));
});
test("upper bounds are enforced too", () => {
  const r = evaluateSafety({ pair: pairFixture(), safety: range("marketCapUsd", { min: 0, max: 1000000 }) });
  assert.strictEqual(r.ok, false);
  assert.ok(/above configured maximum/.test(r.reasons.join("|")));
});
test("a disabled filter is ignored entirely", () => {
  const r = evaluateSafety({ pair: pairFixture(), safety: { ranges: { liquidityUsd: { enabled: false, min: 999999999, max: 0 } }, flags: {} } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.evaluated.length, 0);
});
test("negative price change converts to basis points correctly", () => {
  const r = evaluateSafety({ pair: pairFixture(), safety: range("priceChangeBps", { min: -500, max: 10000 }) });
  assert.strictEqual(r.ok, false);  // -6% = -600 bps, below a -500 bps floor
});
test("an enabled filter with unavailable evidence FAILS CLOSED", () => {
  const r = evaluateSafety({ pair: null, safety: range("liquidityUsd", { min: 1, max: 0 }) });
  assert.strictEqual(r.ok, false);
  assert.ok(r.blockedUnevaluated.includes("liquidityUsd"));
  assert.ok(/blocked/.test(r.reasons.join("|")));
});
test("an enabled filter with no wired provider FAILS CLOSED rather than being skipped", () => {
  // Silently ignoring a filter the user switched on is the original defect in a new place.
  const r = evaluateSafety({ pair: pairFixture(), safety: range("smartMoneyInflowSol", { min: 1, max: 0 }) });
  assert.strictEqual(r.ok, false);
  assert.ok(r.blockedUnevaluated.includes("smartMoneyInflowSol"));
});
test("fail-open is honoured only when explicitly configured", () => {
  const r = evaluateSafety({
    pair: pairFixture(),
    safety: { ranges: { smartMoneyInflowSol: { enabled: true, min: 1, max: 0 } }, flags: {}, unavailableDataBehavior: "allow" }
  });
  assert.strictEqual(r.ok, true);
});
test("mint and freeze authority flags block when unverifiable", () => {
  const r = evaluateSafety({ pair: pairFixture(), mintInfo: null, safety: { ranges: {}, flags: { mintAuthorityRevoked: true } } });
  assert.strictEqual(r.ok, false);
  assert.ok(/could not verify on-chain authority/.test(r.reasons.join("|")));
});
test("an un-revoked mint authority is rejected", () => {
  const r = evaluateSafety({ pair: pairFixture(), mintInfo: { mintAuthority: "SOMEONE" }, safety: { ranges: {}, flags: { mintAuthorityRevoked: true } } });
  assert.strictEqual(r.ok, false);
  assert.ok(/mint authority NOT revoked/.test(r.reasons.join("|")));
});
test("non-Latin token metadata is rejected when the flag is on", () => {
  const r = evaluateSafety({
    pair: pairFixture({ baseToken: { symbol: "ДЕГЕН", name: "Degen" } }),
    safety: { ranges: {}, flags: { latinNameSymbol: true } }
  });
  assert.strictEqual(r.ok, false);
  assert.ok(/non-Latin/.test(r.reasons.join("|")));
});
test("DEX paid uses the enhanced-info proxy and is named as such", () => {
  const withInfo = evaluateSafety({ pair: pairFixture(), safety: { ranges: {}, flags: { dexPaid: true } } });
  assert.strictEqual(withInfo.ok, true);
  const without = evaluateSafety({ pair: pairFixture({ info: {} }), safety: { ranges: {}, flags: { dexPaid: true } } });
  assert.strictEqual(without.ok, false);
  assert.ok(/enhanced info absent/.test(without.reasons.join("|")));
});
test("every reason names the filter, so a rejection is explainable", () => {
  const r = evaluateSafety({
    pair: pairFixture(),
    safety: { ranges: { liquidityUsd: { enabled: true, min: 500000, max: 0 }, marketCapUsd: { enabled: true, min: 0, max: 100 } }, flags: {} }
  });
  assert.strictEqual(r.reasons.length, 2);
  for (const reason of r.reasons) assert.ok(reason.length > 10);
});

console.log("rugcheck thresholds");
const MIN_LIQ = 10000, MAX_SCORE = 60;
function verdict({ liq, score, mintAuth, freezeAuth }) {
  const reasons = [];
  if (liq < MIN_LIQ) reasons.push("low liquidity");
  if (score > MAX_SCORE) reasons.push("high risk score");
  if (mintAuth) reasons.push("mint authority");
  if (freezeAuth) reasons.push("freeze authority");
  return { ok: reasons.length === 0, reasons };
}
test("passes a clean token", () => assert.strictEqual(verdict({ liq: 50000, score: 20, mintAuth: false, freezeAuth: false }).ok, true));
test("fails low liquidity", () => assert.strictEqual(verdict({ liq: 500, score: 10, mintAuth: false, freezeAuth: false }).ok, false));
test("fails unrevoked mint authority", () => assert.strictEqual(verdict({ liq: 50000, score: 10, mintAuth: true, freezeAuth: false }).ok, false));
test("fails high risk score", () => assert.strictEqual(verdict({ liq: 50000, score: 90, mintAuth: false, freezeAuth: false }).ok, false));

console.log("limit orders");
const { evaluateLimit } = require("../engine/limits");
test("buy-below fires at or under target", () => {
  assert.strictEqual(evaluateLimit({ status: "open", trigger: "below", target_usd: 1 }, 0.9), true);
  assert.strictEqual(evaluateLimit({ status: "open", trigger: "below", target_usd: 1 }, 1.1), false);
});
test("buy-above fires at or over target", () => {
  assert.strictEqual(evaluateLimit({ status: "open", trigger: "above", target_usd: 2 }, 2.5), true);
  assert.strictEqual(evaluateLimit({ status: "open", trigger: "above", target_usd: 2 }, 1.9), false);
});
test("never fires on filled orders or missing price", () => {
  assert.strictEqual(evaluateLimit({ status: "filled", trigger: "below", target_usd: 1 }, 0.5), false);
  assert.strictEqual(evaluateLimit({ status: "open", trigger: "below", target_usd: 1 }, 0), false);
});

console.log("copy-trade buy detection");
const { detectBuys } = require("../engine/copy");
test("detects a brand-new token", () => {
  assert.deepStrictEqual(detectBuys({}, { MINTA: 100 }), ["MINTA"]);
});
test("detects an increased position", () => {
  assert.deepStrictEqual(detectBuys({ MINTA: 100 }, { MINTA: 250 }), ["MINTA"]);
});
test("ignores unchanged or reduced positions (sells)", () => {
  assert.deepStrictEqual(detectBuys({ MINTA: 100 }, { MINTA: 100 }), []);
  assert.deepStrictEqual(detectBuys({ MINTA: 100 }, { MINTA: 40 }), []);
});

console.log("discord call selection");
const { pickNewCalls } = require("../engine/calls");
test("picks a fresh, executable call", () => {
  const out = pickNewCalls([{ id: "c1", mint: "M", group_id: "g1", executed_at: null }], new Set());
  assert.deepStrictEqual(out.map((c) => c.id), ["c1"]);
});
test("ignores already-executed calls", () => {
  assert.strictEqual(pickNewCalls([{ id: "c1", mint: "M", group_id: "g1", executed_at: "2026-01-01" }], new Set()).length, 0);
});
test("ignores calls already seen this run", () => {
  assert.strictEqual(pickNewCalls([{ id: "c1", mint: "M", group_id: "g1", executed_at: null }], new Set(["c1"])).length, 0);
});
test("ignores calls missing mint or group", () => {
  assert.strictEqual(pickNewCalls([{ id: "c1", mint: "M", group_id: null }, { id: "c2", group_id: "g1" }], new Set()).length, 0);
});

console.log("call performance scanner");
const { bestSolanaPair, performanceUpdate } = require("../engine/performance");
test("uses the most liquid Solana base-token pair", () => {
  const pair = bestSolanaPair({ pairs: [
    { chainId: "ethereum", baseToken: { address: "M" }, liquidity: { usd: 999999 } },
    { chainId: "solana", baseToken: { address: "OTHER" }, liquidity: { usd: 999999 } },
    { chainId: "solana", baseToken: { address: "M" }, liquidity: { usd: 1000 } },
    { chainId: "solana", baseToken: { address: "M" }, liquidity: { usd: 5000 } }
  ] }, "M");
  assert.strictEqual(pair.liquidity.usd, 5000);
});
test("preserves the peak while recording a lower current price", () => {
  const update = performanceUpdate(
    { called_price_usd: 0.01, peak_price_usd: 0.04, called_mcap: 100000, peak_mcap: 400000 },
    { priceUsd: 0.02, marketCap: 200000, liquidityUsd: 50000 },
    "2026-07-12T00:00:00.000Z"
  );
  assert.strictEqual(update.latest_price_usd, 0.02);
  assert.strictEqual(update.peak_price_usd, 0.04);
  assert.strictEqual(update.latest_mcap, 200000);
  assert.strictEqual(update.peak_mcap, 400000);
  assert.strictEqual(update.last_scanned_at, "2026-07-12T00:00:00.000Z");
});

console.log("verified trade ledger");
const { SOL_MINT, analyzeSwapTransaction } = require("../../lib/server/trade-verification");
const tradeSignature = "5".repeat(88);
const tradeWallet = "W".repeat(44);
const tradeMint = "M".repeat(44);
const feeAccount = "F".repeat(44);
const swapTransaction = {
  transaction: {
    signatures: [tradeSignature],
    message: { accountKeys: [
      { pubkey: tradeWallet, signer: true },
      { pubkey: "T".repeat(44), signer: false },
      { pubkey: feeAccount, signer: false }
    ] }
  },
  meta: {
    err: null,
    logMessages: ["Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [1]"],
    preTokenBalances: [
      { accountIndex: 1, owner: tradeWallet, mint: tradeMint, uiTokenAmount: { amount: "0", decimals: 6 } },
      { accountIndex: 2, mint: SOL_MINT, uiTokenAmount: { amount: "500000000", decimals: 9 } }
    ],
    postTokenBalances: [
      { accountIndex: 1, owner: tradeWallet, mint: tradeMint, uiTokenAmount: { amount: "2500000", decimals: 6 } },
      { accountIndex: 2, mint: SOL_MINT, uiTokenAmount: { amount: "510000000", decimals: 9 } }
    ]
  }
};
test("derives token amount and fee from confirmed balance deltas", () => {
  const result = analyzeSwapTransaction(swapTransaction, {
    signature: tradeSignature, userPubkey: tradeWallet, mint: tradeMint, side: "buy", feeAccount
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.tokenAmount, 2.5);
  assert.strictEqual(result.feeSol, 0.01);
});
test("rejects a forged trade side", () => {
  const result = analyzeSwapTransaction(swapTransaction, {
    signature: tradeSignature, userPubkey: tradeWallet, mint: tradeMint, side: "sell", feeAccount
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /side/);
});
test("rejects a transaction that the claimed wallet did not sign", () => {
  const result = analyzeSwapTransaction(swapTransaction, {
    signature: tradeSignature, userPubkey: "X".repeat(44), mint: tradeMint, side: "buy", feeAccount
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /sign/);
});

console.log("delegated wallet ownership");
const { ownsPrivyWallet } = require("../../lib/server/privy-wallet");
const identityPayload = {
  sub: "did:privy:owner",
  linked_accounts: JSON.stringify([{
    type: "wallet", chain_type: "solana", address: tradeWallet, id: "wallet-owner"
  }])
};
test("accepts the authenticated user's linked Solana wallet", () => {
  assert.strictEqual(ownsPrivyWallet(identityPayload, "did:privy:owner", tradeWallet, "wallet-owner"), true);
});
test("rejects a different Privy user", () => {
  assert.strictEqual(ownsPrivyWallet(identityPayload, "did:privy:attacker", tradeWallet, "wallet-owner"), false);
});
test("rejects an unlinked wallet address", () => {
  assert.strictEqual(ownsPrivyWallet(identityPayload, "did:privy:owner", "X".repeat(44), "wallet-owner"), false);
});
test("rejects a substituted wallet id", () => {
  assert.strictEqual(ownsPrivyWallet(identityPayload, "did:privy:owner", tradeWallet, "wallet-attacker"), false);
});

console.log("referral integrity");
const { validateReferralSlug } = require("../../lib/referral-rules");
const { CAPTURE_WINDOW_SECONDS, createReferralCapture, verifyReferralCapture } = require("../../lib/server/referral-capture");
const referralSecret = "test-referral-secret-with-sufficient-entropy";
const referralNow = Date.UTC(2026, 6, 28);
const visitorHash = "a".repeat(64);
test("accepts and canonicalizes an eligible custom referral slug", () => {
  assert.deepStrictEqual(validateReferralSlug("  Alpha-Calls-27 "), { ok: true, slug: "alpha-calls-27" });
});
test("rejects reserved, Unicode, and repeated-hyphen referral slugs", () => {
  assert.strictEqual(validateReferralSlug("admin").ok, false);
  assert.strictEqual(validateReferralSlug("dégen").ok, false);
  assert.strictEqual(validateReferralSlug("alpha--calls").ok, false);
});
test("round-trips a signed referral capture without exposing an owner id", () => {
  const capture = createReferralCapture({ code: "alpha-calls", visitorHash, now: referralNow }, referralSecret);
  const parsed = verifyReferralCapture(capture, referralSecret, referralNow + 1000);
  assert.strictEqual(parsed.code, "alpha-calls");
  assert.strictEqual(parsed.visitorHash, visitorHash);
  assert.strictEqual(JSON.stringify(parsed).includes("privy"), false);
});
test("rejects tampered and expired referral captures", () => {
  const capture = createReferralCapture({ code: "alpha-calls", visitorHash, now: referralNow }, referralSecret);
  assert.strictEqual(verifyReferralCapture(`${capture}x`, referralSecret, referralNow), null);
  assert.strictEqual(
    verifyReferralCapture(capture, referralSecret, referralNow + (CAPTURE_WINDOW_SECONDS + 1) * 1000),
    null
  );
});

console.log("delegated signing network gate");
const { CAIP2, resolveCaip2 } = require("../engine/signer");
test("requires an explicit supported signing network", () => {
  assert.throws(() => resolveCaip2(), /explicit worker network/);
  assert.throws(() => resolveCaip2("localnet"), /explicit worker network/);
});
test("maps only the declared Solana networks", () => {
  assert.strictEqual(resolveCaip2("devnet"), CAIP2.devnet);
  assert.strictEqual(resolveCaip2("mainnet"), CAIP2.mainnet);
});

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
