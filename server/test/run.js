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
// rejects the row if it disagrees. These vectors pin lib/fee-model.js to the exact SQL
// formulas in supabase/degenaration-fee-allocation-integrity.sql so a write built in JS
// can never be rejected by the trigger.
console.log("fee model parity with the database trigger");

// floor(gross::numeric * bps / 10000)::bigint
const sqlFloorBps = (amount, bps) => (BigInt(amount) * BigInt(bps)) / BigInt(10000);

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
  const { platformFeeLamports } = require("../engine/jupiter");
  assert.strictEqual(platformFeeLamports(HUNDRED_SOL), feeModel.bpsOf(HUNDRED_SOL, 200));
  assert.strictEqual(platformFeeLamports(lam(1)), BigInt(0));
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
  const { platformFeeSol } = require("../engine/jupiter");
  assert.ok(Math.abs(platformFeeSol(1.2) - 0.024) < 1e-9);
  if (previous) process.env.PLATFORM_FEE_ACCOUNT = previous;
  else delete process.env.PLATFORM_FEE_ACCOUNT;
  delete require.cache[jupiterPath];
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
