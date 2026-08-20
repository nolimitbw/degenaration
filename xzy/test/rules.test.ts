import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateExit, validateRules, gainPercent } from "../lib/trading/rules.ts";
import type { ExitRules } from "../lib/trading/rules.ts";

const rules = (takeProfits: { gainPct: number; sellPct: number; hit?: boolean }[], stopLossPct: number | null = null): ExitRules => ({
  takeProfits,
  stopLossPct
});

const at = (entry: number, current: number, r: ExitRules, remaining = 1) =>
  evaluateExit({ entryPriceUsd: entry, currentPriceUsd: current, remainingFraction: remaining, rules: r });

test("gainPercent measures change from entry", () => {
  // Compared with a tolerance because binary floats cannot represent these exactly:
  // 1 -> 0.7 evaluates to -30.000000000000004. The residue is far below any trigger
  // granularity, and it errs toward firing a stop at its threshold rather than missing
  // it, which the boundary test below pins down.
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  close(gainPercent(1, 2), 100);
  close(gainPercent(1, 0.7), -30);
  close(gainPercent(1, 1), 0);
  assert.equal(gainPercent(0, 5), 0, "a zero entry cannot produce a gain");
});

test("holds while below every trigger", () => {
  assert.deepEqual(at(1, 1.5, rules([{ gainPct: 100, sellPct: 50 }], 30)), []);
});

test("fires a take-profit level once the gain is reached", () => {
  const actions = at(1, 2, rules([{ gainPct: 100, sellPct: 50 }]));
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "take_profit");
  assert.equal(actions[0]?.sellFraction, 0.5);
  assert.equal(actions[0]?.levelIndex, 0);
});

test("sell percentages are of the ORIGINAL position, not what remains", () => {
  // "50% at 2x, 50% at 3x" must sell the whole position, not 50% then 25%.
  const ladder = rules([
    { gainPct: 100, sellPct: 50 },
    { gainPct: 200, sellPct: 50 }
  ]);
  const first = at(1, 2, ladder);
  assert.equal(first[0]?.sellFraction, 0.5);

  // Second level fires later, with half the position left.
  const laddderAfterFirst = rules([
    { gainPct: 100, sellPct: 50, hit: true },
    { gainPct: 200, sellPct: 50 }
  ]);
  const second = at(1, 3, laddderAfterFirst, 0.5);
  assert.equal(second[0]?.sellFraction, 0.5, "the whole remaining half is sold");
});

test("a level already hit never fires again", () => {
  const actions = at(1, 5, rules([{ gainPct: 100, sellPct: 50, hit: true }]), 0.5);
  assert.deepEqual(actions, []);
});

test("a gap up through several levels fires them lowest-first", () => {
  const actions = at(
    1,
    10,
    rules([
      { gainPct: 200, sellPct: 30 },
      { gainPct: 100, sellPct: 40 },
      { gainPct: 500, sellPct: 30 }
    ])
  );
  assert.equal(actions.length, 3);
  assert.deepEqual(
    actions.map((a) => a.sellFraction),
    [0.4, 0.3, 0.3],
    "fired in ascending gain order regardless of how they were listed"
  );
});

test("never sells more than is actually held", () => {
  const actions = at(1, 10, rules([{ gainPct: 100, sellPct: 100 }]), 0.25);
  assert.equal(actions[0]?.sellFraction, 0.25);
});

test("stop loss exits the whole remaining position", () => {
  const actions = at(1, 0.6, rules([{ gainPct: 100, sellPct: 50 }], 30), 0.8);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "stop_loss");
  assert.equal(actions[0]?.sellFraction, 0.8);
});

test("stop loss wins when price gapped down past a take-profit", () => {
  // The position is underwater now; selling into a 2x it is no longer at would be wrong.
  const actions = at(1, 0.5, rules([{ gainPct: 100, sellPct: 50 }], 30));
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "stop_loss");
});

test("stop loss fires exactly at the trigger, not only past it", () => {
  assert.equal(at(1, 0.7, rules([], 30))[0]?.kind, "stop_loss");
  assert.deepEqual(at(1, 0.71, rules([], 30)), []);
});

test("a broken price feed never triggers an exit", () => {
  // Zero, negative, and NaN prices are outages. Panic-selling on them is the real loss.
  assert.deepEqual(at(1, 0, rules([{ gainPct: 100, sellPct: 50 }], 30)), []);
  assert.deepEqual(at(1, -5, rules([], 30)), []);
  assert.deepEqual(at(1, Number.NaN, rules([], 30)), []);
  assert.deepEqual(at(0, 5, rules([{ gainPct: 100, sellPct: 50 }])), []);
});

test("a fully exited position produces nothing further", () => {
  assert.deepEqual(at(1, 10, rules([{ gainPct: 100, sellPct: 50 }]), 0), []);
});

test("validateRules rejects a ladder that sells more than the position", () => {
  const result = validateRules({ takeProfits: [{ gainPct: 100, sellPct: 60 }, { gainPct: 200, sellPct: 60 }] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /more than the position/);
});

test("validateRules rejects duplicate triggers and bad numbers", () => {
  assert.equal(validateRules({ takeProfits: [{ gainPct: 100, sellPct: 25 }, { gainPct: 100, sellPct: 25 }] }).ok, false);
  assert.equal(validateRules({ takeProfits: [{ gainPct: 0, sellPct: 50 }] }).ok, false);
  assert.equal(validateRules({ takeProfits: [{ gainPct: 100, sellPct: 0 }] }).ok, false);
  assert.equal(validateRules({ takeProfits: [{ gainPct: 100, sellPct: 101 }] }).ok, false);
  assert.equal(validateRules({ stopLossPct: 0 }).ok, false);
  assert.equal(validateRules({ stopLossPct: 100 }).ok, false);
});

test("validateRules sorts levels and clears hit flags", () => {
  const result = validateRules({
    takeProfits: [{ gainPct: 300, sellPct: 25 }, { gainPct: 100, sellPct: 25 }],
    stopLossPct: 40
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.rules.takeProfits.map((l) => l.gainPct), [100, 300]);
  assert.equal(result.rules.takeProfits.every((l) => l.hit === false), true);
  assert.equal(result.rules.stopLossPct, 40);
});

test("a full ladder plus stop loss round-trips", () => {
  const result = validateRules({
    takeProfits: [
      { gainPct: 50, sellPct: 25 },
      { gainPct: 100, sellPct: 25 },
      { gainPct: 300, sellPct: 25 },
      { gainPct: 1000, sellPct: 25 }
    ],
    stopLossPct: 35
  });
  assert.equal(result.ok, true);
});
