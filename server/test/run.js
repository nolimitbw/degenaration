// Minimal zero-dependency test runner for the Degenaration server logic.
const assert = require("assert");
const { parseCall, parseCalls, MAX_CALLS_PER_MESSAGE } = require("../bot/parser");

let pass = 0, fail = 0;
// Async tests are queued and awaited at the end. Without this an async assertion
// failure would surface as an unhandled rejection and still be counted as a pass.
const pending = [];
function test(name, fn) {
  let result;
  try { result = fn(); }
  catch (e) { fail++; console.log("  ✗ " + name + " — " + e.message); return; }

  if (result && typeof result.then === "function") {
    pending.push(result.then(
      () => { pass++; console.log("  ✓ " + name + " (async)"); },
      (e) => { fail++; console.log("  ✗ " + name + " — " + e.message); }
    ));
    return;
  }
  pass++;
  console.log("  ✓ " + name);
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
// Product rule: EVERY Solana mint posted in a registered channel is a call. A message
// naming two mints is two calls, not an ambiguity to discard.
test("returns every mint in a multi-token message", () => {
  const two = "a 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU b 6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP";
  const calls = parseCalls(two);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls.map((c) => c.mint), [
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP"
  ]);
});
test("collapses a repeated mint to one call at its highest confidence", () => {
  const mint = "6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP";
  const calls = parseCalls(`${mint} chart: pump.fun/coin/${mint}`);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].confidence, "high");
});
test("caps how many calls one message can produce", () => {
  const mints = [
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "So11111111111111111111111111111111111111112",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
  ].join(" ");
  assert.strictEqual(parseCalls(mints).length, MAX_CALLS_PER_MESSAGE);
});
test("parseCall still returns the leading mint for single-call callers", () => {
  const two = "a 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU b 6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP";
  assert.strictEqual(parseCall(two).mint, "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
});

console.log("fee math (configured platform fee)");
const PLATFORM_FEE_BPS = 200;
function feeFor(sol) { return sol * (PLATFORM_FEE_BPS / 10000); }
test("configured fee of 0.5 SOL = 0.01", () => assert.ok(Math.abs(feeFor(0.5) - 0.01) < 1e-9));
test("configured fee of 1.2 SOL = 0.024", () => assert.ok(Math.abs(feeFor(1.2) - 0.024) < 1e-9));
test("fee applies on partial sells too", () => {
  const partial = 0.5 * 0.5; // sell 50% of a 0.5 SOL position
  assert.ok(Math.abs(feeFor(partial) - 0.005) < 1e-9);
});
const jupiterPath = require.resolve("../engine/jupiter");
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

console.log("call outcome milestones");
const NOW = "2026-07-12T00:00:00.000Z";
test("stamps every up milestone the peak has cleared", () => {
  const update = performanceUpdate({ called_price_usd: 1 }, { priceUsd: 5 }, NOW);
  assert.strictEqual(update.hit_up_50_at, NOW);
  assert.strictEqual(update.hit_2x_at, NOW);
  assert.strictEqual(update.hit_5x_at, NOW);
  assert.strictEqual(update.outcome, "win");
});
test("a milestone already reached is never re-stamped or cleared", () => {
  const earlier = "2026-07-01T00:00:00.000Z";
  // Round-tripped all the way back to entry — the 2x it already ran still stands.
  const update = performanceUpdate(
    { called_price_usd: 1, peak_price_usd: 2.5, hit_up_50_at: earlier, hit_2x_at: earlier, outcome: "win" },
    { priceUsd: 1 },
    NOW
  );
  assert.strictEqual(update.hit_2x_at, undefined);
  assert.strictEqual(update.hit_up_50_at, undefined);
  assert.strictEqual(update.peak_price_usd, 2.5);
  assert.strictEqual(update.outcome, "win");
});
test("halving from entry settles the call as a loss", () => {
  const update = performanceUpdate({ called_price_usd: 1 }, { priceUsd: 0.4 }, NOW);
  assert.strictEqual(update.hit_down_50_at, NOW);
  assert.strictEqual(update.trough_price_usd, 0.4);
  assert.strictEqual(update.outcome, "loss");
  assert.strictEqual(update.hit_up_50_at, undefined);
});
test("a call that ran up before dumping keeps the win it earned first", () => {
  const won = "2026-07-02T00:00:00.000Z";
  const update = performanceUpdate(
    { called_price_usd: 1, peak_price_usd: 2, hit_up_50_at: won, hit_2x_at: won },
    { priceUsd: 0.3 },
    NOW
  );
  assert.strictEqual(update.hit_down_50_at, NOW);
  assert.strictEqual(update.outcome, "win"); // the +50% leg came first
});
test("an unpriced call stays open instead of being scored", () => {
  const update = performanceUpdate({ called_price_usd: null }, { priceUsd: 0.5 }, NOW);
  assert.strictEqual(update.outcome, undefined);
  assert.strictEqual(update.hit_down_50_at, undefined);
  assert.strictEqual(update.latest_price_usd, 0.5);
});

console.log("push dispatch");
const { createCallDispatcher } = require("../engine/call-stream");
test("executes a pushed call once, even when pushed twice", async () => {
  const claimed = [];
  const call = { id: "c1", group_id: "g1", mint: "M".repeat(44), executed_at: null };
  const deps = {
    loadCallById: async () => call,
    loadGroupSubscribers: async () => [{ id: "s1" }],
    // Mirrors the real RPC: unique per (call, subscription), so the second attempt loses.
    claimCallExecution: async (callId, subId) => {
      const key = `${callId}:${subId}`;
      if (claimed.includes(key)) return { ok: false, error: "execution already claimed", status: 409 };
      claimed.push(key);
      return { ok: false, error: "delegated wallet unavailable", status: 422 };
    },
    finishCallExecution: async () => ({ ok: true }),
    completeCall: async () => ({ ok: true }),
    signAndSend: async () => { throw new Error("signing must not be reached in this test"); }
  };
  const dispatch = createCallDispatcher(deps);
  await Promise.all([dispatch("c1"), dispatch("c1")]);
  await dispatch("c1");
  assert.deepStrictEqual(claimed, ["c1:s1"]);
});
test("skips a call the worker already executed", async () => {
  let loads = 0;
  const dispatch = createCallDispatcher({
    loadCallById: async () => { loads += 1; return { id: "c2", group_id: "g1", mint: "M", executed_at: NOW }; },
    loadGroupSubscribers: async () => { throw new Error("must not fan out an executed call"); },
    claimCallExecution: async () => ({ ok: false }),
    finishCallExecution: async () => ({ ok: true }),
    completeCall: async () => ({ ok: true }),
    signAndSend: async () => null
  });
  assert.strictEqual((await dispatch("c2")).status, "already executed");
  assert.strictEqual((await dispatch("c2")).status, "already handled");
  assert.strictEqual(loads, 1);
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

Promise.all(pending).then(() => {
  console.log("");
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
