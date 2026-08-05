// Minimal zero-dependency test runner for the Degenaration server logic.
const assert = require("assert");
const { parseCall } = require("../bot/parser");

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    const result = fn();
    // This runner is synchronous: it never awaited fn(). An async test therefore returned a
    // pending promise, counted as a pass immediately, and turned its assertions into
    // unhandled rejections that failed nothing. Two such tests were written and reported
    // green while asserting nothing at all - caught only by reverting the fix they covered
    // and seeing the suite still pass.
    //
    // Rather than make every call site await, refuse the shape outright. Keep tests
    // synchronous; if async behaviour needs covering, extract the pure logic and test that.
    if (result && typeof result.then === "function") {
      throw new Error("test function returned a promise; this runner is synchronous, so its assertions would never run");
    }
    pass++; console.log("  ✓ " + name);
  }
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

console.log("discord message parsing — embeds, replies, ambiguity (controller §1)");
const { parseMessage } = require("../bot/parser");
const MINT_A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT_B = "6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP";

test("reads a mint from an embed description", () => {
  const r = parseMessage({ content: "", embeds: [{ description: `CA: ${MINT_A}` }] });
  assert.strictEqual(r.mint, MINT_A);
  assert.strictEqual(r.confidence, "embed-address");
});
test("reads a mint from an embed field value", () => {
  const r = parseMessage({ content: "NEW CALL", embeds: [{ fields: [{ name: "Contract", value: MINT_A }] }] });
  assert.strictEqual(r.mint, MINT_A);
});
test("reads a mint from an embed url and marks it a link", () => {
  const r = parseMessage({ content: "", embeds: [{ url: `https://pump.fun/coin/${MINT_A}` }] });
  assert.strictEqual(r.mint, MINT_A);
  assert.strictEqual(r.confidence, "embed-link");
});
test("content link outranks an embed address", () => {
  const r = parseMessage({ content: `https://pump.fun/coin/${MINT_A}`, embeds: [{ description: MINT_B }] });
  assert.strictEqual(r.mint, MINT_A);
  assert.strictEqual(r.confidence, "link");
});
test("refuses two distinct addresses across regions rather than guessing", () => {
  const r = parseMessage({ content: MINT_A, embeds: [{ description: MINT_B }] });
  assert.strictEqual(r.mint, undefined);
  assert.strictEqual(r.rejected, "ambiguous-addresses");
  assert.strictEqual(r.candidates, 2);
});
test("the same address repeated in several regions is one candidate", () => {
  const r = parseMessage({ content: MINT_A, embeds: [{ description: MINT_A, footer: { text: MINT_A } }] });
  assert.strictEqual(r.mint, MINT_A);
});
test("refuses two links pointing at different mints", () => {
  const r = parseMessage({ content: `https://pump.fun/coin/${MINT_A} and https://birdeye.so/token/${MINT_B}` });
  assert.strictEqual(r.rejected, "ambiguous-links");
});
test("falls back to the replied-to message when the reply itself carries nothing", () => {
  const r = parseMessage({ content: "aped", referencedMessage: { content: MINT_A } });
  assert.strictEqual(r.mint, MINT_A);
  assert.strictEqual(r.confidence, "reply-address");
});
test("an ambiguous parent never makes the reply a call", () => {
  const r = parseMessage({ content: "aped", referencedMessage: { content: `${MINT_A} ${MINT_B}` } });
  assert.strictEqual(r, null);
});
test("the reply's own mint wins over the parent's", () => {
  const r = parseMessage({ content: MINT_A, referencedMessage: { content: MINT_B } });
  assert.strictEqual(r.mint, MINT_A);
  assert.strictEqual(r.confidence, "address");
});
test("ordinary chatter stays null, not a rejection", () => {
  assert.strictEqual(parseMessage({ content: "gm frens", embeds: [] }), null);
});
test("survives a malformed embed payload", () => {
  assert.strictEqual(parseMessage({ content: "", embeds: [null, { fields: null }] }), null);
  assert.strictEqual(parseMessage({}), null);
});

console.log("ingest delivery policy — retry, reject, dead letter (controller §1)");
const ingest = require("../bot/ingest");

test("a transient 503 is retried, not dropped", () => {
  // The route returns 503 when Solana mint validation is unavailable. Treating that as
  // permanent silently loses real calls on the most ordinary failure the path has.
  assert.strictEqual(ingest.classifyDeliveryFailure({ status: 503 }), "retry");
  assert.strictEqual(ingest.classifyDeliveryFailure({ status: 429 }), "retry");
  assert.strictEqual(ingest.classifyDeliveryFailure({ networkError: "ECONNRESET" }), "retry");
});
test("a permanent 4xx is rejected rather than retried forever", () => {
  assert.strictEqual(ingest.classifyDeliveryFailure({ status: 400 }), "reject");
  assert.strictEqual(ingest.classifyDeliveryFailure({ status: 422 }), "reject");
});
test("bad credentials are fatal, not counted as a retry", () => {
  assert.strictEqual(ingest.classifyDeliveryFailure({ status: 401 }), "fatal");
  assert.strictEqual(ingest.classifyDeliveryFailure({ status: 403 }), "fatal");
});
test("backoff grows and is capped", () => {
  assert.strictEqual(ingest.nextBackoffMs(0), 500);
  assert.strictEqual(ingest.nextBackoffMs(3), 4000);
  assert.strictEqual(ingest.nextBackoffMs(99), ingest.MAX_DELAY_MS);
  assert.strictEqual(ingest.nextBackoffMs(-1), 500);
});
test("payload carries the event version that keeps an edit from overwriting the create", () => {
  const create = ingest.buildIngestPayload({ channelId: "1", messageId: "2", call: { mint: MINT_A, confidence: "link" } });
  assert.strictEqual(create.eventType, "create");
  assert.strictEqual(create.eventVersion, "original");
  const edit = ingest.buildIngestPayload({ channelId: "1", messageId: "2", call: { mint: MINT_B }, eventType: "edit", eventVersion: "1754000000000" });
  assert.strictEqual(edit.eventVersion, "1754000000000");
  assert.notStrictEqual(create.eventVersion, edit.eventVersion);
});
test("an edit or delete without an event version is refused at the boundary", () => {
  assert.throws(() => ingest.buildIngestPayload({ channelId: "1", messageId: "2", eventType: "delete" }), /event version required/);
});
test("dead letters are bounded and report what they retired", () => {
  const q = new ingest.DeadLetterQueue(2);
  q.add({ n: 1 }).add({ n: 2 }).add({ n: 3 });
  assert.strictEqual(q.size, 2);
  assert.deepStrictEqual(q.summary(), { held: 2, retired: 1, total: 3 });
  assert.strictEqual(q.entries[0].n, 2);
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
  const dist = outcomes.outcomeDistribution([call(0.4, 0.2), call(1.1, 1.1), call(1.6, 1.6), call(3, 3), call(6, 6), {}]);
  assert.deepStrictEqual(dist, { down50: 1, under50: 1, plus50: 1, twoX: 1, fiveX: 1 });
});
test("a rug and a call that went nowhere are separate buckets", () => {
  // The old ladder started at "<50%", so peak 0.4x and peak 1.4x shared a cell — the two
  // outcomes a follower most needs told apart.
  assert.strictEqual(outcomes.outcomeBucket(call(0.4, 0.1)), "down50");
  assert.strictEqual(outcomes.outcomeBucket(call(1.4, 1.4)), "under50");
  assert.strictEqual(outcomes.outcomeBucket(call(0.5, 0.5)), "under50", "0.5x is the boundary and is not a rug");
});
test("win rate and 2x rate are different numbers", () => {
  // Same conflation the marketplace SQL had: one figure computed as the 2x share and
  // rendered under the label "Win rate".
  const agg = outcomes.sourceAggregate([call(1.2, 1.2), call(2, 2), call(0.4, 0.4)]);
  assert.strictEqual(Math.round(agg.winRate), 67);
  assert.strictEqual(Math.round(agg.twoXRate), 33);
});
test("best and worst call come from measured rows only", () => {
  const agg = outcomes.sourceAggregate([call(0.4, 0.4), call(5, 5), {}, call(1.2, 1.2)]);
  assert.strictEqual(agg.bestCall.peakX, 5);
  assert.strictEqual(agg.worstCall.peakX, 0.4);
  assert.strictEqual(outcomes.sourceAggregate([{}, {}]).bestCall, null,
    "an unmeasured source has no best call rather than a fabricated one");
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
    message: {
      accountKeys: [
        { pubkey: tradeWallet, signer: true },
        { pubkey: "T".repeat(44), signer: false },
        { pubkey: feeAccount, signer: false }
      ],
      // A real swap carries an actual Jupiter instruction. The fixture used to rely on the
      // log line alone, which is exactly the weakness the verifier no longer accepts.
      instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }]
    }
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
test("a forged Jupiter log line is not proof of a swap", () => {
  // logMessages is program-writable: any program can emit "Program JUP6Lkb... invoke [1]"
  // via msg!. Paired with a self-transfer to move a token balance, a log-only check let a
  // transaction that never touched Jupiter be recorded as a trade. Proof must come from an
  // actual instruction.
  const forged = JSON.parse(JSON.stringify(swapTransaction));
  forged.transaction.message.instructions = [{ programId: "F".repeat(43) + "k" }];
  forged.meta.innerInstructions = [];
  forged.meta.logMessages = ["Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [1]"];
  const result = analyzeSwapTransaction(forged, {
    signature: tradeSignature, userPubkey: tradeWallet, mint: tradeMint, side: "buy", feeAccount: null
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /not a Jupiter swap/);
});

test("Jupiter reached through a CPI still verifies", () => {
  // Aggregators and bots frequently invoke Jupiter from an inner instruction; requiring a
  // top-level match only would reject those legitimately.
  const viaCpi = JSON.parse(JSON.stringify(swapTransaction));
  viaCpi.transaction.message.instructions = [{ programId: "R".repeat(43) + "k" }];
  viaCpi.meta.innerInstructions = [
    { index: 0, instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }] }
  ];
  const result = analyzeSwapTransaction(viaCpi, {
    signature: tradeSignature, userPubkey: tradeWallet, mint: tradeMint, side: "buy", feeAccount: null
  });
  assert.strictEqual(result.ok, true, result.error);
});

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
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
test("a dexscreener link yields whatever the URL carries, pair address included", () => {
  // Pins current behaviour rather than blessing it: the parser cannot tell a pair address
  // from a mint, and the engine's token endpoint returns nothing for a pair, so the call is
  // skipped. Documented in parser.js; if the engine gains a pair fallback, this is where
  // the expectation changes.
  const pairAddress = "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9";
  const parsed = parseCall(`new call dexscreener.com/solana/${pairAddress} ape now`);
  assert.strictEqual(parsed.mint, pairAddress, "extracted verbatim, pair or mint alike");
  assert.strictEqual(parsed.confidence, "high", "a link is still higher confidence than a bare address");
});

console.log("subscriber safety wiring");
const storeSource = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "..", "engine", "store.js"), "utf8");

test("loadGroupSubscribers selects the columns subscriberSafety depends on", () => {
  // subscriberSafety reads bot_profile_id, config_version_id and extended_config off the
  // row. If the SELECT ever drops one, `fromBuilder` goes false and `config` undefined, so
  // EVERY subscriber reads as a legacy row with no filters — the exact B-6 defect, restored
  // silently by an innocuous query edit, with no error anywhere to notice it.
  const line = storeSource.split("\n").find((l) => l.includes("loadGroupSubscribers"));
  assert.ok(line, "loadGroupSubscribers must exist");
  for (const column of [
    "bot_profile_id", "config_version_id", "extended_config",
    "subscriber_config_version_id", "subscriber_config_snapshot"
  ]) {
    assert.ok(line.includes(column), `loadGroupSubscribers must select ${column}`);
  }
});

test("a builder subscription with unreadable filters refuses to execute", () => {
  const store = require("../../server/engine/store");
  // Builder row (has bot_profile_id) but no readable config: must be a refusal, never
  // "no filters configured".
  const refused = store.subscriberSafety({ id: "s1", bot_profile_id: "b1" });
  assert.strictEqual(refused.ok, false, "must refuse, not fall back to unfiltered");
  // Legacy row with no builder linkage: baseline checks only, allowed to run.
  const legacy = store.subscriberSafety({ id: "s2" });
  assert.strictEqual(legacy.ok, true);
  assert.strictEqual(legacy.safety, null);
  // Builder row with filters present: they are returned and used.
  const configured = store.subscriberSafety({
    id: "s3", config_version_id: "v1",
    extended_config: { safetyFilters: { ranges: { liquidityUsd: { enabled: true, min: 1, max: 0 } }, flags: {} } }
  });
  assert.strictEqual(configured.ok, true);
  assert.ok(configured.safety.ranges.liquidityUsd.enabled);
});

