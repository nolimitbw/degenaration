import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeJupiter, FAKE_SOL_PRICE_USD, FAKE_TOKEN_DECIMALS } from "./support/fake-jupiter.ts";
import type { FakeJupiter } from "./support/fake-jupiter.ts";
import { buyToken, sellToken } from "../lib/trading/execute.ts";
import { monitorTick } from "../server/monitor.ts";
import type { MonitorDeps, OpenPosition } from "../server/monitor.ts";
import { getPriceUsd } from "../lib/trading/jupiter.ts";

/**
 * The full trade loop against a stub Jupiter: buy, price rises through a take-profit
 * ladder, price collapses through the stop, position closes.
 *
 * This is the closest thing to proof the swap path works that is available without
 * network access to the real API. It exercises the genuine execute + monitor code —
 * unit conversions, entry-price derivation, sell sizing — rather than mocks of them.
 * It cannot prove the live endpoint still matches this contract; `npm run probe:jupiter`
 * is what checks that.
 */

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const START_PRICE = 0.001;

let jupiter: FakeJupiter;

before(async () => {
  jupiter = await startFakeJupiter(START_PRICE);
  process.env.JUPITER_API_URL = jupiter.url;
  process.env.PRICE_API_URL = jupiter.url;
  process.env.WALLET_ENCRYPTION_KEY = "d".repeat(64);
  delete process.env.TRADING_MODE; // simulation: real quotes, no submission
});

after(async () => {
  await jupiter.close();
});

test("a buy converts SOL to tokens and derives the entry price from the actual fill", async () => {
  const result = await buyToken({ mint: MINT, amountSol: 1, slippageBps: 300, encryptedSecret: "unused" });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  // 1 SOL at $200, token at $0.001 => 200,000 tokens => 200,000 * 1e6 base units.
  assert.equal(Number(result.tokensOut), 200_000 * FAKE_TOKEN_DECIMALS);

  // Entry price is derived as (SOL in x SOL price) / tokens out, in whole-token terms
  // scaled by the token's base units — the same arithmetic the monitor compares against.
  const expectedEntry = (1 * FAKE_SOL_PRICE_USD) / Number(result.tokensOut);
  assert.equal(result.entryPriceUsd, expectedEntry);
});

test("the price feed reports what the market is doing", async () => {
  jupiter.setPrice(0.002);
  assert.equal(await getPriceUsd(MINT), 0.002);
  jupiter.setPrice(START_PRICE);
});

test("a sell converts tokens back to SOL, round-tripping at an unchanged price", async () => {
  const bought = await buyToken({ mint: MINT, amountSol: 1, slippageBps: 300, encryptedSecret: "unused" });
  assert.equal(bought.ok, true);
  if (!bought.ok) return;

  const sold = await sellToken({
    mint: MINT,
    tokensRemaining: bought.tokensOut,
    remainingFraction: 1,
    fractionOfOriginal: 1,
    slippageBps: 300,
    encryptedSecret: "unused"
  });

  assert.equal(sold.ok, true);
  if (!sold.ok) return;
  assert.ok(Math.abs(sold.solOut - 1) < 0.0001, `round trip returned ${sold.solOut} SOL, expected ~1`);
});

test("selling half the position sells half the tokens", async () => {
  const bought = await buyToken({ mint: MINT, amountSol: 1, slippageBps: 300, encryptedSecret: "unused" });
  assert.equal(bought.ok, true);
  if (!bought.ok) return;

  const sold = await sellToken({
    mint: MINT,
    tokensRemaining: bought.tokensOut,
    remainingFraction: 1,
    fractionOfOriginal: 0.5,
    slippageBps: 300,
    encryptedSecret: "unused"
  });
  assert.equal(sold.ok, true);
  if (!sold.ok) return;
  assert.ok(Math.abs(sold.solOut - 0.5) < 0.0001, `expected ~0.5 SOL, got ${sold.solOut}`);
});

test("a sell sized against what remains, not the original, does not oversell", async () => {
  // Half already gone: selling "50% of the original" must sell ALL of the remainder.
  const bought = await buyToken({ mint: MINT, amountSol: 1, slippageBps: 300, encryptedSecret: "unused" });
  assert.equal(bought.ok, true);
  if (!bought.ok) return;

  const half = String(Math.floor(Number(bought.tokensOut) / 2));
  const sold = await sellToken({
    mint: MINT,
    tokensRemaining: half,
    remainingFraction: 0.5,
    fractionOfOriginal: 0.5,
    slippageBps: 300,
    encryptedSecret: "unused"
  });
  assert.equal(sold.ok, true);
  if (!sold.ok) return;
  assert.ok(Math.abs(sold.solOut - 0.5) < 0.0001, `expected ~0.5 SOL from the remaining half, got ${sold.solOut}`);
});

