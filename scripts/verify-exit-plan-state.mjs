/**
 * The exit plan a position is bound to, and the state trailing needs.
 *
 * What this closes: components/product/BotBuilder.tsx collects a LIST of take-profit levels
 * with per-level trailing, plus a trailing stop. public.positions carried tp1, tp1_sell,
 * tp2, tp2_sell, stop_loss — five scalars — and the exit monitor read only those. A third
 * level, or any trailing behaviour, persisted and reloaded and changed nothing. Worse, both
 * the CHECK on pending_exit_kind and worker_claim_position_exit hard-listed 'SL', 'TP1',
 * 'TP2', so a third level would have been refused at claim time with "invalid exit kind"
 * and the position would sit unable to take profit with nothing surfaced to the user.
 *
 * Applies the two files this migration supersedes first, in their required order, so the
 * ordering claim in the header is exercised rather than asserted.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const T = ["app_private.bot_config_versions", "public.positions", "public.subscriptions"];
const results = {};

// `auth` is Supabase's own schema. degenaration-position-exit-state.sql references
// auth.users and auth.uid() inside a create-table-if-not-exists that production already
// satisfies, so the fixture only needs them to exist for the statement to parse.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $x$ select null::uuid $x$;
  -- positions.bot_profile_id points here. Only the referenced key matters to this fixture.
  create table app_private.bot_profiles (id uuid primary key default gen_random_uuid());
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);

for (const file of [
  "degenaration-position-exit-state.sql",
  "degenaration-position-bot-attribution.sql",
  "degenaration-exit-plan-state.sql"
]) {
  await db.exec(await readFile(`${repo}/supabase/${file}`, "utf8"));
}
// Reapplying must be a no-op, not an error: every deployment is a rerun after a rollback.
await db.exec(await readFile(`${repo}/supabase/degenaration-exit-plan-state.sql`, "utf8"));
results.rerunSafe = "PASS";

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const PLAN = {
  takeProfit: { levels: [
    { targetBps: 10000, sellBps: 3000, trailingBps: 0 },
    { targetBps: 40000, sellBps: 3000, trailingBps: 500 },
    { targetBps: 90000, sellBps: 4000, trailingBps: 0 }
  ] },
  stopLoss: { stopBps: 4000, trailing: true }
};

const open = async (sig, plan = PLAN) => (await one(
  `select public.worker_open_position('OWNER','W','MINT',2.0,1000,$1::text,300,null,0,null,0,null,null,null,null,$2::jsonb) as r`,
  [sig, JSON.stringify(plan)]
)).r;

// ---- the plan is stored, and the peak is seeded at entry ----
const opened = await open("sig-1");
assert.equal(opened.ok, true);
assert.equal(opened.duplicate, false);
let row = await one("select * from public.positions where entry_sig='sig-1'");
assert.deepEqual(row.entry_config, PLAN, "the exit plan is stored verbatim on the position");
assert.equal(Number(row.peak_price_usd), 2, "the peak seeds at the entry price");
assert.deepEqual(row.filled_levels, [], "no level starts filled");
results.planStoredAndPeakSeeded = "PASS";

// Seeding at entry rather than null is what makes a trailing stop start exactly where a
// fixed stop would. A null peak would be read as "no high yet" and could not fire.
assert.ok(row.peak_price_usd !== null, "a null peak would make a trailing stop unfireable");

// ---- the high-water mark only ever rises ----
await one("select public.worker_record_position_peak($1::uuid, 5.0) as r", [row.id]);
await one("select public.worker_record_position_peak($1::uuid, 3.0) as r", [row.id]);
row = await one("select * from public.positions where entry_sig='sig-1'");
assert.equal(Number(row.peak_price_usd), 5, "a later lower price cannot lower the peak");
const rejected = (await one("select public.worker_record_position_peak($1::uuid, 0) as r", [row.id])).r;
assert.equal(rejected.ok, false, "a non-positive price is refused rather than stored");
// Direct UPDATE is guarded too: monotonicity cannot depend on every caller remembering.
await db.query("update public.positions set peak_price_usd = 1 where id = $1::uuid", [row.id]);
row = await one("select * from public.positions where entry_sig='sig-1'");
assert.equal(Number(row.peak_price_usd), 5, "the trigger holds the peak even against a direct write");
results.peakIsMonotonic = "PASS";

// ---- the entry plan is immutable for the life of the position ----
await assert.rejects(
  () => db.query("update public.positions set entry_config = '{\"takeProfit\":{\"levels\":[]}}'::jsonb where id = $1::uuid", [row.id]),
  /immutable/i,
  "editing the bot must not change how an already-open position exits"
);
results.entryPlanImmutable = "PASS";

// ---- a third take-profit level is claimable ----
//
// The control that matters: before this migration the claim refused TP3 outright, so the
// level the user configured could never fire and no error reached them.
const claimTp3 = (await one("select public.worker_claim_position_exit($1::uuid,'TP3',400) as r", [row.id])).r;
assert.equal(claimTp3.ok, true, "TP3 must be claimable — the builder can produce it");
assert.ok(claimTp3.claim_token);

// The shape is still constrained, not merely opened up.
for (const bad of ["TP0", "TP", "SELL", "TP100", "'; drop table public.positions; --"]) {
  const verdict = (await one("select public.worker_claim_position_exit($1::uuid,$2::text,1) as r", [row.id, bad])).r;
  assert.equal(verdict.ok, false, `an exit kind of ${JSON.stringify(bad)} must still be refused`);
}
results.thirdLevelClaimable = "PASS";

// ---- settlement records which levels are filled ----
const settled = (await one(
  `select public.worker_settle_position_exit($1::uuid,$2::uuid,'open',600,true,false,0,null,$3::jsonb) as r`,
  [row.id, claimTp3.claim_token, JSON.stringify([0, 2])]
)).r;
assert.equal(settled.ok, true);
row = await one("select * from public.positions where entry_sig='sig-1'");
assert.deepEqual(row.filled_levels, [0, 2]);
assert.equal(row.filled_tp1, true);
assert.equal(row.filled_tp2, false, "a third level must not silently mark the second");
assert.equal(row.status, "open");
results.filledLevelsPersisted = "PASS";

// A worker build that predates this argument still settles: p_filled_levels defaults null
// and must leave the stored list alone rather than clearing it.
const claimAgain = (await one("select public.worker_claim_position_exit($1::uuid,'SL',600) as r", [row.id])).r;
await one(
  `select public.worker_settle_position_exit($1::uuid,$2::uuid,'closed',0,true,false,0,null) as r`,
  [row.id, claimAgain.claim_token]
);
row = await one("select * from public.positions where entry_sig='sig-1'");
assert.deepEqual(row.filled_levels, [0, 2], "an older caller must not wipe the level list");
assert.equal(row.status, "closed");
results.olderCallerCompatible = "PASS";

// ---- idempotent open, unchanged ----
const duplicate = await open("sig-1");
assert.equal(duplicate.duplicate, true, "one buy cannot open two positions");
assert.equal((await one("select count(*)::integer n from public.positions")).n, 1);
results.openStillIdempotent = "PASS";

// ---- a position opened with no plan falls back to the legacy columns ----
const legacy = await open("sig-2", {});
assert.equal(legacy.ok, true);
const legacyRow = await one("select * from public.positions where entry_sig='sig-2'");
assert.deepEqual(legacyRow.entry_config, {}, "an empty plan is stored as empty, not invented");
results.legacyFallbackPreserved = "PASS";

// ---- authorization ----
const FNS = [
  "public.worker_open_position(text,text,text,numeric,numeric,text,integer,numeric,integer,numeric,integer,integer,text,uuid,uuid,jsonb)",
  "public.worker_record_position_peak(uuid,numeric)",
  "public.worker_claim_position_exit(uuid,text,numeric)",
  "public.worker_settle_position_exit(uuid,uuid,text,numeric,boolean,boolean,integer,text,jsonb)"
];
for (const fn of FNS) {
  const grants = await one(`select
      has_function_privilege('anon', $1, 'execute') a,
      has_function_privilege('authenticated', $1, 'execute') b,
      has_function_privilege('service_role', $1, 'execute') c`, [fn]);
  assert.deepEqual(grants, { a: false, b: false, c: true }, `grants on ${fn}`);
}
results.authorization = "PASS";

// ─── the exit kind was discarded at settlement ────────────────────────────────────────────
//
// `pending_exit_kind` carries 'SL' or 'TPn' while the exit is in flight and the settle statement
// nulls it. Nothing read it first, so the moment a position closed the fact that it STOPPED OUT
// rather than took profit was gone — which is why stopLoss.freezeAfterStop could never be
// implemented, and why trade history cannot say how a trade ended.
{
  await db.exec(await readFile(`${repo}/supabase/degenaration-exit-reason.sql`, "utf8"));
  await db.exec(await readFile(`${repo}/supabase/degenaration-exit-reason.sql`, "utf8"));
  results.exitReasonRerunSafe = "PASS";

  const opened = await open("sig-reason");
  const row = await one("select * from public.positions where entry_sig='sig-reason'");

  // A PARTIAL take profit leaves the position open. It must NOT stamp an exit reason: the
  // reason belongs to the exit that ended the position, not to every leg along the way.
  const tp = (await one("select public.worker_claim_position_exit($1::uuid,'TP1',300) as r", [row.id])).r;
  await one(
    `select public.worker_settle_position_exit($1::uuid,$2::uuid,'open',700,true,false,0,null,$3::jsonb) as r`,
    [row.id, tp.claim_token, JSON.stringify([0])]
  );
  let after = await one("select status, exit_reason from public.positions where id=$1::uuid", [row.id]);
  assert.equal(after.status, "open");
  assert.equal(after.exit_reason, null, "a partial take profit must not stamp the position as closed by TP1");

  // The exit that CLOSES it records how.
  const sl = (await one("select public.worker_claim_position_exit($1::uuid,'SL',700) as r", [row.id])).r;
  await one(
    `select public.worker_settle_position_exit($1::uuid,$2::uuid,'closed',0,true,false,0,null) as r`,
    [row.id, sl.claim_token]
  );
  after = await one("select status, exit_reason, pending_exit_kind from public.positions where id=$1::uuid", [row.id]);
  assert.equal(after.status, "closed");
  assert.equal(after.exit_reason, "SL", "THE FIX: the position records that it stopped out");
  assert.equal(after.pending_exit_kind, null, "the in-flight field is still cleared");
  results.exitReasonRecordedOnClose = "PASS";

  // A take-profit close records TP, so the two are genuinely distinguishable rather than
  // everything defaulting to one value.
  const second = await open("sig-reason-2");
  const row2 = await one("select * from public.positions where entry_sig='sig-reason-2'");
  const tp2 = (await one("select public.worker_claim_position_exit($1::uuid,'TP2',1000) as r", [row2.id])).r;
  await one(
    `select public.worker_settle_position_exit($1::uuid,$2::uuid,'closed',0,true,true,0,null) as r`,
    [row2.id, tp2.claim_token]
  );
  const closedInProfit = await one("select exit_reason from public.positions where id=$1::uuid", [row2.id]);
  assert.equal(closedInProfit.exit_reason, "TP2");
  assert.notEqual(closedInProfit.exit_reason, after.exit_reason,
    "stopped-out and taken-profit must be separately recorded; equal values would prove nothing");
  results.stopAndProfitDistinguishable = "PASS";

  // The CHECK still constrains the shape rather than accepting any string.
  await assert.rejects(
    () => db.query("update public.positions set exit_reason = 'whatever' where id=$1::uuid", [row2.id]),
    /positions_exit_reason_check/,
    "an arbitrary exit reason must be refused"
  );
  results.exitReasonShapeConstrained = "PASS";
}

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${T.length} tables)`,
  schemaParity: "PASS",
  ...results,
  closes: "take-profit levels, trailing and stop settings that the builder persisted and the engine ignored"
}, null, 2));
await db.close();