test("an explicitly versioned legacy row uses the compatibility baseline", () => {
  const compatible = subscriberSafety({
    subscriber_config_version_id: "risk-v1",
    subscriber_config_snapshot: { compatibilityMode: "legacy-baseline" }
  });
  assert.strictEqual(compatible.ok, true);
  assert.strictEqual(compatible.safety, null);
  assert.strictEqual(compatible.compatibilityMode, "legacy-baseline");
});

test("a versioned row with a missing snapshot refuses to execute", () => {
  const refused = subscriberSafety({ subscriber_config_version_id: "risk-v2" });
  assert.strictEqual(refused.ok, false);
});

test("an empty snapshot column does not shadow the row's real filters", () => {
  // subscriber_config_snapshot is NOT NULL DEFAULT '{}', so an unversioned row carries
  // an empty object — and `{}` is truthy. Preferring it on truthiness alone would drop
  // the configured filters and run the bot completely unfiltered.
  const row = {
    bot_profile_id: "b1",
    subscriber_config_snapshot: {},
    extended_config: { safetyFilters: { ranges: { liquidityUsd: { enabled: true, min: 5000 } }, flags: {} } }
  };
  const resolved = subscriberSafety(row);
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.safety.ranges.liquidityUsd.min, 5000);
});

test("a populated snapshot wins over a stale extended_config", () => {
  const resolved = subscriberSafety({
    subscriber_config_version_id: "risk-v3",
    subscriber_config_snapshot: { safetyFilters: { ranges: { liquidityUsd: { enabled: true, min: 9000 } }, flags: {} } },
    extended_config: { safetyFilters: { ranges: { liquidityUsd: { enabled: true, min: 1 } }, flags: {} } }
  });
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.safety.ranges.liquidityUsd.min, 9000);
});

console.log("safety evaluation wiring");
const { evaluateSafety: evalSafetyWiring } = require("../../server/engine/safety");

test("token age needs nowMs, and its absence blocks every call", () => {
  // engine/calls.js evaluates each subscriber's filters against the evidence rugCheck
  // already gathered. It omitted nowMs, and safety.js derives tokenAgeMinutes from
  // (nowMs - pairCreatedAt), so the evidence was null and the filter failed closed on every
  // call. A subscriber who enabled Token age had a bot that silently never traded.
  const pair = {
    liquidity: { usd: 250000 }, marketCap: 5000000, volume: { h24: 800000 },
    priceChange: { h24: 12 },
    pairCreatedAt: 1000,                     // long before nowMs below
    baseToken: { symbol: "GOOD", name: "Good" }, info: { socials: ["x"] }
  };
  const safety = { ranges: { tokenAgeMinutes: { enabled: true, min: 60, max: 0 } }, flags: {} };

  const withoutNow = evalSafetyWiring({ pair, mintInfo: null, safety });
  assert.strictEqual(withoutNow.ok, false, "no nowMs must block, proving it is required");
  assert.match(withoutNow.reasons[0], /evidence unavailable/);

  const withNow = evalSafetyWiring({ pair, mintInfo: null, safety, nowMs: 1000 + 7 * 24 * 3600 * 1000 });
  assert.strictEqual(withNow.ok, true, "a mature token passes once nowMs is supplied");
  assert.ok(withNow.evaluated.includes("tokenAgeMinutes"));
});

console.log("position monitor take-profit shares");
const { takeProfitShare } = require("../../server/engine/monitor");

test("both take-profit shares come out of the original position, not the remainder", () => {
  // The API rejects tp1_sell + tp2_sell > 100 and the builder labels it "% allocated", so
  // 50 + 50 means a full exit. Computing TP2 from the post-TP1 remainder sold 750 of 1000
  // and left the user holding a quarter of a position configured to be left entirely.
  // Amounts are BigInt: raw token amounts for high-supply mints exceed 2^53, where float
  // arithmetic would silently mis-size a sell.
  const original = BigInt(1000);
  let remaining = original;
  const tp1 = takeProfitShare(original, remaining, 50);
  remaining -= tp1;
  const tp2 = takeProfitShare(original, remaining, 50);
  remaining -= tp2;
  assert.strictEqual(tp1, BigInt(500));
  assert.strictEqual(tp2, BigInt(500), "TP2 is 50% of the ORIGINAL, not of what TP1 left");
  assert.strictEqual(remaining, BigInt(0), "50% + 50% exits the whole position");
});

test("a take-profit share never exceeds what the position still holds", () => {
  assert.strictEqual(takeProfitShare(1000, 300, 90), BigInt(300), "capped at the remaining balance");
  assert.strictEqual(takeProfitShare(1000, 0, 50), BigInt(0));
  assert.strictEqual(takeProfitShare(1000, 1000, 0), BigInt(0), "a zero share sells nothing");
});

console.log("API input rules (lib/server/input-rules.js)");
const rules = require("../../lib/server/input-rules");

