/**
 * Settlement writer: the missing writer for trade_executions, positions and position_lots.
 *
 * Spec 5.4, and the keystone for 5.6 (platform fee), section 8 (admin volume), section 13
 * (Portfolio history) and the PnL cards. Before this, all three tables were read by four
 * surfaces and written by nothing.
 *
 * The property that matters most and that the control run targets: a settled buy must create
 * exactly ONE execution, and a replayed settle must not charge a second fee.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const fanoutSql = await readFile(`${repo}/supabase/degenaration-trade-intent-fanout.sql`, "utf8");
const settleSql = await readFile(`${repo}/supabase/degenaration-settlement-writer.sql`, "utf8");

const FIXTURE_TABLES = [
  "app_private.bot_config_versions",
  "app_private.app_users",
  "app_private.trade_intents",
  "public.subscriptions",
  "public.calls",
  "app_private.call_executions",
  "public.copy_subscriptions",
  "app_private.copy_executions",
  "app_private.trade_executions"
];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.ensure_app_user(p text) returns void
  language plpgsql security definer set search_path = '' as $x$
  begin insert into app_private.app_users (privy_user_id) values (trim(p))
        on conflict (privy_user_id) do nothing; end $x$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);

// positions / position_lots, captured production shape.
await db.exec(`
  create table app_private.positions (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null,
    bot_id uuid, config_version_id uuid,
    mint text not null, status text not null,
    quantity_base_units numeric not null, cost_lamports bigint not null,
    realized_pnl_lamports bigint not null default 0, fees_lamports bigint not null default 0,
    entry_config_snapshot jsonb not null default '{}'::jsonb,
    opened_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    closed_at timestamptz
  );
  create table app_private.position_lots (
    id uuid primary key default gen_random_uuid(),
    position_id uuid not null references app_private.positions(id),
    entry_execution_id uuid not null,
    quantity_base_units numeric not null, remaining_base_units numeric not null,
    cost_lamports bigint not null, created_at timestamptz not null default now()
  );
`);
await db.exec(fanoutSql);
await db.exec(settleSql);
// Spec 5.4 measurement fields: the worker reports them through the queue and settlement
// carries them into the ledger.
await db.exec(await readFile(`${repo}/supabase/degenaration-execution-record-fields.sql`, "utf8"));

const results = {};
const OWNER = "did:privy:alice";
const MINT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";
const SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const CALL = "cccccccc-0000-0000-0000-000000000001";

await db.query("insert into app_private.app_users (privy_user_id) values ($1::text)", [OWNER]);
await db.query(
  `insert into public.subscriptions (id, group_id, privy_user_id, user_pubkey, wallet_id,
     size_sol, daily_cap_sol, enabled)
   values ($1::uuid,$2::uuid,$3::text,'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1','pw-1',
           0.5::numeric, 5::numeric, true)`, [SUB, GROUP, OWNER]);
await db.query("insert into public.calls (id, group_id, mint) values ($1::uuid,$2::uuid,$3::text)",
  [CALL, GROUP, MINT]);

const exec = await db.query(
  `insert into app_private.call_executions (call_id, subscription_id, claim_token, status, amount_sol)
   values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',0.5::double precision)
   returning id, intent_id`, [CALL, SUB]).then(r => r.rows[0]);
assert.ok(exec.intent_id, "the fan-out trigger created the intent");

// ---- nothing is written before settlement -------------------------------------------
assert.equal((await db.query("select count(*)::integer n from app_private.trade_executions")).rows[0].n, 0);
assert.equal((await db.query("select count(*)::integer n from app_private.positions")).rows[0].n, 0);
results.nothingWrittenBeforeSettlement = "PASS";

// ---- a settled buy writes the full chain ---------------------------------------------
await db.query(
  "update app_private.call_executions set status='succeeded', tx_signature='sig-1' where id=$1::uuid",
  [exec.id]);

const te = (await db.query("select * from app_private.trade_executions")).rows;
assert.equal(te.length, 1, "exactly one execution");
assert.equal(te[0].owner_privy_user_id, OWNER);
assert.equal(te[0].status, "reconciled");
assert.equal(te[0].tx_signature, "sig-1");
assert.equal(String(te[0].gross_notional_lamports), "500000000", "executed notional in integer lamports");
assert.ok(te[0].reconciled_at, "reconciliation is timestamped");
results.executionWritten = "PASS";

const pos = (await db.query("select * from app_private.positions")).rows;
assert.equal(pos.length, 1, "a position is opened");
assert.equal(pos[0].mint, MINT);
assert.equal(pos[0].status, "open");
assert.equal(String(pos[0].cost_lamports), "500000000");
results.positionOpened = "PASS";

const lots = (await db.query("select * from app_private.position_lots")).rows;
assert.equal(lots.length, 1, "an entry lot is recorded — this is what PnL cards need");
assert.equal(lots[0].position_id, pos[0].id);
assert.equal(lots[0].entry_execution_id, te[0].id);
assert.equal(String(lots[0].cost_lamports), "500000000");
results.entryLotRecorded = "PASS";

const intent = (await db.query("select state from app_private.trade_intents where id=$1::uuid",
  [exec.intent_id])).rows[0];
assert.equal(intent.state, "reconciled", "the intent reaches its true terminal accounting state");
results.intentReconciled = "PASS";

// ---- replay must not charge a second fee ----------------------------------------------
await db.query("update app_private.call_executions set status='succeeded' where id=$1::uuid", [exec.id]);
assert.equal((await db.query("select count(*)::integer n from app_private.trade_executions")).rows[0].n, 1,
  "a replayed settle must not create a second execution or a second fee");
assert.equal((await db.query("select count(*)::integer n from app_private.positions")).rows[0].n, 1,
  "nor a second position");
results.replayChargesNothingExtra = "PASS";

// ---- the fee is honest about what was actually charged --------------------------------
assert.equal(String(te[0].platform_fee_lamports), "0",
  "PLATFORM_FEE_ACCOUNT is unset so Jupiter collects nothing; writing 200 bps here would be " +
  "a fabricated accounting row");
assert.equal(te[0].platform_fee_bps_snapshot, 0);
assert.equal(String(te[0].creator_fee_lamports), "0",
  "creator share is funded FROM the platform fee, so it cannot exist while the fee is zero");
results.feeReflectsRealityNotAspiration = "PASS";

// ---- a failed settle writes nothing ------------------------------------------------------
const CALL2 = "cccccccc-0000-0000-0000-000000000002";
await db.query("insert into public.calls (id, group_id, mint) values ($1::uuid,$2::uuid,$3::text)",
  [CALL2, GROUP, MINT]);
const exec2 = await db.query(
  `insert into app_private.call_executions (call_id, subscription_id, claim_token, status, amount_sol)
   values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',0.25::double precision)
   returning id`, [CALL2, SUB]).then(r => r.rows[0]);
await db.query("update app_private.call_executions set status='failed' where id=$1::uuid", [exec2.id]);
assert.equal((await db.query("select count(*)::integer n from app_private.trade_executions")).rows[0].n, 1,
  "a failed execution settles nothing into the ledger");
results.failedSettlesNothing = "PASS";

// ---- spec 5.4 measurements travel from the worker into the ledger -----------------------
const CALL3 = "cccccccc-0000-0000-0000-000000000003";
await db.query("insert into public.calls (id, group_id, mint) values ($1::uuid,$2::uuid,$3::text)",
  [CALL3, GROUP, MINT]);
const exec3 = await db.query(
  `insert into app_private.call_executions (call_id, subscription_id, claim_token, status, amount_sol)
   values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',0.75::double precision)
   returning id, intent_id`, [CALL3, SUB]).then(r => r.rows[0]);
await db.query(
  `update app_private.call_executions set status='succeeded', tx_signature='sig-3',
     slot=280000000, executed_base_units=1234567, average_price_usd=0.00042,
     slippage_bps=125, price_impact_bps=-88
   where id=$1::uuid`, [exec3.id]);

const measured = (await db.query(
  "select * from app_private.trade_executions where intent_id=$1::uuid", [exec3.intent_id])).rows[0];
assert.equal(String(measured.slot), "280000000", "the confirmed slot reaches the ledger");
assert.equal(String(measured.executed_base_units), "1234567", "what actually filled, not what was requested");
assert.equal(Number(measured.average_price_usd), 0.00042);
assert.equal(measured.slippage_bps, 125);
assert.equal(measured.price_impact_bps, -88, "impact may be negative — it is a signed measurement");

const measuredLot = (await db.query(
  `select l.* from app_private.position_lots l
     join app_private.positions p on p.id = l.position_id
    where p.mint = $1::text order by l.created_at desc limit 1`, [MINT])).rows[0];
assert.equal(String(measuredLot.quantity_base_units), "1234567",
  "the lot records the filled quantity, so average entry is real rather than notional");
results.measurementsReachTheLedger = "PASS";

// A reporting bug must fail loudly rather than land in the ledger.
await assert.rejects(
  () => db.query(`update app_private.trade_executions set slippage_bps = 10001 where id=$1::uuid`,
    [measured.id]),
  /measurement_bounds|violates check/i,
  "an out-of-range slippage is a reporting bug, not a market condition");
results.measurementBoundsEnforced = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results,
  unblocks: "5.6 fee accrual (triggers already exist), section 8 admin volume, " +
            "section 13 Portfolio history, PnL cards (position_lots now populated)",
  stillMissing: "nothing WRITES the measurement fields yet -- the columns and the carry-through " +
                "exist, and populating them needs the worker (E-3). Until then they are null, " +
                "which reads as not-captured rather than measured-as-zero"
}, null, 2));

await db.close();