test("a quote failure is reported, not swallowed into a bogus fill", async () => {
  jupiter.failNextQuotes(1);
  const result = await buyToken({ mint: MINT, amountSol: 1, slippageBps: 300, encryptedSecret: "unused" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /no route/);
});

test("full lifecycle: buy, ladder up through both take-profits, then stop out", async () => {
  jupiter.setPrice(START_PRICE);

  const bought = await buyToken({ mint: MINT, amountSol: 1, slippageBps: 300, encryptedSecret: "unused" });
  assert.equal(bought.ok, true);
  if (!bought.ok || bought.entryPriceUsd === null) return assert.fail("buy did not produce an entry price");

  // The monitor works in per-base-unit prices, which is what the feed reports scaled by
  // the same factor the entry mark used.
  const scale = bought.entryPriceUsd / START_PRICE;

  const state = {
    tokensRemaining: bought.tokensOut,
    remainingFraction: 1,
    takeProfits: [
      { gainPct: 100, sellPct: 50, hit: false },
      { gainPct: 300, sellPct: 25, hit: false }
    ],
    closed: false,
    solOut: 0
  };

  const position = (): OpenPosition => ({
    id: "pos-1",
    userId: "user-1",
    mint: MINT,
    symbol: "FAKE",
    entryPriceUsd: bought.entryPriceUsd,
    remainingFraction: state.remainingFraction,
    tokensRemaining: state.tokensRemaining,
    rules: { takeProfits: state.takeProfits, stopLossPct: 40 },
    slippageBps: 300,
    walletAddress: "wallet",
    encryptedSecret: "unused"
  });

  const notes: string[] = [];
  const deps: MonitorDeps = {
    async getOpenPositions() {
      return state.closed ? [] : [position()];
    },
    async getPriceUsd(mint) {
      const raw = await getPriceUsd(mint);
      return raw === null ? null : raw * scale;
    },
    sell: (input) =>
      sellToken({
        mint: input.position.mint,
        tokensRemaining: input.position.tokensRemaining,
        remainingFraction: input.position.remainingFraction,
        fractionOfOriginal: input.fractionOfOriginal,
        slippageBps: input.position.slippageBps,
        encryptedSecret: input.position.encryptedSecret
      }),
    async recordExit(input) {
      state.solOut += input.solOut;
      if (input.levelIndex !== null && state.takeProfits[input.levelIndex]) {
        state.takeProfits[input.levelIndex]!.hit = true;
      }
      const soldTokens = Number(bought.tokensOut) * input.fractionOfOriginal;
      state.tokensRemaining = String(Math.max(0, Number(state.tokensRemaining) - soldTokens));
      state.remainingFraction = Math.max(0, state.remainingFraction - input.fractionOfOriginal);
    },
    async closePosition() {
      state.closed = true;
    },
    async notify(_userId, message) {
      notes.push(message);
    }
  };

  // Flat: nothing should happen.
  let outcome = await monitorTick(deps);
  assert.equal(outcome.exits, 0, "a flat price must not trigger an exit");

  // 2x: the first take-profit sells half.
  jupiter.setPrice(START_PRICE * 2);
  outcome = await monitorTick(deps);
  assert.equal(outcome.exits, 1);
  assert.equal(state.takeProfits[0]?.hit, true);
  assert.ok(Math.abs(state.solOut - 1) < 0.01, `first TP should return ~1 SOL, got ${state.solOut}`);
  assert.ok(Math.abs(state.remainingFraction - 0.5) < 1e-9);

  // 4x: the second take-profit sells another quarter of the original.
  jupiter.setPrice(START_PRICE * 4);
  outcome = await monitorTick(deps);
  assert.equal(outcome.exits, 1);
  assert.equal(state.takeProfits[1]?.hit, true);
  assert.ok(Math.abs(state.remainingFraction - 0.25) < 1e-9);
  assert.ok(Math.abs(state.solOut - 2) < 0.02, `after both TPs expect ~2 SOL, got ${state.solOut}`);

  // Collapse below the stop: the remaining quarter exits and the position closes.
  jupiter.setPrice(START_PRICE * 0.5);
  outcome = await monitorTick(deps);
  assert.equal(outcome.exits, 1);
  assert.equal(outcome.closed, 1);
  assert.equal(state.closed, true);
  assert.ok(Math.abs(state.remainingFraction) < 1e-9, "nothing should be left");

  // Out of a 1 SOL entry: ~1 at 2x, ~1 at 4x, ~0.125 stopping out at half. Profitable
  // overall, which is the point of the ladder.
  assert.ok(state.solOut > 2, `total out should exceed the 1 SOL in, got ${state.solOut}`);

  assert.equal(notes.filter((n) => /Took profit/.test(n)).length, 2);
  assert.equal(notes.filter((n) => /Stopped out/.test(n)).length, 1);
});