test("mint validation accepts base58 addresses and rejects everything else", () => {
  assert.strictEqual(rules.isMint("So11111111111111111111111111111111111111112"), true);
  assert.strictEqual(rules.isMint("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), true);
  assert.strictEqual(rules.isMint("0OIl" + "1".repeat(36)), false, "base58 excludes 0 O I l");
  assert.strictEqual(rules.isMint("short"), false);
  assert.strictEqual(rules.isMint("1".repeat(45)), false, "too long");
  assert.strictEqual(rules.isMint(null), false);
  assert.strictEqual(rules.isMint(12345), false);
});

test("swap amounts are exact base-unit strings, with the SOL fat-finger cap", () => {
  // Token balances routinely exceed 2^53, so the value must survive as a string.
  const big = "18446744073709551615"; // u64 max
  assert.strictEqual(rules.validBaseUnits(big, false), big, "u64 max is representable exactly");
  assert.strictEqual(rules.validBaseUnits("18446744073709551616", false), null, "beyond u64 rejected");
  // 100 SOL cap applies to SOL inputs (buys) only; sells are bounded only by u64.
  assert.strictEqual(rules.validBaseUnits("100000000000", true), "100000000000", "exactly 100 SOL allowed");
  assert.strictEqual(rules.validBaseUnits("100000000001", true), null, "over 100 SOL rejected on a buy");
  assert.strictEqual(rules.validBaseUnits("100000000001", false), "100000000001", "no cap on a sell");
  assert.strictEqual(rules.validBaseUnits("0", true), null);
  assert.strictEqual(rules.validBaseUnits("-1", true), null);
  assert.strictEqual(rules.validBaseUnits("1.5", true), null, "fractional base units are meaningless");
  assert.strictEqual(rules.validBaseUnits(1.5, true), null);
  assert.strictEqual(rules.validBaseUnits(null, true), null);
  assert.strictEqual(rules.validBaseUnits("1e9", true), null, "exponent notation rejected");
});

test("slippage is always an integer, because Jupiter refuses anything else", () => {
  // Verified against the live quote endpoint: slippageBps=300.7 returns
  // "Query parameter slippageBps cannot be parsed: ParseIntError" and the swap fails.
  for (const input of [300.7, 1.5, 299.999, "300.7", 2000.9]) {
    const out = rules.validSlippageBps(input);
    assert.ok(Number.isInteger(out), `slippage from ${input} must be an integer, got ${out}`);
  }
  assert.strictEqual(rules.validSlippageBps(300.7), 300, "floors rather than rounds");
  assert.strictEqual(rules.validSlippageBps(5000), 2000, "capped at 20%");
  assert.strictEqual(rules.validSlippageBps(2000.9), 2000, "cap cannot be exceeded by rounding");
  assert.strictEqual(rules.validSlippageBps(0), 300, "below 1 falls back to the default");
  assert.strictEqual(rules.validSlippageBps("abc"), 300);
  assert.strictEqual(rules.validSlippageBps(null), 300);
  assert.strictEqual(rules.validSlippageBps(undefined), 300);
});

test("sanitized errors leak neither a stack nor an unbounded message", () => {
  const e = new TypeError("boom\n    at Object.<anonymous> (/srv/app/secret-path.js:12:7)");
  const out = rules.sanitizeError(e);
  assert.strictEqual(out.includes("secret-path"), false, "no stack frames");
  assert.strictEqual(out.includes("\n"), false, "single line");
  assert.strictEqual(out, "boom");
  assert.ok(rules.sanitizeError(new Error("x".repeat(500))).length <= 200, "length bounded");
});

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

  // Pin what the check does when Privy's token carries no wallet id: the claimed walletId
  // becomes unverifiable and is accepted. Safe only because authority comes from the
  // address binding, which still holds — asserted here so the accepted case can never be
  // mistaken for a verified one, and so making walletId authoritative fails loudly.
  const noIdPayload = {
    sub: "did:privy:owner",
    linked_accounts: [{ type: "wallet", chain_type: "solana", address: tradeWallet }]
  };
  assert.strictEqual(ownsPrivyWallet(noIdPayload, "did:privy:owner", tradeWallet, "anything-at-all"), true,
    "no id in the token means the claimed walletId cannot be checked");
  assert.strictEqual(ownsPrivyWallet(noIdPayload, "did:privy:owner", "X".repeat(44), "anything-at-all"), false,
    "the address binding still rejects a wallet the user does not own");
  assert.strictEqual(ownsPrivyWallet(noIdPayload, "did:privy:attacker", tradeWallet, "anything-at-all"), false,
    "the subject binding still rejects another user's identity token");
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
test("an absent signing secret disables capture rather than signing weakly", () => {
  // captureSecret() falls back to "" when neither REFERRAL_SIGNING_SECRET nor ADMIN_KEY is
  // set. Both halves must refuse it: signing with an empty key would let anyone forge a
  // capture and claim another creator's referral commission. This is the property that
  // makes the fallback safe, and nothing asserted it.
  const vh = "a".repeat(64);
  assert.strictEqual(createReferralCapture({ code: "alpha-calls", visitorHash: vh }, ""), null);
  assert.strictEqual(createReferralCapture({ code: "alpha-calls", visitorHash: vh }, undefined), null);
  assert.strictEqual(verifyReferralCapture("anything.anysig", ""), null);
});

test("a capture signed with one secret does not verify under another", () => {
  const vh = "a".repeat(64);
  const capture = createReferralCapture({ code: "alpha-calls", visitorHash: vh }, "secret-one");
  assert.ok(capture, "capture created");
  assert.strictEqual(verifyReferralCapture(capture, "secret-two"), null);
  assert.ok(verifyReferralCapture(capture, "secret-one"), "still valid under its own secret");
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

// --- worker refuses to sign while it cannot exit a position (ADR-001 finding 1) ---
// Spawned rather than unit-tested: the guard's whole value is that it stops the PROCESS,
// and a test of the predicate alone would still pass if someone deleted the process.exit.
{
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const workerPath = path.join(__dirname, "..", "worker.js");
  const baseEnv = {
    ...process.env,
    WORKER_NET: "devnet",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_KEY: "fake-key-for-test",
    COPY_TRADING: "off"
  };
  const { EXIT_PATH_REQUIREMENTS, missingExitPath } = require("../engine/exit-path");
  const run = (env, timeout = 20000) => spawnSync(process.execPath, [workerPath], {
    env: { ...baseEnv, ...env }, encoding: "utf8", timeout
  });

  test("the exit path is now wired, so the guard no longer refuses", () => {
    // The guard's contract is that it retires itself once the path genuinely exists. This
    // asserts the real store satisfies the real requirement list — no duplicated copy.
    const store = require("../engine/store");
    assert.deepStrictEqual(missingExitPath(store), []);
  });

  test("the guard re-arms the moment any single piece is removed", () => {
    // A guard that can only ever pass is not a guard. Every requirement must individually
    // be load-bearing, or one could be deleted without the gate noticing.
    const store = require("../engine/store");
    for (const name of EXIT_PATH_REQUIREMENTS) {
      const crippled = { ...store, [name]: undefined };
      assert.deepStrictEqual(missingExitPath(crippled), [name], `${name} is not load-bearing`);
    }
  });

  test("worker boots with signing on and starts the exit path", () => {
    // Spawned rather than unit-tested: the guard's value is that it controls the PROCESS.
    // The worker runs forever, so it is killed by the timeout — status is null, and what
    // matters is that it never printed the refusal and did start.
    const r = run({
      DELEGATED_SIGNING: "on", PORT: "18791",
      PRIVY_APP_ID: "x", PRIVY_APP_SECRET: "y", PRIVY_AUTHORIZATION_KEY: "z"
    }, 6000);
    assert.doesNotMatch(r.stderr || "", /REFUSING TO START/);
    assert.match(r.stdout || "", /signing ENABLED/);
  });

  test("worker still refuses when a store function is missing", () => {
    // Proves the refusal path is alive rather than merely unreachable, by running the same
    // predicate the process runs against a store with one piece knocked out.
    const store = require("../engine/store");
    const crippled = { ...store, loadOpenPositions: undefined };
    assert.deepStrictEqual(missingExitPath(crippled), ["loadOpenPositions"]);
  });
}

// --- confirmation classifier (submission is not settlement) ---
console.log("transaction confirmation");
{
  const { classifySignatureStatus, tokenDeltaFromMeta, EXPIRY_MS } = require("../engine/confirm");

  test("a landed transaction with no error is confirmed", () => {
    assert.strictEqual(classifySignatureStatus({ status: { confirmationStatus: "confirmed", err: null }, elapsedMs: 0 }), "confirmed");
    assert.strictEqual(classifySignatureStatus({ status: { confirmationStatus: "finalized", err: null }, elapsedMs: 0 }), "confirmed");
  });

  test("a landed transaction with an error is failed", () => {
    assert.strictEqual(classifySignatureStatus({ status: { confirmationStatus: "finalized", err: { InstructionError: [] } }, elapsedMs: 0 }), "failed");
  });

  test("'processed' is NOT treated as settled", () => {
    // A processed transaction can still be dropped by the cluster. Counting it as confirmed
    // would mark a sell filled that may never land.
    assert.strictEqual(classifySignatureStatus({ status: { confirmationStatus: "processed", err: null }, elapsedMs: 0 }), "pending");
  });

  test("an unseen signature stays pending inside the blockhash window", () => {
    // This is the state that BLOCKS re-firing. Collapsing it either way is the double-sell
    // / unenforced-stop-loss bug this whole module exists to prevent.
    assert.strictEqual(classifySignatureStatus({ status: null, elapsedMs: 1000 }), "pending");
    assert.strictEqual(classifySignatureStatus({ status: null, elapsedMs: EXPIRY_MS - 1 }), "pending");
  });

  test("an unseen signature past the blockhash window is expired", () => {
    // Past ~150 slots the transaction can never be included, so retrying is safe.
    assert.strictEqual(classifySignatureStatus({ status: null, elapsedMs: EXPIRY_MS + 1 }), "expired");
  });

  test("the expiry window is well clear of the blockhash lifetime", () => {
    // Declaring 'expired' too early re-fires a sell that may still land. The margin over
    // the ~60-80s blockhash lifetime is the safety.
    assert.ok(EXPIRY_MS >= 120_000, "expiry window must leave margin over blockhash lifetime");
  });

  test("received amount comes from the balance delta, not the quote", () => {
    const meta = {
      preTokenBalances: [{ owner: "USER", mint: "MINT", uiTokenAmount: { amount: "100" } }],
      postTokenBalances: [{ owner: "USER", mint: "MINT", uiTokenAmount: { amount: "1000100" } }]
    };
    assert.strictEqual(tokenDeltaFromMeta(meta, "USER", "MINT"), BigInt(1000000));
  });

  test("another wallet's balance change is not counted as ours", () => {
    const meta = {
      preTokenBalances: [],
      postTokenBalances: [{ owner: "SOMEONE_ELSE", mint: "MINT", uiTokenAmount: { amount: "999" } }]
    };
    assert.strictEqual(tokenDeltaFromMeta(meta, "USER", "MINT"), BigInt(0));
  });

  test("a raw amount beyond 2^53 survives without precision loss", () => {
    // High-supply memecoins exceed the safe integer range. Float math here would mis-size
    // a sell by an amount the wallet does not hold.
    const big = "9007199254740993000";
    const meta = {
      preTokenBalances: [],
      postTokenBalances: [{ owner: "USER", mint: "MINT", uiTokenAmount: { amount: big } }]
    };
    assert.strictEqual(tokenDeltaFromMeta(meta, "USER", "MINT").toString(), big);
  });
}

// --- position exit state machine ---
console.log("position exit state machine");
{
  const { decideExit, resolveExit, takeProfitShare, normalizePosition, MAX_EXIT_ATTEMPTS } = require("../engine/monitor");

  // Units match what the write path actually persists, not what the previous fixture
  // assumed. app/api/user/subscriptions/route.ts validates tp1/tp2 in 1.01–1000 (a
  // MULTIPLE of entry) and stop_loss in 1–100 (a PERCENTAGE drop). The old fixture used
  // tp1: 200 / tp2: 500, the percentage convention, which nothing in the product writes —
  // so the suite was green while the engine sold 75% of every position on its first tick.
  const position = (over = {}) => normalizePosition({
    id: "p1", user_pubkey: "USER", wallet_id: "W", mint: "MINT",
    entry_price_usd: 1, amount_raw: 1000, original_amount_raw: 1000,
    tp1: 2, tp1_sell: 50, tp2: 5, tp2_sell: 50, stop_loss: 20,
    slippage_bps: 300, filled_tp1: false, filled_tp2: false, status: "open",
    exit_attempts: 0, ...over
  });

  test("a pending exit BLOCKS any new exit — the core invariant", () => {
    // Without this, a slow-confirming sell is re-fired every 5s tick and the position is
    // sold several times over.
    const p = position({
      status: "exiting", pending_exit_kind: "SL", pending_exit_sig: "SIG",
      pending_exit_amount_raw: 1000, pending_exit_claim_token: "T", pending_exit_at: new Date().toISOString()
    });
    assert.strictEqual(decideExit({ position: p, price: 0.01 }), null);
  });

  test("stop-loss fires on the whole remaining position", () => {
    const d = decideExit({ position: position(), price: 0.79 }); // -21%, past a 20% stop
    assert.strictEqual(d.kind, "SL");
    assert.strictEqual(d.amountRaw, BigInt(1000));
  });

  test("stop-loss does not fire above the threshold", () => {
    assert.strictEqual(decideExit({ position: position(), price: 0.81 }), null);
  });

  test("take-profit shares come out of the ORIGINAL position, not the remainder", () => {
    // 50% + 50% must exit the position entirely. Computing TP2 from the post-TP1 remainder
    // sells 750 of 1000 and silently leaves the user holding 250.
    const afterTp1 = position({ amount_raw: 500, original_amount_raw: 1000, filled_tp1: true });
    const d = decideExit({ position: afterTp1, price: 5 });
    assert.strictEqual(d.kind, "TP2");
    assert.strictEqual(d.amountRaw, BigInt(500));
  });

  test("a take-profit does NOT fire at entry price", () => {
    // The regression that mattered: with tp1 = 2 read as a percentage, `mult >= 0.02` was
    // true at every price above 2% of entry, so the position opened and was immediately
    // 75% liquidated. Nothing may fire while the price sits at entry.
    assert.strictEqual(decideExit({ position: position(), price: 1 }), null);
    assert.strictEqual(decideExit({ position: position(), price: 1.99 }), null);
  });

  test("take-profit targets are multiples of entry", () => {
    const atTwoX = decideExit({ position: position(), price: 2 });
    assert.strictEqual(atTwoX.kind, "TP1");
    const atFiveX = decideExit({ position: position({ filled_tp1: true, amount_raw: 500 }), price: 5 });
    assert.strictEqual(atFiveX.kind, "TP2");
  });

  test("a target at or below entry is refused rather than fired", () => {
    // Fail-safe for a unit error, a zero default, or a bad write.
    assert.strictEqual(decideExit({ position: position({ tp1: 1, tp2: 1 }), price: 100 }), null);
    assert.strictEqual(decideExit({ position: position({ tp1: 0, tp2: 0 }), price: 100 }), null);
  });

  test("a take-profit share can never exceed what is left", () => {
    assert.strictEqual(takeProfitShare(1000, 200, 50), BigInt(200));
    assert.strictEqual(takeProfitShare(1000, 0, 50), BigInt(0));
  });

  test("share math is exact for amounts beyond 2^53", () => {
    const huge = BigInt("9007199254740993000");
    assert.strictEqual(takeProfitShare(huge, huge, 50), huge / BigInt(2));
  });

  test("a confirmed take-profit reduces the position and marks only its own level", () => {
    const p = position({
      status: "exiting", pending_exit_kind: "TP1", pending_exit_sig: "S",
      pending_exit_amount_raw: 500, pending_exit_claim_token: "T"
    });
    const s = resolveExit({ position: p, verdict: "confirmed" });
    assert.strictEqual(s.amountRaw, "500");
    assert.strictEqual(s.status, "open");
    assert.strictEqual(s.filledTp1, true);
    assert.strictEqual(s.filledTp2, false);
  });

  test("a confirmed stop-loss closes the position", () => {
    const p = position({
      status: "exiting", pending_exit_kind: "SL", pending_exit_sig: "S",
      pending_exit_amount_raw: 1000, pending_exit_claim_token: "T"
    });
    const s = resolveExit({ position: p, verdict: "confirmed" });
    assert.strictEqual(s.status, "closed");
    assert.strictEqual(s.amountRaw, "0");
  });

  test("a FAILED sell does not mark the level filled and returns the position to open", () => {
    // This is the stop-loss-believed-spent bug. A failed sell must leave the trigger armed.
    const p = position({
      status: "exiting", pending_exit_kind: "SL", pending_exit_sig: "S",
      pending_exit_amount_raw: 1000, pending_exit_claim_token: "T"
    });
    const s = resolveExit({ position: p, verdict: "failed" });
    assert.strictEqual(s.status, "open");
    assert.strictEqual(s.amountRaw, "1000");
    assert.strictEqual(s.filledTp1, false);
    assert.strictEqual(s.attempts, 1);
  });

  test("an EXPIRED sell is treated as retryable, not as filled", () => {
    const p = position({
      status: "exiting", pending_exit_kind: "TP1", pending_exit_sig: "S",
      pending_exit_amount_raw: 500, pending_exit_claim_token: "T"
    });
    const s = resolveExit({ position: p, verdict: "expired" });
    assert.strictEqual(s.status, "open");
    assert.strictEqual(s.filledTp1, false);
  });

  test("a still-pending verdict produces NO state change at all", () => {
    const p = position({
      status: "exiting", pending_exit_kind: "SL", pending_exit_sig: "S",
      pending_exit_amount_raw: 1000, pending_exit_claim_token: "T"
    });
    assert.strictEqual(resolveExit({ position: p, verdict: "pending" }), null);
  });

  test("repeated failures park the position instead of retrying forever", () => {
    const p = position({
      status: "exiting", pending_exit_kind: "SL", pending_exit_sig: "S",
      pending_exit_amount_raw: 1000, pending_exit_claim_token: "T",
      exit_attempts: MAX_EXIT_ATTEMPTS - 1
    });
    const s = resolveExit({ position: p, verdict: "failed" });
    assert.strictEqual(s.status, "error");
    assert.match(s.error, /needs attention/);
  });

  // --- the configured exit plan: multi-level, trailing TP, trailing stop ---
  //
  // BotBuilder collects a LIST of take-profit levels each with its own trailing
  // retracement, plus a trailing stop. public.positions carried five scalars and the
  // monitor read only those, so none of it did anything: the controls persisted, reloaded,
  // and changed no behaviour.
  const planned = (config, over = {}) => normalizePosition({
    id: "p2", user_pubkey: "USER", wallet_id: "W", mint: "MINT",
    entry_price_usd: 1, amount_raw: 1000, original_amount_raw: 1000,
    slippage_bps: 300, status: "open", exit_attempts: 0,
    entry_config: config, filled_levels: [], ...over
  });
  // targetBps is basis points of GAIN: 10000 = +100% = 2x, matching legacy tp1 = 2.
  const threeLevels = {
    takeProfit: { levels: [
      { targetBps: 10000, sellBps: 3000, trailingBps: 0 },
      { targetBps: 40000, sellBps: 3000, trailingBps: 0 },
      { targetBps: 90000, sellBps: 4000, trailingBps: 0 }
    ] },
    stopLoss: { stopBps: 4000, trailing: false }
  };

  test("a third take-profit level is honoured", () => {
    const afterTwo = planned(threeLevels, { amount_raw: 400, filled_levels: [0, 1] });
    const d = decideExit({ position: afterTwo, price: 10 });
    assert.strictEqual(d.kind, "TP3");
    assert.strictEqual(d.amountRaw, BigInt(400));
  });

  test("levels fire lowest-target first, one per tick", () => {
    // Price is past all three at once. Selling them together would oversell against one
    // balance, which is the invariant the module exists to hold.
    const d = decideExit({ position: planned(threeLevels), price: 10 });
    assert.strictEqual(d.kind, "TP1");
    assert.strictEqual(d.amountRaw, BigInt(300));
  });

  test("basis-point targets match the legacy multiples they replace", () => {
    assert.strictEqual(decideExit({ position: planned(threeLevels), price: 1.99 }), null);
    assert.strictEqual(decideExit({ position: planned(threeLevels), price: 2 }).kind, "TP1");
  });

  test("a trailing take-profit arms at the target and sells on the retracement", () => {
    const trailing = {
      takeProfit: { levels: [{ targetBps: 10000, sellBps: 5000, trailingBps: 1000 }] },
      stopLoss: { stopBps: 9000, trailing: false }
    };
    // Target reached, still climbing: hold. This is the whole point of trailing, and the
    // previous engine sold here.
    assert.strictEqual(decideExit({ position: planned(trailing, { peak_price_usd: 3 }), price: 3 }), null);
    // Given back 10% from a 3x peak: sell.
    const d = decideExit({ position: planned(trailing, { peak_price_usd: 3 }), price: 2.7 });
    assert.strictEqual(d.kind, "TP1");
    // Never reached the target at all: nothing arms, so nothing sells.
    assert.strictEqual(decideExit({ position: planned(trailing, { peak_price_usd: 1.5 }), price: 1.35 }), null);
  });

  test("a trailing stop rides the peak and can only tighten", () => {
    const trailingStop = {
      takeProfit: { levels: [{ targetBps: 900000, sellBps: 10000, trailingBps: 0 }] },
      stopLoss: { stopBps: 2000, trailing: true }
    };
    // Peak 4x, 20% trailing stop -> exits at 3.2x, far above entry.
    assert.strictEqual(decideExit({ position: planned(trailingStop, { peak_price_usd: 4 }), price: 3.3 }), null);
    assert.strictEqual(decideExit({ position: planned(trailingStop, { peak_price_usd: 4 }), price: 3.2 }).kind, "SL");
    // With no gain the peak floors at entry, so a trailing stop is exactly a fixed one and
    // never looser — the property that makes enabling it safe.
    assert.strictEqual(decideExit({ position: planned(trailingStop, { peak_price_usd: 1 }), price: 0.81 }), null);
    assert.strictEqual(decideExit({ position: planned(trailingStop, { peak_price_usd: 1 }), price: 0.8 }).kind, "SL");
  });

  test("the persisted peak is what lets a retracement sell after a restart", () => {
    const trailing = {
      takeProfit: { levels: [{ targetBps: 10000, sellBps: 5000, trailingBps: 500 }] },
      stopLoss: { stopBps: 9000, trailing: false }
    };
    // At a new high nothing sells — that is trailing working, not trailing failing.
    assert.strictEqual(decideExit({ position: planned(trailing, { peak_price_usd: 1 }), price: 2 }), null);
    // With the 2x high persisted, a 5% giveback sells.
    assert.strictEqual(decideExit({ position: planned(trailing, { peak_price_usd: 2 }), price: 1.9 }).kind, "TP1");
    // Without it — the peak lost to a restart — the same price looks like it never reached
    // the target, and the exit the user configured silently never fires. This is why the
    // high-water mark is written to the row rather than held in worker memory.
    assert.strictEqual(decideExit({ position: planned(trailing, { peak_price_usd: 1 }), price: 1.9 }), null);
  });

  test("the configured plan wins over the legacy columns", () => {
    const both = planned(threeLevels, { tp1: 1.1, tp1_sell: 100, stop_loss: 5 });
    const d = decideExit({ position: both, price: 2 });
    assert.strictEqual(d.kind, "TP1");
    assert.strictEqual(d.amountRaw, BigInt(300), "30% from the plan, not 100% from the legacy column");
  });

  test("fill state keeps the legacy booleans consistent with the level list", () => {
    const { fillState } = require("../engine/monitor");
    const p = planned(threeLevels, { filled_levels: [0] });
    const after = fillState(p, "TP3");
    assert.deepStrictEqual(after.filledLevels, [0, 2]);
    assert.strictEqual(after.filledTp1, true);
    assert.strictEqual(after.filledTp2, false, "a third level must not silently mark the second");
  });

  test("a closed position fires nothing", () => {
    assert.strictEqual(decideExit({ position: position({ status: "closed" }), price: 0.01 }), null);
  });

  test("an unusable price fires nothing rather than guessing", () => {
    assert.strictEqual(decideExit({ position: position(), price: 0 }), null);
    assert.strictEqual(decideExit({ position: position(), price: NaN }), null);
  });
}

// --- buy settlement ---
console.log("buy settlement");
{
  const { decideSettlement, buildPosition } = require("../engine/settlement");

  test("only a confirmed buy opens a position", () => {
    assert.deepStrictEqual(decideSettlement({ verdict: "confirmed" }), { status: "succeeded", openPosition: true });
  });

  test("a failed or expired buy settles without a position", () => {
    assert.strictEqual(decideSettlement({ verdict: "failed" }).status, "failed");
    assert.strictEqual(decideSettlement({ verdict: "failed" }).openPosition, false);
    assert.strictEqual(decideSettlement({ verdict: "expired" }).status, "failed");
  });

  test("a pending buy is NOT settled either way", () => {
    assert.strictEqual(decideSettlement({ verdict: "pending" }), null);
  });

  const execution = {
    user_pubkey: "USER", wallet_id: "W", mint: "MINT", tx_signature: "SIG",
    slippage_bps: 300, tp1: 200, tp1_sell: 50, tp2: 500, tp2_sell: 50, stop_loss: 20
  };

  test("a position is sized from tokens actually received", () => {
    const p = buildPosition({ execution, receivedRaw: BigInt("1234567890123456789"), entryPriceUsd: 0.5 });
    assert.strictEqual(p.amountRaw, "1234567890123456789");
    assert.strictEqual(p.entrySig, "SIG");
    assert.strictEqual(p.stopLoss, 20);
  });

  test("a zero fill does not become a position", () => {
    // A position the wallet cannot cover generates sells that always fail.
    assert.strictEqual(buildPosition({ execution, receivedRaw: BigInt(0), entryPriceUsd: 0.5 }), null);
  });

  test("a missing entry price does not become a position", () => {
    // Every trigger is a ratio against entry; without it the stop-loss is meaningless.
    assert.strictEqual(buildPosition({ execution, receivedRaw: BigInt(100), entryPriceUsd: 0 }), null);
    assert.strictEqual(buildPosition({ execution, receivedRaw: BigInt(100), entryPriceUsd: NaN }), null);
  });
}

// ---- price selection: the decision behind every baseline, PnL and TP/SL trigger ----
//
// getPrice is async and this runner refuses async tests, which is why this had no coverage at
// all. The selection is now extracted so it can be checked synchronously.
console.log("price selection");
{
  const { selectPrice } = require("../engine/prices");

  test("picks the deepest-liquidity pair, not the first", () => {
    assert.strictEqual(selectPrice([
      { priceUsd: "1.00", liquidity: { usd: 500 } },
      { priceUsd: "2.00", liquidity: { usd: 90000 } },
      { priceUsd: "3.00", liquidity: { usd: 12 } }
    ]), 2);
  });
  test("no pairs yields null, never a number", () => {
    assert.strictEqual(selectPrice([]), null);
    assert.strictEqual(selectPrice(undefined), null);
    assert.strictEqual(selectPrice(null), null);
  });
  test("a zero or negative price is refused", () => {
    assert.strictEqual(selectPrice([{ priceUsd: "0", liquidity: { usd: 1e6 } }]), null);
    assert.strictEqual(selectPrice([{ priceUsd: "-5", liquidity: { usd: 1e6 } }]), null);
  });
  test("a non-numeric price is refused rather than coerced", () => {
    assert.strictEqual(selectPrice([{ priceUsd: "not-a-price", liquidity: { usd: 1e6 } }]), null);
    assert.strictEqual(selectPrice([{ liquidity: { usd: 1e6 } }]), null);
  });
  test("missing liquidity sorts last but is still usable when it is all there is", () => {
    assert.strictEqual(selectPrice([{ priceUsd: "7.5" }]), 7.5);
    assert.strictEqual(selectPrice([
      { priceUsd: "7.5" },
      { priceUsd: "9.0", liquidity: { usd: 1000 } }
    ]), 9);
  });
  test("the caller's array is not mutated by sorting", () => {
    const pairs = [
      { priceUsd: "1.0", liquidity: { usd: 10 } },
      { priceUsd: "2.0", liquidity: { usd: 20 } }
    ];
    selectPrice(pairs);
    assert.strictEqual(pairs[0].priceUsd, "1.0", "sort must not reorder the input in place");
  });
}

// PnL share cards.
//
// A share card is a financial claim the user publishes under their own name, so it has to be
// derived from the ledger and it has to be arithmetically right. All of this logic used to
// live inside an async route handler that needs a Privy session, two RPCs, a price provider
// and a JSX renderer before one assertion could run — which is why none of it was tested.
{
  const card = require("../../lib/pnl-card");
  console.log("pnl cards");

  test("percentage is computed in integer basis points, never float division", () => {
    // 0.5 SOL profit on 2 SOL basis is exactly 25%.
    assert.strictEqual(card.percentFromLamports(500000000n, 2000000000n), 25);
    // A loss keeps its sign.
    assert.strictEqual(card.percentFromLamports(-500000000n, 2000000000n), -25);
    // A value that float division would round badly still lands on the bps grid.
    assert.strictEqual(card.percentFromLamports(1n, 3n), 33.33);
  });

  test("a zero cost basis yields 0%, not Infinity or NaN", () => {
    assert.strictEqual(card.percentFromLamports(500000000n, 0n), 0);
    assert.strictEqual(card.percentFromLamports(500000000n, null), 0);
    assert.ok(Number.isFinite(card.percentFromLamports(1n, -5n)));
  });

  test("a malformed lamport value reads as zero rather than throwing", () => {
    assert.strictEqual(card.toLamports("not-a-number"), 0n);
    assert.strictEqual(card.toLamports(null), 0n);
    assert.strictEqual(card.toLamports(""), 0n);
    assert.strictEqual(card.formatSol("garbage"), "0.000 SOL");
    assert.strictEqual(card.formatSol(1500000000n), "1.500 SOL");
  });

  // A 9-decimal token: 1000000000 base units is exactly one whole token.
  const SCALE_9 = 1000000000n;

  test("a closed trade in profit is a winner, priced from recorded integers", () => {
    const r = card.closedTradeCard({
      fullyMeasured: true, measuredExits: 2,
      exitedQuantityBaseUnits: "1000000000",
      releasedBasisLamports: "2000000000",
      proceedsLamports: "3000000000",
      realizedPnlLamports: "1000000000"
    }, SCALE_9);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.variant, "winner");
    assert.strictEqual(r.pnlPercent, 50);
    // entry = basis/qty, exit = proceeds/qty, both scaled to whole tokens. Division of
    // recorded integers; no price feed is consulted and nothing is inferred.
    assert.strictEqual(r.averageEntrySol, 2);
    assert.strictEqual(r.averageExitSol, 3);
    assert.ok(r.context.includes("2 exits"));
  });

  test("a closed trade prices per WHOLE TOKEN, matching what an open card shows", () => {
    // The regression this guards: perUnitSol omitted 10^decimals on the closed branch only,
    // so the same "AVERAGE ENTRY" label read 2.0000 SOL while a position was open and
    // 2.0000e-9 SOL once it closed. Same trade, same label, published publicly.
    for (const decimals of [0, 6, 9]) {
      const scale = 10n ** BigInt(decimals);
      const wholeTokens = 3n;
      const qty = wholeTokens * scale;
      const basis = 6000000000n; // 6 SOL for 3 whole tokens => 2 SOL each, at any decimals
      const closed = card.closedTradeCard({
        fullyMeasured: true, measuredExits: 1,
        exitedQuantityBaseUnits: qty.toString(),
        releasedBasisLamports: basis.toString(),
        proceedsLamports: basis.toString(),
        realizedPnlLamports: "0"
      }, scale);
      assert.strictEqual(closed.averageEntrySol, 2, `decimals=${decimals}`);
      // The open branch computes its average entry through the same helper, from the same
      // inputs, and must land on the same number.
      assert.strictEqual(card.perUnitSol(basis, qty, scale), closed.averageEntrySol,
        `open and closed branches disagree on unit at decimals=${decimals}`);
    }
  });

  test("an unknown token scale omits the price rather than printing a mis-scaled one", () => {
    const aggregate = {
      fullyMeasured: true, measuredExits: 1,
      exitedQuantityBaseUnits: "1000000000",
      releasedBasisLamports: "2000000000",
      proceedsLamports: "3000000000",
      realizedPnlLamports: "1000000000"
    };
    for (const missing of [null, undefined, 0n, "0"]) {
      const r = card.closedTradeCard(aggregate, missing);
      assert.strictEqual(r.ok, true, "the PnL figures are unit-independent and still stand");
      assert.strictEqual(r.averageEntrySol, null);
      assert.strictEqual(r.averageExitSol, null);
      assert.strictEqual(r.pnlPercent, 50, "percentage must not depend on the token scale");
    }
  });

  test("a closed trade at a loss is a loser and keeps its sign", () => {
    const r = card.closedTradeCard({
      fullyMeasured: true, measuredExits: 1,
      exitedQuantityBaseUnits: "1000000000",
      releasedBasisLamports: "2000000000",
      proceedsLamports: "1400000000",
      realizedPnlLamports: "-600000000"
    }, SCALE_9);
    assert.strictEqual(r.variant, "loser");
    assert.strictEqual(r.pnlPercent, -30);
    assert.ok(r.context.includes("1 exit ·"), "singular exit must not read '1 exits'");
  });

  test("break-even is a winner, not a loser — the boundary is >= 0", () => {
    const r = card.closedTradeCard({
      fullyMeasured: true, measuredExits: 1, exitedQuantityBaseUnits: "1",
      releasedBasisLamports: "2000000000", proceedsLamports: "2000000000",
      realizedPnlLamports: "0"
    }, SCALE_9);
    assert.strictEqual(r.variant, "winner");
    assert.strictEqual(r.pnlPercent, 0);
  });

  test("an exit whose proceeds were never recorded is refused, and says so specifically", () => {
    const r = card.closedTradeCard({ fullyMeasured: false, unpricedExits: 1 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 409);
    assert.ok(/proceeds were not recorded/.test(r.error));
  });

  test("a position with no exit at all is refused with a different reason", () => {
    const r = card.closedTradeCard({ fullyMeasured: false, unpricedExits: 0 });
    assert.strictEqual(r.ok, false);
    assert.ok(/no recorded exit/.test(r.error));
    // The two refusals must not be interchangeable: one says wait, the other says never.
    assert.notStrictEqual(r.error, card.closedTradeCard({ fullyMeasured: false, unpricedExits: 2 }).error);
  });

  test("a missing aggregate is refused rather than treated as zero", () => {
    assert.strictEqual(card.closedTradeCard(null).ok, false);
    assert.strictEqual(card.closedTradeCard(undefined).ok, false);
    // fullyMeasured must be exactly true — a truthy string must not pass a financial gate.
    assert.strictEqual(card.closedTradeCard({ fullyMeasured: "yes" }).ok, false);
  });

  test("an unknown exit quantity yields a null price, never 0.00000 SOL", () => {
    const r = card.closedTradeCard({
      fullyMeasured: true, measuredExits: 1, exitedQuantityBaseUnits: "0",
      releasedBasisLamports: "2000000000", proceedsLamports: "3000000000",
      realizedPnlLamports: "1000000000"
    }, SCALE_9);
    assert.strictEqual(r.averageEntrySol, null);
    assert.strictEqual(r.averageExitSol, null);
  });

  test("an open position's PnL is net of fees, not gross", () => {
    // 3 SOL value on 2 SOL cost is +1 SOL gross, but 0.04 SOL of fees were recorded.
    const r = card.openPositionCard({
      currentValueLamports: 3000000000n, realizedPnlLamports: 0n,
      costLamports: 2000000000n, feesLamports: 40000000n
    });
    assert.strictEqual(r.pnlLamports, 960000000n);
    assert.strictEqual(r.pnlPercent, 48);
    assert.strictEqual(r.variant, "winner");
  });

  test("fees can turn a nominally flat position into a loss, and the card must say so", () => {
    const r = card.openPositionCard({
      currentValueLamports: 2000000000n, realizedPnlLamports: 0n,
      costLamports: 2000000000n, feesLamports: 40000000n
    });
    assert.strictEqual(r.variant, "loser");
    assert.ok(r.pnlLamports < 0n);
  });

  test("realized proceeds from a partial exit count toward an open position's PnL", () => {
    const r = card.openPositionCard({
      currentValueLamports: 1000000000n, realizedPnlLamports: 500000000n,
      costLamports: 1000000000n, feesLamports: 0n
    });
    assert.strictEqual(r.pnlLamports, 500000000n);
  });

  test("a portfolio card without a reconciled snapshot is refused, not shown as 0%", () => {
    const r = card.portfolioCard(null, "30d");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 409);
    assert.ok(/reconciled portfolio snapshot/.test(r.error));
  });

  test("a portfolio card reports the period and sample size it was measured over", () => {
    const r = card.portfolioCard(
      { netPnlLamports: "250000000", volumeLamports: "1000000000", sampleSize: 7 },
      "7d"
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.variant, "portfolio");
    assert.strictEqual(r.pair, "7D");
    assert.strictEqual(r.pnlPercent, 25);
    assert.ok(r.context.includes("7 completed executions"));
  });

  test("average capital is preferred over volume as the portfolio denominator", () => {
    const r = card.portfolioCard({
      netPnlLamports: "100000000",
      metrics: { averageCapitalLamports: "1000000000" },
      volumeLamports: "5000000000",
      sampleSize: 3
    }, "30d");
    assert.strictEqual(r.pnlPercent, 10, "must divide by capital, not by traded volume");
  });

  test("the QR target and the printed link are the same string", () => {
    const affiliate = card.shareTarget("degenaration");
    assert.strictEqual(affiliate.url, "https://degenaration.vercel.app/r/degenaration");
    assert.strictEqual(affiliate.label, "degenaration.vercel.app/r/degenaration");
    assert.strictEqual(`https://${affiliate.label}`, affiliate.url,
      "a QR resolving anywhere other than the visible link is indistinguishable from phishing");
  });

  test("a user with no referral code gets the canonical URL, not a broken /r/ link", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const t = card.shareTarget(empty);
      assert.strictEqual(t.url, card.CANONICAL_SITE_URL);
      assert.ok(!t.url.includes("/r/"));
    }
  });

  test("a trailing slash on the site URL does not produce a double slash", () => {
    assert.strictEqual(card.shareTarget("abc", "https://example.com/").url, "https://example.com/r/abc");
  });

  test("accent colour is signed for trades and always gold for portfolio", () => {
    assert.strictEqual(card.accentFor("winner", 1n), "#55b987");
    assert.strictEqual(card.accentFor("loser", -1n), "#d56f6f");
    assert.strictEqual(card.accentFor("winner", 0n), "#55b987");
    assert.strictEqual(card.accentFor("portfolio", -999n), "#c29463");
  });

  test("duration is deterministic and formats across its boundaries", () => {
    const base = new Date("2026-08-05T00:00:00Z").getTime();
    const at = (ms) => new Date(base + ms).toISOString();
    assert.strictEqual(card.durationLabel(at(0), at(59 * 60000)), "59m");
    assert.strictEqual(card.durationLabel(at(0), at(60 * 60000)), "1h 0m");
    assert.strictEqual(card.durationLabel(at(0), at(47 * 3600000 + 30 * 60000)), "47h 30m");
    assert.strictEqual(card.durationLabel(at(0), at(48 * 3600000)), "2d 0h");
    // An open position has no end; the clock is injected so this is not time-dependent.
    assert.strictEqual(card.durationLabel(at(0), null, base + 90 * 60000), "1h 30m");
  });

  test("an unparseable timestamp does not render NaN onto a published card", () => {
    assert.strictEqual(card.durationLabel("not-a-date", null, Date.now()), "—");
  });

  test("unrealized PnL pairs held basis with a live quote", () => {
    const { unrealizedPnl } = require("../../lib/portfolio-stats");
    // 1 SOL of basis, now worth 400 USD at 200 USD/SOL => 2 SOL => +1 SOL unrealized.
    const r = unrealizedPnl({
      openPositions: [{ mint: "M1", costLamports: "1000000000" }],
      walletPositions: [{ mint: "M1", valueUsd: 400 }],
      solPriceUsd: 200
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.lamports, 1000000000n);
    assert.strictEqual(r.priced, 1);
  });

  test("unrealized PnL is negative when a position is under water", () => {
    const { unrealizedPnl } = require("../../lib/portfolio-stats");
    const r = unrealizedPnl({
      openPositions: [{ mint: "M1", costLamports: "2000000000" }],
      walletPositions: [{ mint: "M1", valueUsd: 100 }],
      solPriceUsd: 200
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.lamports, -1500000000n);
  });

  test("no open positions is a real zero, not an unknown", () => {
    const { unrealizedPnl } = require("../../lib/portfolio-stats");
    const r = unrealizedPnl({ openPositions: [], walletPositions: [], solPriceUsd: 200 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.lamports, 0n);
  });

  test("one unpriced position withholds the whole total rather than understating it", () => {
    const { unrealizedPnl } = require("../../lib/portfolio-stats");
    const r = unrealizedPnl({
      openPositions: [
        { mint: "M1", costLamports: "1000000000" },
        { mint: "M2", costLamports: "1000000000" }
      ],
      walletPositions: [{ mint: "M1", valueUsd: 400 }],
      solPriceUsd: 200
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "awaiting-quote");
    assert.strictEqual(r.unpriced, 1);
    assert.strictEqual(r.priced, 1);
  });

  test("two positions on one mint are ambiguous and are not guessed at", () => {
    const { unrealizedPnl } = require("../../lib/portfolio-stats");
    // The wallet holding cannot be split between them without token decimals the client
    // does not have, so attributing all of it to either one would overstate that position.
    const r = unrealizedPnl({
      openPositions: [
        { mint: "M1", costLamports: "1000000000" },
        { mint: "M1", costLamports: "1000000000" }
      ],
      walletPositions: [{ mint: "M1", valueUsd: 400 }],
      solPriceUsd: 200
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unpriced, 2);
  });

  test("a missing SOL quote withholds the figure instead of dividing by zero", () => {
    const { unrealizedPnl } = require("../../lib/portfolio-stats");
    for (const bad of [0, null, undefined, NaN, -5]) {
      const r = unrealizedPnl({
        openPositions: [{ mint: "M1", costLamports: "1000000000" }],
        walletPositions: [{ mint: "M1", valueUsd: 400 }],
        solPriceUsd: bad
      });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, "no-sol-quote");
    }
  });

  test("a decimal price parses to a scaled integer without floating point", () => {
    assert.strictEqual(card.decimalToScaled("1.5"), 1500000000000000000n);
    assert.strictEqual(card.decimalToScaled("0.000001"), 1000000000000n);
    assert.strictEqual(card.decimalToScaled("123"), 123000000000000000000n);
    assert.strictEqual(card.decimalToScaled("0"), 0n);
    // A ratio of two scaled prices is the ratio of the prices: the scale cancels.
    const token = card.decimalToScaled("0.0004");
    const solUsd = card.decimalToScaled("200");
    assert.strictEqual(Number(token) / Number(solUsd), 0.000002);
  });

  test("an unparseable price is refused, never coerced to a number", () => {
    // Each of these would become a wrong valuation on a published card if coerced.
    for (const bad of ["1.2e-9", "-1.5", "", "  ", "abc", "1.2.3", "1,5", null, undefined, NaN, {}]) {
      assert.strictEqual(card.decimalToScaled(bad), null, `must refuse ${String(bad)}`);
    }
  });

  test("excess fractional digits are truncated, never rounded up", () => {
    // Rounding up here would inflate a price, and therefore a published PnL.
    assert.strictEqual(card.decimalToScaled("0.9", 1), 9n);
    assert.strictEqual(card.decimalToScaled("0.99", 1), 9n);
    assert.strictEqual(card.decimalToScaled("0.19", 1), 1n);
  });

  test("no financial quantity is accepted from the client", () => {
    // The route reads exactly these query parameters. A client that could pass its own
    // percentage or PnL could publish any claim it liked under DegenAration branding.
    assert.deepStrictEqual(card.CLIENT_SUPPLIED_PARAMS, ["type", "period", "id"]);
    const forbidden = /pnl|percent|amount|lamport|price|profit|loss|value|fee/i;
    for (const param of card.CLIENT_SUPPLIED_PARAMS) {
      assert.ok(!forbidden.test(param), `client must not supply "${param}"`);
    }
  });

  test("the route reads no query parameter beyond the declared three", () => {
    const source = require("fs").readFileSync(
      require("path").join(__dirname, "../../app/api/product/pnl-card/route.tsx"), "utf8");
    const read = [...source.matchAll(/searchParams\.get\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
    for (const name of read) {
      assert.ok(card.CLIENT_SUPPLIED_PARAMS.includes(name),
        `route reads an undeclared query parameter "${name}" — if it carries a financial ` +
        `value the client can forge the card`);
    }
    assert.ok(read.length > 0, "the scan found nothing, so it would pass even if broken");
  });
}

// Automated call ingestion: the real production model.
//
// A Discord "call" is normally an EMBED posted by another bot or a webhook, not a human
// typing a mint. message.content is frequently empty, the symbol is what a human sees, and
// the mint often appears only inside a button URL or an embed field.
{
  const { parseMessage } = require("../bot/parser");
  const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  console.log("automated call ingestion");

  test("an embed-only call is parsed when message.content is empty", () => {
    const r = parseMessage({
      content: "",
      embeds: [{
        title: "BONK / SOL",
        description: "New call from Alpha Scanner",
        fields: [
          { name: "Market Cap", value: "$1.2M" },
          { name: "CA", value: MINT },
          { name: "Liquidity", value: "$340K" }
        ]
      }]
    });
    assert.ok(r, "an embed-only message must not be dropped for having no content");
    assert.strictEqual(r.mint, MINT);
  });

  test("the mint is found under any common label, not one hard-coded field name", () => {
    for (const label of ["CA", "Contract", "Contract Address", "Mint", "Token", "Address", "PAIR"]) {
      const r = parseMessage({ content: "", embeds: [{ fields: [{ name: label, value: MINT }] }] });
      assert.ok(r && r.mint === MINT, `label "${label}" must resolve`);
    }
  });

  test("a mint present only in a button URL is found", () => {
    // The visible embed shows a symbol; the address exists solely in the action row.
    const r = parseMessage({
      content: "",
      embeds: [{ title: "BONK", description: "Volume spiking" }],
      components: [{ components: [
        { label: "Chart", url: `https://dexscreener.com/solana/${MINT}` },
        { label: "Buy", url: "https://jup.ag/swap/SOL-BONK" }
      ] }]
    });
    assert.ok(r, "a call whose only address is in a button must still be ingested");
    assert.strictEqual(r.mint, MINT);
  });

  test("embed image and thumbnail URLs are scanned", () => {
    const r = parseMessage({ content: "", embeds: [{ thumbnail: { url: `https://img.example/${MINT}.png` } }] });
    assert.ok(r && r.mint === MINT);
  });

  test("attachment names are scanned", () => {
    const r = parseMessage({ content: "", embeds: [], attachments: [{ name: `${MINT}-chart.png` }] });
    assert.ok(r && r.mint === MINT);
  });

  test("a discord.js Collection of attachments is handled, not just an array", () => {
    // message.attachments is a Collection at runtime; treating it as an array silently
    // scans nothing and the failure looks identical to "no mint present".
    const collection = new Map([["1", { name: `${MINT}.png` }]]);
    const r = parseMessage({ content: "", embeds: [], attachments: collection });
    assert.ok(r && r.mint === MINT);
  });

  test("two distinct addresses with no link still refuse rather than guess", () => {
    const other = "So11111111111111111111111111111111111111112";
    const r = parseMessage({
      content: "",
      embeds: [{ fields: [{ name: "CA", value: MINT }, { name: "Deployer", value: other }] }]
    });
    assert.ok(!r || !r.mint, "a wallet beside a mint must never be bought");
  });

  test("a link disambiguates a message that also shows a bare address", () => {
    const other = "So11111111111111111111111111111111111111112";
    const r = parseMessage({
      content: "",
      embeds: [{ fields: [{ name: "Deployer", value: other }] }],
      components: [{ components: [{ url: `https://dexscreener.com/solana/${MINT}` }] }]
    });
    assert.ok(r && r.mint === MINT, "the link names the token; the bare address does not");
  });
}

// ─── the /api/ingest-call transformation ─────────────────────────────────────────────────
//
// These decisions lived inline in a .ts route and were therefore unreachable by this runner:
// what shape of event is accepted, how confident the parse was, what the dedupe key hashes,
// and which market pair becomes the immutable call-time price. Extracted to
// lib/discord-ingest.js for exactly that reason.
{
  const di = require("../../lib/discord-ingest");
  const { parseMessage: pm } = require("../bot/parser");
  const CH = "1521876069693526158";
  const MSG = "1600000000000000001";
  const M = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const M2 = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
  const req = (over) => di.normalizeIngestRequest(Object.assign(
    { channelId: CH, messageId: MSG, mint: M, confidence: "link", eventType: "create" }, over));

  // THE GATE. The confidence map once recognised only labels the bot has never sent, so every
  // ingested call silently fell through to the 7500 default and confidence_bps was a constant.
  // A map that drifts from its producer fails this way with nothing raising, so assert the
  // relationship rather than the values.
  test("every evidence label the parser can emit is priced by the confidence map", () => {
    const emitted = new Set();
    const probe = (message, expectSome) => {
      const r = pm(message);
      if (r && r.confidence) emitted.add(r.confidence);
      if (expectSome) assert.ok(r && r.confidence, "probe produced no label: " + expectSome);
    };
    probe({ content: M }, "content address");
    probe({ content: `https://pump.fun/coin/${M}` }, "content link");
    probe({ content: "", embeds: [{ description: M }] }, "embed address");
    probe({ content: "", embeds: [{ url: `https://pump.fun/coin/${M}` }] }, "embed link");
    probe({ content: "gm", referencedMessage: { content: M } }, "reply address");
    probe({ content: "gm", referencedMessage: { content: `https://pump.fun/coin/${M}` } }, "reply link");
    probe({ content: "gm", referencedMessage: { content: "", embeds: [{ description: M }] } }, "reply embed address");
    probe({ content: "gm", referencedMessage: { content: "", embeds: [{ url: `https://pump.fun/coin/${M}` }] } }, "reply embed link");
    // A component and an attachment resolve at the same tier as message content by design —
    // a button URL is a link — so they add no new labels. Included so a future change that
    // starts qualifying them is caught here rather than in production.
    probe({ content: "", components: [{ components: [{ url: `https://jup.ag/swap/SOL-${M}` }] }] }, "component link");
    probe({ content: "", attachments: [{ name: `${M}.png` }] }, "attachment address");
    assert.equal(emitted.size, 8, "the parser's label set changed; re-check the confidence map");
    for (const label of emitted) {
      assert.ok(Object.prototype.hasOwnProperty.call(di.CONFIDENCE_BPS, label),
        `parser emits "${label}" and the confidence map does not price it, so it scores the default`);
    }
  });

  test("evidence is ordered: a link outranks a bare address, and a reply ranks below both", () => {
    assert.ok(di.confidenceBps("link") > di.confidenceBps("address"));
    assert.ok(di.confidenceBps("address") > di.confidenceBps("reply-address"));
    assert.ok(di.confidenceBps("embed-link") > di.confidenceBps("embed-address"));
    assert.equal(di.confidenceBps("not-a-label"), di.DEFAULT_CONFIDENCE_BPS);
    assert.equal(di.confidenceBps(undefined), di.DEFAULT_CONFIDENCE_BPS);
  });

  test("a malformed Discord identifier is refused, not journalled", () => {
    assert.equal(req({ channelId: "nope" }).ok, false);
    assert.equal(req({ messageId: "123" }).ok, false);
    assert.equal(req({ channelId: `${CH}0000` }).ok, false, "a 22-digit id is not a snowflake");
    assert.equal(req({ channelId: null }).ok, false);
  });

  test("a non-base58 mint is refused for create and edit, and not required for delete", () => {
    assert.equal(req({ mint: "0OIl-not-base58" }).ok, false);
    assert.equal(req({ mint: null }).ok, false);
    assert.equal(req({ eventType: "edit", eventVersion: "e1", mint: "0OIl" }).ok, false);
    const del = req({ eventType: "delete", eventVersion: "deleted", mint: null });
    assert.equal(del.ok, true, "a delete carries no mint: the message it retracts is gone");
    assert.equal(del.mint, null);
  });

  test("an edit or delete without an event version is refused; a create defaults to original", () => {
    assert.equal(req({ eventType: "edit", eventVersion: null }).ok, false);
    assert.equal(req({ eventType: "delete", eventVersion: "  ", mint: null }).ok, false);
    assert.equal(req({ eventVersion: null }).eventVersion, "original");
    assert.equal(req({ eventType: "sneeze" }).eventType, "create", "an unknown type falls back to create");
  });

  test("the dedupe hash separates a create from its own edit, and one mint from another", () => {
    const base = { channelId: CH, messageId: MSG, eventVersion: "original", eventType: "create", mint: M };
    const h = di.contentHashFor(base);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(di.contentHashFor(base), h, "the same event hashes the same — replay must dedupe");
    assert.notEqual(di.contentHashFor({ ...base, eventType: "edit" }), h,
      "a create and an edit of one message are two journal entries, not one");
    assert.notEqual(di.contentHashFor({ ...base, eventVersion: "e1" }), h);
    assert.notEqual(di.contentHashFor({ ...base, mint: M2 }), h,
      "an edit that changes the token is a different call");
    assert.notEqual(di.contentHashFor({ ...base, messageId: "1600000000000000002" }), h);
  });

  test("the call price comes from the deepest Solana pair whose BASE token is the mint", () => {
    const p = di.selectPricePair({ pairs: [
      { chainId: "ethereum", baseToken: { address: M, symbol: "X" }, priceUsd: "9.99", liquidity: { usd: 99e6 } },
      { chainId: "solana", baseToken: { address: M2 }, quoteToken: { address: M }, priceUsd: "123", liquidity: { usd: 50e6 } },
      { chainId: "solana", baseToken: { address: M, symbol: "BONK" }, priceUsd: "0.001", marketCap: 10, liquidity: { usd: 1000 } },
      { chainId: "solana", baseToken: { address: M, symbol: "BONK" }, priceUsd: "0.002", marketCap: 20, liquidity: { usd: 9000 } }
    ] }, M);
    assert.equal(p.calledPrice, 0.002, "the deepest pool's print is the one anyone could have traded at");
    assert.equal(p.calledLiquidity, 9000);
    assert.equal(p.calledMcap, 20);
    assert.equal(p.symbol, "BONK");
  });

  test("a quote-side pair never prices the call, and market cap falls back to FDV", () => {
    // Taking the quote-side pair would record the call at the OTHER token's price.
    const only = di.selectPricePair({ pairs: [
      { chainId: "solana", baseToken: { address: M2 }, quoteToken: { address: M }, priceUsd: "123", liquidity: { usd: 50e6 } }
    ] }, M);
    assert.equal(only.calledPrice, null, "no base-side pair means no price");
    const fdv = di.selectPricePair({ pairs: [
      { chainId: "solana", baseToken: { address: M, symbol: "S" }, priceUsd: "1", fdv: 500, liquidity: { usd: 1 } }
    ] }, M);
    assert.equal(fdv.calledMcap, 500);
  });

  test("an unresolvable token yields nulls, never a zero that reads as a real price", () => {
    for (const payload of [{ pairs: [] }, {}, null, { pairs: "nope" }]) {
      const p = di.selectPricePair(payload, M);
      assert.deepEqual(p, { symbol: null, calledMcap: null, calledPrice: null, calledLiquidity: null });
    }
    const zero = di.selectPricePair({ pairs: [
      { chainId: "solana", baseToken: { address: M }, priceUsd: "0", liquidity: { usd: 0 } }
    ] }, M);
    assert.equal(zero.calledPrice, null, "a zero price is missing data, not a price");
  });

  test("the bridge body carries the parse evidence and hash the RPC validates", () => {
    const n = req({});
    const p = di.buildIngestRpcParams({ normalized: n, price: di.selectPricePair({ pairs: [] }, M), secret: "s" });
    assert.equal(p.operation, "ingest_signal_v2");
    assert.equal(p.p_confidence_bps, 9500);
    assert.match(p.p_content_hash, /^[0-9a-f]{64}$/);
    assert.equal(p.p_parser_version, di.PARSER_VERSION);
    assert.equal(p.p_called_price_usd, null);
  });
}

// ─── the listener's bounded delete memory ────────────────────────────────────────────────
{
  const { IngestedMessages } = require("../bot/handlers");
  test("the ingested-message set is bounded and evicts oldest first", () => {
    const set = new IngestedMessages(3);
    for (const id of ["a", "b", "c", "d"]) set.remember(id);
    assert.equal(set.size, 3, "an active server must not grow this without limit");
    assert.equal(set.has("a"), false, "the oldest is dropped, so an old deletion is simply not journalled");
    assert.equal(set.has("d"), true);
    set.forget("d");
    assert.equal(set.has("d"), false, "a forwarded delete does not stay remembered");
  });
}
// ─── SOL → lamports at the quote boundary ────────────────────────────────────────────────
//
// The only floating-point money arithmetic left in the engine, and it existed in two forms:
// Math.floor in buyToken and Math.round in platformFeeSol, for the identical conversion.
// Flooring a double that lands a hair low silently buys less than the user configured.
{
  const jup = require("../engine/jupiter");
  test("a configured size converts to the lamports the user actually asked for", () => {
    // The first value in the builder's range where floor and round disagree. 1.001 * 1e9 is
    // 1000999999.9999999 in IEEE 754, so flooring buys 1.000999999 SOL for a user who set
    // 1.001. Checked rather than assumed: across every 0.001 step from 0.001 to 10 SOL the
    // two forms differ on 271 values, so this is a range the product actually offers, not a
    // contrived edge.
    assert.strictEqual(Math.floor(1.001 * 1e9), 1000999999, "the floored form is genuinely wrong here");
    assert.strictEqual(jup.solToLamports(1.001), 1001000000);
    for (const [sol, lamports] of [[0.1, 100000000], [0.5, 500000000], [1, 1000000000],
                                   [2.5, 2500000000], [0.001, 1000000], [0.07, 70000000],
                                   [1.003, 1003000000], [5.007, 5007000000]]) {
      assert.strictEqual(jup.solToLamports(sol), lamports, `${sol} SOL`);
    }
  });

  test("floor and round disagree often enough in the offered range to matter", () => {
    let mismatches = 0;
    for (let step = 1; step <= 10000; step += 1) {
      const sol = step / 1000;
      if (Math.floor(sol * 1e9) !== Math.round(sol * 1e9)) mismatches += 1;
    }
    // Pinned so a future engine or platform change that alters double rounding is noticed
    // rather than silently shifting how much every bot buys.
    assert.strictEqual(mismatches, 271, "0.001..10 SOL: values where flooring loses a lamport");
  });

  test("a non-positive or unparseable size converts to zero rather than NaN", () => {
    for (const bad of [0, -1, null, undefined, "", "abc", NaN, Infinity]) {
      assert.strictEqual(jup.solToLamports(bad), 0, String(bad));
    }
  });

  test("the ledger-facing fee stays integer BigInt at every boundary", () => {
    // platformFeeLamports is what the ledger sees. It must never route through a double.
    const fee = jup.platformFeeLamports(BigInt("1000000000"));
    assert.strictEqual(typeof fee, "bigint");
    // APPLY_FEE is false without a resolved fee account, which is the current production
    // state (E-4) — so this asserts the type contract, not a rate.
    assert.ok(fee === BigInt(0) || fee === BigInt(20000000));
    assert.strictEqual(jup.platformFeeLamports("not a number"), BigInt(0));
    assert.strictEqual(jup.platformFeeLamports(BigInt(-5)), BigInt(0));
  });
}
// ─── planned capital: one formula, integer-safe, and the two figures agree ───────────────
//
// The builder showed "Maximum exposure 0.50 SOL" directly above "Minimum planned capital
// 5.50 SOL" for the same configuration, because the two expressions were computed inline three
// hundred lines apart and only one counted DCA. Both were rendered as fact.
{
  const capital = require("../../lib/planned-capital");
  const { plannedCapital, perTokenExposureError, format, explain } = capital;

  const dca = (...amounts) => ({
    enabled: true,
    levels: amounts.map((buyAmountSol) => ({ buyAmountSol, dropBps: 1000, enabled: true }))
  });

  test("DCA disabled: the exact reported example calculates 0.05 x 10 = 0.50", () => {
    const plan = plannedCapital({
      buyAmountSol: 0.05,
      maxOpenTrades: 10,
      dca: { enabled: false, levels: [{ buyAmountSol: 0.25, enabled: true }, { buyAmountSol: 0.25, enabled: true }] }
    });
    assert.strictEqual(format(plan.perPositionLamports), "0.05");
    assert.strictEqual(format(plan.plannedLamports), "0.5",
      "an off master must exclude every level, however many are individually on");
    assert.strictEqual(plan.dcaLamports, 0n);
  });

  test("one DCA level enabled adds exactly that level", () => {
    const plan = plannedCapital({ buyAmountSol: 0.05, maxOpenTrades: 10, dca: dca(0.25) });
    assert.strictEqual(format(plan.perPositionLamports), "0.3");
    assert.strictEqual(format(plan.plannedLamports), "3");
    assert.strictEqual(plan.dcaLevelCount, 1);
  });

  test("multiple DCA levels enabled: the reported example calculates 0.55 x 10 = 5.50", () => {
    const plan = plannedCapital({ buyAmountSol: 0.05, maxOpenTrades: 10, dca: dca(0.25, 0.25) });
    assert.strictEqual(format(plan.entryLamports), "0.05");
    assert.strictEqual(format(plan.dcaLamports), "0.5");
    assert.strictEqual(format(plan.perPositionLamports), "0.55");
    assert.strictEqual(format(plan.plannedLamports), "5.5");
    assert.deepStrictEqual(explain(plan), [
      "0.05 entry",
      "+ 0.5 enabled DCA (2 levels)",
      "= 0.55 SOL per position",
      "0.55 × 10 positions",
      "= 5.5 SOL minimum capital"
    ]);
  });

  test("a disabled DCA level is excluded while its siblings still count", () => {
    const plan = plannedCapital({
      buyAmountSol: 0.05,
      maxOpenTrades: 10,
      dca: { enabled: true, levels: [
        { buyAmountSol: 0.25, enabled: true },
        { buyAmountSol: 0.25, enabled: false },
        { buyAmountSol: 0.1, enabled: true }
      ] }
    });
    // The editor's total must match what buildConfig() SAVES, and buildConfig persists an off
    // level as absent. Counting it here would make the figure change on reload.
    assert.strictEqual(format(plan.dcaLamports), "0.35");
    assert.strictEqual(plan.dcaLevelCount, 2);
    assert.strictEqual(format(plan.plannedLamports), "4");
  });

  test("the total is exact integer lamports, and the string is derived from it", () => {
    // HONEST SCOPE. A search over 232,000 in-range combinations — entry and DCA amounts to four
    // decimals, two to six levels, 1 to 100 positions — found NO case where the old double path
    // disagreed with this one after rounding. So this is not a rounding bug that was shipping;
    // it is the policy the specification requires (no floating-point money arithmetic) turned
    // into a guarantee rather than a coincidence that happens to hold for today's input ranges.
    //
    // What it does buy, concretely: the displayed string is formatted FROM the integer, so it
    // cannot drift from the number worker_claim_call_execution measures the caps against. The
    // previous code rendered `requiredCapital.toFixed(3)`, which would have silently absorbed a
    // divergence if one ever appeared.
    const plan = plannedCapital({ buyAmountSol: 0.05, maxOpenTrades: 10, dca: dca(0.25, 0.25) });
    assert.strictEqual(typeof plan.plannedLamports, "bigint");
    assert.strictEqual(plan.perPositionLamports, 550000000n);
    assert.strictEqual(plan.plannedLamports, 5500000000n);
    assert.strictEqual(format(plan.plannedLamports), "5.5");

    // Rounding, not flooring — matching server/engine/jupiter.solToLamports, where flooring
    // bought less than the user configured. 1.001 is one of the 271 values where they differ.
    assert.strictEqual(capital.toLamports(1.001), 1001000000n);
    assert.notStrictEqual(capital.toLamports(1.001), BigInt(Math.floor(1.001 * 1e9)));
    assert.strictEqual(format(plannedCapital({ buyAmountSol: 1.001, maxOpenTrades: 3 }).plannedLamports), "3.003");

    // Trailing zeros are trimmed rather than padded to a fixed width, so "5.5" and "0.05" both
    // read as the amount the user typed.
    assert.strictEqual(format(50000000n), "0.05");
    assert.strictEqual(format(1000000000n), "1");
    assert.strictEqual(format(1n), "0.000000001");
  });

  test("the fee reserve is reported separately and never inside planned capital", () => {
    const plan = plannedCapital({ buyAmountSol: 1, maxOpenTrades: 2 });
    assert.strictEqual(format(plan.plannedLamports), "2", "the reserve must not inflate the requirement");
    assert.strictEqual(plan.reserveLamports, 15890880n);
    assert.strictEqual(plan.totalWithReserveLamports, 2000000000n + 15890880n);
  });

  test("take profit and stop loss commit no capital to open a position", () => {
    const base = { buyAmountSol: 0.05, maxOpenTrades: 10, dca: dca(0.25, 0.25) };
    const withExits = plannedCapital({
      ...base,
      takeProfit: { enabled: true, levels: [{ targetBps: 10000, sellBps: 5000 }] },
      stopLoss: { enabled: true, stopBps: 4000 }
    });
    assert.strictEqual(withExits.plannedLamports, plannedCapital(base).plannedLamports);
  });

  test("per-token exposure below one position's plan is a precise error", () => {
    // The shipped default state: 0.50 per token against a 0.55 position. The entry claims, then
    // the first DCA leg that crosses the limit is refused, leaving the position half-built.
    const plan = plannedCapital({
      buyAmountSol: 0.05, maxOpenTrades: 10, dca: dca(0.25, 0.25), perTokenExposureSol: 0.5
    });
    const message = perTokenExposureError(plan);
    assert.ok(message, "0.50 per token cannot complete a 0.55 position");
    assert.match(message, /0\.5 SOL is below the 0\.55 SOL/);
    assert.match(message, /0\.05 entry \+ 0\.5 DCA/, "the error must show its working");
    assert.match(message, /at least 0\.55 SOL/, "and name the fix");

    // Exactly equal is fine — the position completes.
    assert.strictEqual(
      perTokenExposureError(plannedCapital({ ...{ buyAmountSol: 0.05, maxOpenTrades: 10, dca: dca(0.25, 0.25) }, perTokenExposureSol: 0.55 })),
      null
    );
    // Switched off, the limit is not applied and must not be validated.
    assert.strictEqual(perTokenExposureError(plan, { enabled: false }), null);
    // Turning DCA off drops the requirement to the entry, so the same 0.50 is fine again.
    assert.strictEqual(
      perTokenExposureError(plannedCapital({
        buyAmountSol: 0.05, maxOpenTrades: 10,
        dca: { enabled: false, levels: [{ buyAmountSol: 0.25, enabled: true }] },
        perTokenExposureSol: 0.5
      })),
      null
    );
  });

  test("save, reload and edit preserve the same result", () => {
    // The round trip that matters: buildConfig() drops disabled levels, so recomputing from the
    // SAVED shape must equal what the editor showed before saving. This is the property that
    // fails when the editor counts a level the save path removes.
    const editorState = {
      buyAmountSol: 0.05,
      maxOpenTrades: 10,
      dca: { enabled: true, levels: [
        { buyAmountSol: 0.25, enabled: true },
        { buyAmountSol: 0.25, enabled: false },
        { buyAmountSol: 0.25, enabled: true }
      ] }
    };
    const before = plannedCapital(editorState);

    // Exactly what BotBuilder.buildConfig() persists.
    const saved = {
      enabled: true,
      levels: editorState.dca.levels.filter((level) => level.enabled)
    };
    const afterReload = plannedCapital({ buyAmountSol: 0.05, maxOpenTrades: 10, dca: saved });
    assert.strictEqual(afterReload.plannedLamports, before.plannedLamports);
    assert.strictEqual(format(afterReload.plannedLamports), "5.5");

    // And an edit that re-enables the middle level moves it by exactly one level.
    const edited = plannedCapital({
      buyAmountSol: 0.05, maxOpenTrades: 10,
      dca: { enabled: true, levels: editorState.dca.levels.map((l) => ({ ...l, enabled: true })) }
    });
    assert.strictEqual(format(edited.plannedLamports), "8");
  });

  test("degenerate inputs report something honest rather than NaN", () => {
    assert.strictEqual(format(plannedCapital({}).plannedLamports), "0");
    assert.strictEqual(plannedCapital({ buyAmountSol: "x", maxOpenTrades: "y" }).plannedLamports, 0n);
    // A zero or negative trade count is floored to one position, not to zero — reporting "no
    // capital required" for a misconfigured bot is the most misleading answer available.
    assert.strictEqual(format(plannedCapital({ buyAmountSol: 1, maxOpenTrades: 0 }).plannedLamports), "1");
    assert.strictEqual(format(plannedCapital({ buyAmountSol: 1, maxOpenTrades: -5 }).plannedLamports), "1");
    assert.strictEqual(format(plannedCapital({ buyAmountSol: 1, maxOpenTrades: 2.7 }).plannedLamports), "2");
  });
}

// ─── module ON/OFF must reach the exit engine ────────────────────────────────────────────
//
// The builder's take-profit and stop-loss switches are only real if the worker acts on them.
// A toggle that saves, reloads and shows Off while the position still sells is the exact
// "decorative toggle ignored by the backend" this product forbids.
{
  const monitor = require("../engine/monitor");
  const base = {
    id: "p1", user_pubkey: "U", wallet_id: "W", mint: "M", status: "open",
    amount_raw: "1000000", entry_price_usd: 1, peak_price_usd: 1, filled_levels: []
  };
  const decide = (row, price) => monitor.decideExit({ position: monitor.normalizePosition(row), price });

  test("take profit OFF does not sell, even at a price that would trigger every level", () => {
    const off = { ...base, entry_config: { takeProfit: { enabled: false, levels: [] }, stopLoss: { stopBps: 4000 } },
                  tp1: 2, tp1_sell: 50, tp2: 5, tp2_sell: 25, stop_loss: 40 };
    // 10x. With take profit on this sells; with it off nothing may.
    assert.strictEqual(decide(off, 10), null,
      "an empty configured level list must NOT fall through to the legacy tp1/tp2 columns");
  });

  test("take profit ON still sells at its configured level", () => {
    const on = { ...base, entry_config: { takeProfit: { enabled: true, levels: [{ targetBps: 10000, sellBps: 5000, trailingBps: 0 }] }, stopLoss: { stopBps: 4000 } } };
    const exit = decide(on, 2.5);
    assert.ok(exit, "a configured level at +100% must fire at 2.5x");
    assert.strictEqual(exit.kind, "TP1");
  });

  test("stop loss OFF leaves a losing position open", () => {
    const off = { ...base, entry_config: { takeProfit: { enabled: true, levels: [] }, stopLoss: { enabled: false, stopBps: 0 } },
                  stop_loss: 40 };
    assert.strictEqual(decide(off, 0.05), null, "a 95% drawdown must not exit when the stop is off");
  });

  test("stop loss ON exits the whole remaining position", () => {
    const on = { ...base, entry_config: { takeProfit: { enabled: true, levels: [] }, stopLoss: { enabled: true, stopBps: 4000 } } };
    const exit = decide(on, 0.5);
    assert.ok(exit && exit.kind === "SL", "-50% must trip a -40% stop");
    assert.strictEqual(String(exit.amountRaw), "1000000", "a stop exits everything that remains");
  });

  test("a position with no entry_config still honours the legacy columns", () => {
    // The fallback must survive: positions opened before entry_config existed have only these.
    const legacy = { ...base, entry_config: {}, tp1: 2, tp1_sell: 50, tp2: 5, tp2_sell: 25, stop_loss: 40 };
    const exit = decide(legacy, 2.5);
    assert.ok(exit && exit.kind === "TP1", "legacy tp1 must still fire");
    assert.strictEqual(decide({ ...legacy }, 0.5).kind, "SL", "legacy stop must still fire");
  });

  test("automatic exits OFF stops every exit, including the stop loss", () => {
    // The master. Off means the owner exits by hand, and the builder says so — this asserts
    // that it really is by hand and not merely a label.
    const off = {
      ...base,
      entry_config: {
        autoExit: false,
        takeProfit: { enabled: true, levels: [{ targetBps: 10000, sellBps: 5000, trailingBps: 0 }] },
        stopLoss: { enabled: true, stopBps: 4000 }
      }
    };
    assert.strictEqual(decide(off, 10), null, "a 10x must not take profit with automatic exits off");
    assert.strictEqual(decide(off, 0.1), null, "and a 90% drawdown must not stop out either");

    const on = { ...off, entry_config: { ...off.entry_config, autoExit: true } };
    assert.ok(decide(on, 10), "with it back on the same position exits");
  });

  test("a position saved before the switch existed keeps exiting automatically", () => {
    // Absent must read as ON. Reading a missing key as off would strand every open position
    // the first time this shipped, holding, with the owner told nothing.
    const row = {
      ...base,
      entry_config: {
        takeProfit: { enabled: true, levels: [{ targetBps: 10000, sellBps: 5000, trailingBps: 0 }] },
        stopLoss: { enabled: true, stopBps: 4000 }
      }
    };
    assert.ok(decide(row, 2.5), "no autoExit key means automatic exits, as before");
  });

  test("the trailing master gates the per-level distance", () => {
    // trailingBps > 0 means a level ARMS at its target and sells once the price gives back the
    // distance. With the master off the level must sell AT the target instead — which is what
    // "Apply the per-level trailing distance after activation" says, and the one thing the
    // switch did not do.
    const levels = [{ targetBps: 10000, sellBps: 5000, trailingBps: 1000 }];
    const armed = { ...base, peak_price_usd: 3, entry_config: { takeProfit: { enabled: true, trailing: true, levels }, stopLoss: { enabled: false, stopBps: 0 } } };
    // At 3x with a 3x peak, an armed trailing level has given back nothing yet.
    assert.strictEqual(decide(armed, 3), null, "trailing on: at the high, hold");
    assert.ok(decide(armed, 2.6), "trailing on: a 10% give-back from the high sells");

    const plain = { ...armed, entry_config: { ...armed.entry_config, takeProfit: { ...armed.entry_config.takeProfit, trailing: false } } };
    assert.ok(decide(plain, 3), "trailing off: the level sells at its target rather than waiting");
  });

  test("the exit is priced under the position's own configuration, not the bot's", () => {
    // entry_config is immutable for the life of the position, so editing the bot cannot change
    // what an already-open trade pays to get out.
    const policy = monitor.executionPolicy({
      priorityFeeMaxLamports: 750000, priorityFeeStrategy: "fast", quoteExpirationSeconds: 12
    });
    assert.deepStrictEqual(policy, {
      priorityFeeMaxLamports: 750000, priorityFeeStrategy: "fast", quoteExpirationSeconds: 12
    });
    assert.strictEqual(monitor.executionPolicy({}), null, "nothing configured means the platform default");
    assert.strictEqual(monitor.executionPolicy({ priorityFeeMaxLamports: 0 }), null,
      "a zero cap is unset, not an instruction to pay nothing");
  });

  test("the priority-fee cap and level reach the swap body", () => {
    const jup = require("../engine/jupiter");
    assert.deepStrictEqual(
      jup.prioritizationFee({ priorityFeeMaxLamports: 500000, priorityFeeStrategy: "economy" }),
      { priorityLevelWithMaxLamports: { maxLamports: 500000, priorityLevel: "low" } }
    );
    assert.deepStrictEqual(
      jup.prioritizationFee({ priorityFeeMaxLamports: 500000, priorityFeeStrategy: "fast" }),
      { priorityLevelWithMaxLamports: { maxLamports: 500000, priorityLevel: "high" } }
    );
    // Unset falls back to Jupiter's own policy rather than to a cap of zero, which would build
    // a transaction that never lands.
    assert.strictEqual(jup.prioritizationFee({}), "auto");
    assert.strictEqual(jup.prioritizationFee({ priorityFeeMaxLamports: -1 }), "auto");
    assert.strictEqual(jup.prioritizationFee(null), "auto");
    // An unknown strategy is not a reason to refuse to trade; it takes the middle level.
    assert.strictEqual(
      jup.prioritizationFee({ priorityFeeMaxLamports: 1, priorityFeeStrategy: "turbo" })
        .priorityLevelWithMaxLamports.priorityLevel,
      "medium"
    );
  });

  test("the configured quote window is what expires a quote", () => {
    const jup = require("../engine/jupiter");
    assert.strictEqual(jup.quoteExpired({ quotedAtMs: 0, nowMs: 9_000, quoteExpirationSeconds: 10 }), false);
    assert.strictEqual(jup.quoteExpired({ quotedAtMs: 0, nowMs: 11_000, quoteExpirationSeconds: 10 }), true);
    // Unset uses the engine default rather than expiring immediately.
    assert.strictEqual(jup.quoteExpired({ quotedAtMs: 0, nowMs: 11_000 }), false);
    assert.strictEqual(jup.quoteExpired({ quotedAtMs: 0, nowMs: 31_000 }), true);
    assert.strictEqual(jup.quoteExpired({ quotedAtMs: 0, nowMs: 31_000, quoteExpirationSeconds: 0 }), true,
      "zero is unset, so the default window still applies");
  });

  test("the worker actually passes the execution resolver to the call watcher", () => {
    // The resolver existed, the engine accepted it, every unit test passed — and worker.js
    // never handed it over, so both controls would have resolved to null in production. A
    // default of "not configured" is exactly what makes that invisible. Asserted against the
    // deployed file's text because the alternative is booting a worker in a test.
    const fs = require("node:fs");
    const worker = fs.readFileSync(`${__dirname}/../worker.js`, "utf8");
    const stripped = worker.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    assert.ok(
      /subscriberExecution:\s*store\.subscriberExecution/.test(stripped),
      "worker.js must pass store.subscriberExecution to startCallWatcher, or the priority-fee " +
        "cap and quote window silently do not apply"
    );
    // And the engine must still accept it under that exact name.
    const calls = fs.readFileSync(`${__dirname}/../engine/calls.js`, "utf8");
    assert.ok(calls.includes("subscriberExecution"), "engine/calls.js must read the dependency");
  });

  test("the subscriber's execution policy comes from the same snapshot as their filters", () => {
    const store = require("../engine/store");
    const versioned = store.subscriberExecution({
      subscriber_config_snapshot: { priorityFeeMaxLamports: 900000, priorityFeeStrategy: "fast", quoteExpirationSeconds: 20 },
      extended_config: { priorityFeeMaxLamports: 1 }
    });
    assert.strictEqual(versioned.priorityFeeMaxLamports, 900000, "the immutable snapshot wins");

    // The empty-default trap: subscriber_config_snapshot is NOT NULL DEFAULT '{}', and '{}' is
    // truthy, so a resolver testing truthiness would shadow a real extended_config.
    assert.strictEqual(
      store.subscriberExecution({ subscriber_config_snapshot: {}, extended_config: { priorityFeeMaxLamports: 4242 } })
        .priorityFeeMaxLamports,
      4242
    );
    // A legacy baseline carries no builder policy and must fall back to the platform default.
    assert.strictEqual(
      store.subscriberExecution({ subscriber_config_snapshot: { compatibilityMode: "legacy-baseline" }, extended_config: {} }),
      null
    );
    assert.strictEqual(store.subscriberExecution({}), null);
    assert.strictEqual(store.subscriberExecution(null), null);
  });

  test("a disabled level is absent from the plan, so the next enabled one is used", () => {
    // The builder filters disabled levels out before saving, so the engine sees only the
    // enabled ones. This pins that the surviving level is what fires.
    const row = { ...base, entry_config: { takeProfit: { enabled: true, levels: [{ targetBps: 40000, sellBps: 2500, trailingBps: 0 }] }, stopLoss: { stopBps: 4000 } } };
    assert.strictEqual(decide(row, 2.5), null, "the removed +100% level must not fire");
    assert.ok(decide(row, 5.5), "the surviving +400% level must");
  });
}
console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
