/**
 * `worker_record_dca_fill` — and the four ways adding to a position corrupts its exit plan.
 *
 * The decision layer is unit-tested in server/test/run.js. This is the WRITE, against real
 * PostgreSQL, and what it guards is subtler than "does the row grow":
 *
 *   1. the average entry must move, or every exit threshold stays anchored to a price the
 *      position no longer averages — the stop sits far below where the user's money actually
 *      is, which is the opposite of averaging down;
 *   2. `original_amount_raw` must grow with it, or every take-profit level sells a smaller
 *      share of a larger position and strands tokens the user asked to be sold;
 *   3. the peak must be rebased, or a trailing stop believes the position has fallen further
 *      from its high than it has, and fires early;
 *   4. a replay must add nothing — a worker that dies between submitting and recording has to
 *      be able to retry without buying twice.
 *
 * PGlite, schema rendered from the captured production shapes. Nothing touches production.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const results = {};
const T = ["public.positions"];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
// Columns later migrations add, all present in production, none of them in the capture:
// peak_price_usd and filled_levels from degenaration-exit-plan-state.sql, stop_breached_at
// from degenaration-stop-breach-state.sql. Stubbed rather than applying those files, whose own
// dependency chains are far larger than the two columns this function touches.
await db.exec(`
  alter table public.positions
    add column if not exists peak_price_usd numeric,
    add column if not exists filled_levels jsonb not null default '[]'::jsonb,
    add column if not exists entry_config jsonb,
    add column if not exists stop_breached_at timestamptz;
`);

const sql = async (name) => readFile(`${repo}/supabase/${name}`, "utf8");
await db.exec(await sql("degenaration-dca-placement.sql"));
await db.exec(await sql("degenaration-dca-placement.sql"));
results.rerunSafe = "PASS";

const one = async (text, params = []) => (await db.query(text, params)).rows[0];
const fill = async (id, level, amount, price, sig = null) => (await one(
  "select public.worker_record_dca_fill($1::uuid,$2::integer,$3::numeric,$4::numeric,$5::text) as r",
  // `null` stays null rather than becoming the string "null" — the bad-input block below
  // deliberately passes a null price, and stringifying it would test a parse error instead of
  // the guard.
  [id, level, amount == null ? null : String(amount), price == null ? null : String(price), sig]
)).r;
const row = async (id) => one("select * from public.positions where id=$1::uuid", [id]);

let seq = 0;
async function position({ amount = 1000, original = 1000, entry = 1, peak = null, status = "open" } = {}) {
  seq += 1;
  return one(
    `insert into public.positions
       (user_pubkey, mint, entry_price_usd, amount_raw, original_amount_raw, entry_sig,
        status, peak_price_usd)
     values ('PUBKEY', 'MINT-' || $5::text, $1::numeric, $2::numeric, $3::numeric,
             'sig-' || $5::text, $4::text, $6::numeric)
     returning *`,
    [entry, amount, original, status, String(seq), peak]
  );
}

// ── authorization ───────────────────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const granted = await one(
    "select has_function_privilege($1::text,'public.worker_record_dca_fill(uuid,integer,numeric,numeric,text)','execute') as g",
    [role]
  );
  assert.equal(granted.g, false, `${role} must not be able to add to a position`);
}
results.authorization = "PASS";

// ── THE AVERAGE ENTRY MOVES, volume-weighted ────────────────────────────────────────────────
//
// 1000 units at 1.00, then 1000 more at 0.50, is 2000 at 0.75. If entry stayed at 1.00 the
// stop would sit where the position no longer is.
{
  const p = await position({ amount: 1000, original: 1000, entry: 1 });
  const result = await fill(p.id, 0, 1000, 0.5, "SIG-A");
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);

  const after = await row(p.id);
  assert.equal(Number(after.amount_raw), 2000);
  assert.equal(Number(after.entry_price_usd), 0.75, "the average entry must be volume-weighted");
  assert.notEqual(Number(after.entry_price_usd), 1, "leaving entry at its original price anchors every exit to a price the position no longer averages");
  results.averageEntryIsVolumeWeighted = "PASS";

  // ── original_amount_raw grows too ─────────────────────────────────────────────────────────
  //
  // Take-profit allocations are percentages of the ORIGINAL. Left at 1000, a 50% level would
  // sell 500 of 2000 — a quarter of the position, for a user who asked for half.
  assert.equal(Number(after.original_amount_raw), 2000,
    "the original must grow, or every take-profit level sells a smaller share than configured");
  results.originalGrowsSoTakeProfitSharesHold = "PASS";

  // ── the peak is rebased ───────────────────────────────────────────────────────────────────
  //
  // The monitor floors the peak MULTIPLE at 1 by dividing peak_price by entry. With entry
  // raised to 0.75 and a stale peak of 1.00, a trailing stop would compute a 25% drawdown from
  // a high the position never made after averaging, and fire early.
  assert.ok(Number(after.peak_price_usd) >= Number(after.entry_price_usd),
    "the peak must never sit below the new average entry, or trailing fires against a drawdown that did not happen");
  results.peakRebasedToTheNewEntry = "PASS";
}

// ── a replay adds NOTHING ───────────────────────────────────────────────────────────────────
{
  const p = await position({ amount: 1000, original: 1000, entry: 1 });
  await fill(p.id, 0, 500, 0.6, "SIG-B");
  const afterFirst = await row(p.id);

  const replay = await fill(p.id, 0, 500, 0.6, "SIG-B");
  assert.equal(replay.ok, true, "a replay must not look like a fault to a retrying worker");
  assert.equal(replay.duplicate, true);

  const afterReplay = await row(p.id);
  assert.equal(Number(afterReplay.amount_raw), Number(afterFirst.amount_raw), "a replay must add no tokens");
  assert.equal(Number(afterReplay.entry_price_usd), Number(afterFirst.entry_price_usd), "and must not move the entry again");
  assert.equal(afterReplay.filled_dca_levels.length, 1);

  // A DIFFERENT level on the same position is not a replay and does apply.
  const second = await fill(p.id, 1, 500, 0.4, "SIG-C");
  assert.equal(second.duplicate, false);
  assert.deepEqual((await row(p.id)).filled_dca_levels, [0, 1]);
  results.replayAddsNothing = "PASS";
}

// ── a position that is not open is never added to ───────────────────────────────────────────
//
// Buying into a position that is already selling is how an exit undersells: the sell amount was
// computed from a balance that grew underneath it.
{
  for (const status of ["exiting", "closed"]) {
    // Inserted OPEN and then transitioned, because positions_check1 refuses `exiting` without
    // a claim token — the constraint degenaration-position-exit-state.sql added so a position
    // cannot claim to be selling without the claim that authorises the sale.
    const p = await position();
    await db.query(
      `update public.positions
       set status = $2::text,
           pending_exit_kind = case when $2::text = 'exiting' then 'SL' end,
           pending_exit_sig = case when $2::text = 'exiting' then 'pending-sig-' || $1::text end,
           pending_exit_claim_token = case when $2::text = 'exiting' then gen_random_uuid() end,
           closed_at = case when $2::text = 'closed' then now() end
       where id = $1::uuid`,
      [p.id, status]
    );
    const refused = await fill(p.id, 0, 500, 0.5);
    assert.equal(refused.ok, false, `${status} must be refused`);
    assert.match(refused.error, /not open/);
    assert.equal(Number((await row(p.id)).amount_raw), 1000, "and nothing may be added");
  }
  results.onlyOpenPositionsGrow = "PASS";
}

// ── the stop-breach clock is cleared ────────────────────────────────────────────────────────
//
// A breach observed before the fill was measured against the OLD entry. The threshold has just
// moved, so holding the clock would fire a delayed stop against a price that is no longer the
// one it was armed on.
{
  const p = await position({ amount: 1000, original: 1000, entry: 1 });
  await db.query("update public.positions set stop_breached_at = now() where id=$1::uuid", [p.id]);
  await fill(p.id, 0, 1000, 0.5, "SIG-D");
  assert.equal((await row(p.id)).stop_breached_at, null,
    "a fill moves the threshold, so a breach measured against the old one is stale");
  results.staleStopBreachCleared = "PASS";
}

// ── bad input is refused, not coerced ───────────────────────────────────────────────────────
{
  const p = await position();
  for (const [args, pattern] of [
    [[-1, 500, 0.5], /invalid level/],
    [[0, 0, 0.5], /invalid amount/],
    [[0, -5, 0.5], /invalid amount/],
    // A zero or missing fill price would make the volume-weighting divide the average toward
    // zero, which silently destroys the exit plan rather than failing.
    [[0, 500, 0], /invalid fill price/],
    [[0, 500, null], /invalid fill price/]
  ]) {
    const refused = await fill(p.id, args[0], args[1], args[2] === null ? null : args[2]);
    assert.equal(refused.ok, false);
    assert.match(refused.error, pattern);
  }
  assert.equal(Number((await row(p.id)).amount_raw), 1000, "no refusal may have changed the row");
  results.badInputRefused = "PASS";
}

// ── a missing position is a 404, not a silent success ───────────────────────────────────────
{
  const missing = await fill("00000000-0000-0000-0000-000000000000", 0, 500, 0.5);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
  results.missingPositionRefused = "PASS";
}

// ── CONTROL: the weighting is not a no-op ───────────────────────────────────────────────────
//
// Every assertion above would also pass if the function simply refused everything or copied
// the fill price straight in. This drives three fills and checks the arithmetic end to end.
{
  const p = await position({ amount: 1000, original: 1000, entry: 1 });
  await fill(p.id, 0, 1000, 0.8, "C1");   // 2000 @ 0.90
  await fill(p.id, 1, 2000, 0.5, "C2");   // 4000 @ 0.70
  const after = await row(p.id);
  assert.equal(Number(after.amount_raw), 4000);
  assert.equal(Number(after.entry_price_usd), 0.7, "CONTROL FAILED: three-leg weighting must be exact");
  assert.equal(Number(after.original_amount_raw), 4000);
  assert.deepEqual(after.filled_dca_levels, [0, 1]);
  results.controlProvesTheWeightingIsExact = "PASS";
}

console.log(JSON.stringify({
  verifier: "dca-placement",
  database: "PGlite (real PostgreSQL), schema rendered from the captured production shapes",
  migration: "supabase/degenaration-dca-placement.sql",
  properties: Object.keys(results).length,
  ...results,
  proves:
    "a DCA fill moves the average entry by volume weight, grows the original so take-profit " +
    "shares stay the size the user configured, rebases the peak so trailing does not fire " +
    "against a drawdown that did not happen, clears a stop breach measured against the old " +
    "threshold, adds nothing on replay, refuses a position that is not open, refuses invalid " +
    "input rather than coercing it, and is callable by neither anon nor authenticated",
  notProven:
    "that a fill has ever been placed against a live pool — that needs the worker running " +
    "with a funded wallet (E-3) and is deliberately not exercised here"
}, null, 2));

await db.close();
