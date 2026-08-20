import { test } from "node:test";
import assert from "node:assert/strict";
import { monitorTick } from "../server/monitor.ts";
import type { MonitorDeps, OpenPosition } from "../server/monitor.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function position(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    id: "pos-1",
    userId: "user-1",
    mint: BONK,
    symbol: "BONK",
    entryPriceUsd: 1,
    remainingFraction: 1,
    tokensRemaining: "1000000",
    rules: { takeProfits: [{ gainPct: 100, sellPct: 50 }], stopLossPct: 30 },
    slippageBps: 300,
    walletAddress: "wallet-1",
    encryptedSecret: "cipher",
    ...overrides
  };
}

type Harness = {
  deps: MonitorDeps;
  sells: { positionId: string; fraction: number }[];
  exits: { kind: string; fraction: number }[];
  closed: string[];
  notes: string[];
  priceCalls: string[];
};

function harness(options: { positions?: OpenPosition[]; price?: number | null; sellFails?: string } = {}): Harness {
  const sells: { positionId: string; fraction: number }[] = [];
  const exits: { kind: string; fraction: number }[] = [];
  const closed: string[] = [];
  const notes: string[] = [];
  const priceCalls: string[] = [];

  const deps: MonitorDeps = {
    async getOpenPositions() {
      return options.positions ?? [position()];
    },
    async getPriceUsd(mint) {
      priceCalls.push(mint);
      return options.price === undefined ? 2 : options.price;
    },
    async sell(input) {
      if (options.sellFails) return { ok: false, error: options.sellFails };
      sells.push({ positionId: input.position.id, fraction: input.fractionOfOriginal });
      return { ok: true, signature: "sig", solOut: input.fractionOfOriginal * 1.0 };
    },
    async recordExit(input) {
      exits.push({ kind: input.kind, fraction: input.fractionOfOriginal });
    },
    async closePosition(id) {
      closed.push(id);
    },
    async notify(_userId, message) {
      notes.push(message);
    }
  };

  return { deps, sells, exits, closed, notes, priceCalls };
}

test("takes profit when the target is reached", async () => {
  const h = harness({ price: 2 });
  const outcome = await monitorTick(h.deps);

  assert.equal(outcome.exits, 1);
  assert.equal(h.sells[0]?.fraction, 0.5);
  assert.equal(h.exits[0]?.kind, "take_profit");
  assert.match(h.notes[0] ?? "", /Took profit/);
});

test("holds when no rule is triggered", async () => {
  const h = harness({ price: 1.2 });
  const outcome = await monitorTick(h.deps);

  assert.equal(outcome.exits, 0);
  assert.equal(h.sells.length, 0);
});

test("stops out and closes the position", async () => {
  const h = harness({ price: 0.5 });
  const outcome = await monitorTick(h.deps);

  assert.equal(h.exits[0]?.kind, "stop_loss");
  assert.equal(h.sells[0]?.fraction, 1);
  assert.deepEqual(h.closed, ["pos-1"], "a fully exited position must be closed");
  assert.match(h.notes[0] ?? "", /Stopped out/);
});

test("a missing price is a held position, not a stop-out", async () => {
  // A feed outage must never be read as a price crash.
  const h = harness({ price: null });
  const outcome = await monitorTick(h.deps);

  assert.equal(outcome.exits, 0);
  assert.equal(h.sells.length, 0);
  assert.equal(h.closed.length, 0);
});

test("a failed sell leaves the level un-hit so the next tick retries", async () => {
  const h = harness({ price: 2, sellFails: "rpc timeout" });
  const outcome = await monitorTick(h.deps);

  assert.equal(outcome.errors, 1);
  assert.equal(h.exits.length, 0, "no exit may be recorded for a sell that did not happen");
  assert.equal(h.closed.length, 0);
  assert.match(h.notes[0] ?? "", /Will retry/);
});

test("prices each mint once per tick regardless of how many hold it", async () => {
  // Many subscribers hold the same call; a per-position fetch would multiply rate limits
  // by the size of the user base.
  const h = harness({
    price: 1.1,
    positions: [
      position({ id: "pos-1" }),
      position({ id: "pos-2", userId: "user-2" }),
      position({ id: "pos-3", userId: "user-3" })
    ]
  });
  await monitorTick(h.deps);

  assert.equal(h.priceCalls.length, 1, "one price lookup for three positions on one mint");
});

test("a gap up fires the whole ladder in one tick and closes out", async () => {
  const h = harness({
    price: 20,
    positions: [
      position({
        rules: {
          takeProfits: [
            { gainPct: 100, sellPct: 50 },
            { gainPct: 500, sellPct: 50 }
          ],
          stopLossPct: 30
        }
      })
    ]
  });
  const outcome = await monitorTick(h.deps);

  assert.equal(outcome.exits, 2);
  assert.deepEqual(h.sells.map((s) => s.fraction), [0.5, 0.5]);
  assert.deepEqual(h.closed, ["pos-1"]);
});

test("a position with no entry price is skipped rather than guessed at", async () => {
  const h = harness({ price: 5, positions: [position({ entryPriceUsd: null })] });
  const outcome = await monitorTick(h.deps);

  assert.equal(outcome.checked, 1);
  assert.equal(outcome.exits, 0);
  assert.equal(h.sells.length, 0);
});

test("partial exit leaves the position open", async () => {
  const h = harness({ price: 2 });
  const outcome = await monitorTick(h.deps);

  assert.equal(outcome.exits, 1);
  assert.equal(outcome.closed, 0, "half the position is still held");
  assert.deepEqual(h.closed, []);
});

test("an empty book is a clean no-op", async () => {
  const h = harness({ positions: [] });
  const outcome = await monitorTick(h.deps);
  assert.deepEqual(outcome, { checked: 0, exits: 0, closed: 0, errors: 0 });
});

test("one failing position does not stop the rest of the book being checked", async () => {
  // A single corrupt row must not block every other user's stop-loss from firing.
  const h = harness({
    price: 0.5,
    positions: [position({ id: "bad" }), position({ id: "good", userId: "user-2" })]
  });
  const deps: MonitorDeps = {
    ...h.deps,
    async sell(input) {
      if (input.position.id === "bad") throw new Error("corrupt row");
      return h.deps.sell(input);
    }
  };

  const outcome = await monitorTick(deps);

  assert.equal(outcome.checked, 2);
  assert.equal(outcome.errors, 1);
  assert.deepEqual(h.closed, ["good"], "the healthy position still stopped out");
});

test("a failure loading the book is reported, not thrown", async () => {
  // The scheduler calls this on a timer; throwing would 500 every tick.
  const h = harness();
  const deps: MonitorDeps = {
    ...h.deps,
    async getOpenPositions() {
      throw new Error("database unreachable");
    }
  };

  const outcome = await monitorTick(deps);
  assert.deepEqual(outcome, { checked: 0, exits: 0, closed: 0, errors: 1 });
});
