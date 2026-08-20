import { test } from "node:test";
import assert from "node:assert/strict";
import { copyCall } from "../server/copy.ts";
import type { CopyDeps, Subscriber } from "../server/copy.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const CALL = { id: "call-1", channelId: "chan-1", mint: BONK, symbol: "BONK" };

function subscriber(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    subscriptionId: "sub-1",
    userId: "user-1",
    walletAddress: "wallet-1",
    encryptedSecret: "cipher",
    limits: { perTradeSol: 0.5, maxDailySol: 2 },
    rules: { takeProfits: [{ gainPct: 100, sellPct: 50 }], stopLossPct: 30 },
    slippageBps: 300,
    paused: false,
    ...overrides
  };
}

type Harness = {
  deps: CopyDeps;
  buys: { mint: string; amountSol: number }[];
  positions: unknown[];
  spend: { day: string; amountSol: number }[];
  notes: string[];
};

function harness(options: {
  subscribers?: Subscriber[];
  balance?: number;
  spentToday?: number;
  buyFails?: string;
  copied?: boolean;
} = {}): Harness {
  const buys: { mint: string; amountSol: number }[] = [];
  const positions: unknown[] = [];
  const spend: { day: string; amountSol: number }[] = [];
  const notes: string[] = [];

  const deps: CopyDeps = {
    async getSubscribers() {
      return options.subscribers ?? [subscriber()];
    },
    async getSpentToday() {
      return options.spentToday ?? 0;
    },
    async getWalletBalance() {
      return options.balance ?? 5;
    },
    async buy(input) {
      if (options.buyFails) return { ok: false, error: options.buyFails };
      buys.push({ mint: input.mint, amountSol: input.amountSol });
      return { ok: true, signature: "sig-1", tokensOut: "1000000", entryPriceUsd: 0.00002 };
    },
    async openPosition(input) {
      positions.push(input);
      return { id: "pos-1" };
    },
    async recordSpend(input) {
      spend.push({ day: input.day, amountSol: input.amountSol });
    },
    async notify(_userId, message) {
      notes.push(message);
    },
    async alreadyCopied() {
      return options.copied ?? false;
    },
    now: () => new Date("2026-03-05T12:00:00Z")
  };

  return { deps, buys, positions, spend, notes };
}

test("buys for a subscriber and opens a position carrying their exit rules", async () => {
  const h = harness();
  const outcome = await copyCall(CALL, h.deps);

  assert.equal(outcome.filled, 1);
  assert.equal(h.buys[0]?.amountSol, 0.5);
  assert.equal(h.buys[0]?.mint, BONK);
  const position = h.positions[0] as { rules: { stopLossPct: number } };
  assert.equal(position.rules.stopLossPct, 30, "the position must carry the rules that were configured");
});

test("skips a paused subscription without spending anything", async () => {
  const h = harness({ subscribers: [subscriber({ paused: true })] });
  const outcome = await copyCall(CALL, h.deps);

  assert.equal(outcome.filled, 0);
  assert.equal(h.buys.length, 0);
  assert.deepEqual(h.spend, []);
  assert.equal(outcome.skipped[0]?.reason, "paused");
});

test("never buys the same call twice for one subscription", async () => {
  // A redelivered update or a retried worker tick must not double-spend.
  const h = harness({ copied: true });
  const outcome = await copyCall(CALL, h.deps);

  assert.equal(outcome.filled, 0);
  assert.equal(h.buys.length, 0);
  assert.equal(outcome.skipped[0]?.reason, "already copied");
});

test("skips and explains when the daily limit is spent", async () => {
  const h = harness({ spentToday: 2 });
  const outcome = await copyCall(CALL, h.deps);

  assert.equal(outcome.filled, 0);
  assert.equal(h.buys.length, 0);
  assert.match(h.notes[0] ?? "", /Daily limit/);
});

test("skips when the wallet cannot cover the trade", async () => {
  const h = harness({ balance: 0.2 });
  const outcome = await copyCall(CALL, h.deps);

  assert.equal(outcome.filled, 0);
  assert.match(h.notes[0] ?? "", /Not enough SOL/);
});

test("spend is reserved before the buy and refunded when it fails", async () => {
  // Crashing mid-trade should over-count today's spend, never under-count it: the cost
  // of over-counting is one skipped copy, the cost of under-counting is blowing the cap.
  const h = harness({ buyFails: "route not found" });
  const outcome = await copyCall(CALL, h.deps);

  assert.equal(outcome.filled, 0);
  assert.deepEqual(
    h.spend.map((entry) => entry.amountSol),
    [0.5, -0.5],
    "reserved, then given back"
  );
  assert.equal(h.positions.length, 0, "no position may be booked for a failed buy");
  assert.match(h.notes[0] ?? "", /Could not buy/);
});

test("one subscriber's failure does not stop the others", async () => {
  const h = harness({
    subscribers: [subscriber({ subscriptionId: "sub-1", paused: true }), subscriber({ subscriptionId: "sub-2", userId: "user-2" })]
  });
  const outcome = await copyCall(CALL, h.deps);

  assert.equal(outcome.filled, 1);
  assert.equal(outcome.skipped.length, 1);
});

test("records spend against the UTC day of the call", async () => {
  const h = harness();
  await copyCall(CALL, h.deps);
  assert.equal(h.spend[0]?.day, "2026-03-05");
});

test("no subscribers is a no-op, not an error", async () => {
  const h = harness({ subscribers: [] });
  const outcome = await copyCall(CALL, h.deps);
  assert.deepEqual(outcome, { attempted: 0, filled: 0, skipped: [] });
});
