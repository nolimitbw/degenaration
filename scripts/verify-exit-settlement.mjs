/**
 * Exit settlement: lot consumption, realized PnL, position closure.
 *
 * Spec 5.4 and 5.5. Before this, a sell wrote an execution row and stopped: lots were never
 * consumed, quantity never fell, status never reached 'closed', and realized_pnl_lamports was
 * structurally zero for every user in the system.
 *
 * The properties that matter most, and that the control runs target:
 *   - a sell's notional is the SOL it received, NOT the token count it spent (the previous
 *     writer charged fee on the token count),
 *   - proceeds attributed across several positions sum to exactly what was received,
 *   - an unreported sale realizes null, not zero.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();

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
    mint text not null,
    status text not null check (status in ('opening','open','closing','closed','error')),
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
    quantity_base_units numeric not null check (quantity_base_units > 0),
    remaining_base_units numeric not null check (remaining_base_units >= 0),
    cost_lamports bigint not null, created_at timestamptz not null default now(),
    check (remaining_base_units <= quantity_base_units)
  );
`);

for (const file of [
  "degenaration-trade-intent-fanout.sql",
  "degenaration-settlement-writer.sql",
  "degenaration-execution-record-fields.sql",
  "degenaration-exit-settlement.sql"
]) {
  await db.exec(await readFile(`${repo}/supabase/${file}`, "utf8"));
}

const results = {};
const OWNER = "did:privy:alice";
const WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";
const SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const MINT_A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT_C = "So11111111111111111111111111111111111111112";
const MINT_D = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

await db.query("insert into app_private.app_users (privy_user_id) values ($1::text)", [OWNER]);
await db.query(
  `insert into public.subscriptions (id, group_id, privy_user_id, user_pubkey, wallet_id,
     size_sol, daily_cap_sol, enabled)
   values ($1::uuid,$2::uuid,$3::text,$4::text,'pw-1', 0.5::numeric, 50::numeric, true)`,
  [SUB, GROUP, OWNER, WALLET]);

let callSeq = 0;
const nextCall = async (mint) => {
  callSeq += 1;
  const id = `cccccccc-0000-0000-0000-${String(callSeq).padStart(12, "0")}`;
  await db.query("insert into public.calls (id, group_id, mint) values ($1::uuid,$2::uuid,$3::text)",
    [id, GROUP, mint]);
  return id;
};

/** A confirmed buy: queue row → intent (by trigger) → settle → position + lot. */
async function buy(mint, sol, filledUnits) {
  const call = await nextCall(mint);
  const row = await db.query(
    `insert into app_private.call_executions (call_id, subscription_id, claim_token, status, amount_sol)
     values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',$3::double precision)
     returning id`, [call, SUB, sol]).then(r => r.rows[0]);
  await db.query(
    `update app_private.call_executions
       set status='succeeded', tx_signature=$2::text, executed_base_units=$3::numeric
     where id=$1::uuid`, [row.id, `buy-${callSeq}`, filledUnits]);
  return row.id;
}

/** A confirmed sell of `units`, realizing `proceeds` lamports (null when unreported). */
async function sell(mint, units, proceeds) {
  const call = await nextCall(mint);
  const intent = await db.query(
    `select * from app_private.open_trade_intent(
       $1::text, $2::text, $3::text, 'sell', 'take-profit', 'solana-mainnet',
       $4::bigint, null, $5::text, null, null, '{}'::jsonb)`,
    [OWNER, `sell:${callSeq}`, mint, String(units), WALLET]).then(r => r.rows[0]);
  const row = await db.query(
    `insert into app_private.call_executions
       (call_id, subscription_id, claim_token, status, amount_sol, intent_id)
     values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',0::double precision,$3::uuid)
     returning id`, [call, SUB, intent.id]).then(r => r.rows[0]);
  await db.query(
    `update app_private.call_executions
       set status='succeeded', tx_signature=$2::text,
           executed_base_units=$3::numeric, proceeds_lamports=$4::bigint
     where id=$1::uuid`,
    [row.id, `sell-${callSeq}`, String(units), proceeds === null ? null : String(proceeds)]);
  return { execId: row.id, intentId: intent.id };
}

const positionsOf = async (mint) => (await db.query(
  "select * from app_private.positions where mint=$1::text order by opened_at", [mint])).rows;
const lotsOf = async (positionId) => (await db.query(
  "select * from app_private.position_lots where position_id=$1::uuid order by created_at",
  [positionId])).rows;

// ---- two entries in the same mint ----------------------------------------------------
await buy(MINT_A, 0.5, 1000000);   // position A: 1e6 units for 5e8 lamports
await buy(MINT_A, 0.25, 1000000);  // position B: 1e6 units for 2.5e8 lamports

let [posA, posB] = await positionsOf(MINT_A);
assert.equal(String(posA.quantity_base_units), "1000000");
assert.equal(String(posB.cost_lamports), "250000000");
results.entriesRecorded = "PASS";

// ---- a partial exit reduces the oldest lot and leaves the position open ---------------
await sell(MINT_A, 400000, 300000000);

[posA, posB] = await positionsOf(MINT_A);
assert.equal(String(posA.quantity_base_units), "600000", "quantity falls by exactly what was sold");
assert.equal(posA.status, "open", "a partial exit does not close the position");
assert.equal(posA.closed_at, null);
assert.equal(String((await lotsOf(posA.id))[0].remaining_base_units), "600000",
  "the lot is consumed FIFO — this is what average entry depends on");
// basis released = 5e8 * 4e5/1e6 = 2e8; proceeds 3e8; realized +1e8.
assert.equal(String(posA.realized_pnl_lamports), "100000000",
  "realized PnL is proceeds minus the cost basis actually released");
assert.equal(String(posB.quantity_base_units), "1000000", "the newer position is untouched");
results.partialExit = "PASS";

// ---- the sell notional is proceeds, not the token count ------------------------------
const sellExec = (await db.query(
  `select te.* from app_private.trade_executions te
     join app_private.trade_intents ti on ti.id = te.intent_id
    where ti.side='sell' order by te.created_at`)).rows[0];
assert.equal(String(sellExec.gross_notional_lamports), "300000000",
  "a sell's notional is the SOL received; the previous writer recorded the 400000 token " +
  "units it spent and charged fee on that");
assert.notEqual(String(sellExec.gross_notional_lamports), "400000");
results.sellNotionalIsProceeds = "PASS";

// ---- an exit spanning two positions attributes proceeds without leaking a lamport -----
const spill = await sell(MINT_A, 1600000, 1000000000);

[posA, posB] = await positionsOf(MINT_A);
assert.equal(String(posA.quantity_base_units), "0");
assert.equal(posA.status, "closed", "a fully consumed position closes");
assert.ok(posA.closed_at, "and is timestamped");
assert.equal(posB.status, "closed");

const spillExits = (await db.query(
  "select * from app_private.position_exits where exit_execution_id in " +
  "(select id from app_private.trade_executions where tx_signature=$1::text)",
  [`sell-${callSeq}`])).rows;
assert.equal(spillExits.length, 2, "one exit row per position the sale consumed");
const attributed = spillExits.reduce((n, r) => n + BigInt(r.proceeds_lamports), 0n);
assert.equal(attributed, 1000000000n,
  "attributed proceeds sum to exactly what was received — no rounding leak");
const basis = spillExits.reduce((n, r) => n + BigInt(r.cost_basis_lamports), 0n);
assert.equal(basis, 550000000n, "3e8 remaining of A plus all 2.5e8 of B");
const realized = spillExits.reduce((n, r) => n + BigInt(r.realized_pnl_lamports), 0n);
assert.equal(realized, 1000000000n - 550000000n);
assert.ok(spillExits.every(r => r.basis_incomplete === false));
results.multiPositionAttribution = "PASS";
assert.ok(spill.execId);

// ---- a replayed sell settle must not consume the lots twice ---------------------------
const beforeReplay = (await db.query(
  "select count(*)::integer n from app_private.position_exits")).rows[0].n;
await db.query("update app_private.call_executions set status='succeeded' where id=$1::uuid",
  [spill.execId]);
assert.equal((await db.query("select count(*)::integer n from app_private.position_exits")).rows[0].n,
  beforeReplay, "a replayed settle records no second exit");
assert.equal(String((await positionsOf(MINT_A))[0].realized_pnl_lamports), "175000000",
  "nor realizes the same PnL a second time");
results.replayConsumesNothingTwice = "PASS";

// ---- an unreported sale realizes null, not zero ---------------------------------------
await buy(MINT_C, 1, 2000000);
await sell(MINT_C, 2000000, null);

const [posC] = await positionsOf(MINT_C);
const exitC = (await db.query(
  "select * from app_private.position_exits where position_id=$1::uuid", [posC.id])).rows[0];
assert.equal(exitC.proceeds_lamports, null);
assert.equal(exitC.realized_pnl_lamports, null,
  "a zero here would read as broke-even; the truth is that nothing measured it");
assert.equal(String(exitC.cost_basis_lamports), "1000000000",
  "the basis released is still known and still recorded");
assert.equal(String(posC.realized_pnl_lamports), "0", "and no PnL is credited to the position");
assert.equal(posC.status, "closed", "the tokens did leave the wallet, so the position closes");
results.unreportedSaleRealizesNull = "PASS";

const unpricedExec = (await db.query(
  "select * from app_private.trade_executions where tx_signature=$1::text",
  [`sell-${callSeq}`])).rows[0];
assert.equal(String(unpricedExec.gross_notional_lamports), "0");
assert.equal(String(unpricedExec.platform_fee_lamports), "0",
  "no notional, no fee — never a fee computed on a token count");
results.unpricedSaleChargesNothing = "PASS";

// ---- selling more than the ledger recorded is flagged, not clamped silently -----------
await buy(MINT_D, 0.1, 1000000);
await sell(MINT_D, 1500000, 200000000);

const [posD] = await positionsOf(MINT_D);
const exitD = (await db.query(
  "select * from app_private.position_exits where position_id=$1::uuid", [posD.id])).rows[0];
assert.equal(exitD.basis_incomplete, true,
  "the sale exceeded the lots on record — visible rather than silently clamped");
assert.equal(String(exitD.quantity_base_units), "1000000", "only the matched part is attributed");
assert.equal(String(posD.quantity_base_units), "0", "quantity never goes negative");
results.overSaleFlagged = "PASS";

// ---- control: proceeds and PnL cannot disagree ----------------------------------------
await assert.rejects(
  () => db.query(
    `insert into app_private.position_exits
       (position_id, exit_execution_id, quantity_base_units, cost_basis_lamports,
        proceeds_lamports, realized_pnl_lamports)
     values ($1::uuid, $2::uuid, 1, 1, 500, null)`,
    [posD.id, unpricedExec.id]),
  /violates check/i,
  "an exit claiming proceeds with no PnL is incoherent and must be rejected");
results.proceedsPnlAgreementEnforced = "PASS";

// ---- control: a buy still behaves exactly as before -----------------------------------
const beforeBuy = (await db.query(
  "select count(*)::integer n from app_private.positions")).rows[0].n;
await buy(MINT_C, 0.3, 500000);
assert.equal((await db.query("select count(*)::integer n from app_private.positions")).rows[0].n,
  beforeBuy + 1, "the buy path is unchanged by the exit work");
results.buyPathUnchanged = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results,
  unblocks: "durable losing-trade PnL (position_lots now consumed, so average entry AND exit " +
            "are derivable), Portfolio realized/unrealized split, admin realized volume",
  stillMissing: "proceeds_lamports, executed_base_units and the measurement fields are all " +
                "worker-reported and nothing writes them yet (E-3). Until then a sell " +
                "settles with a null notional, which charges no fee rather than a wrong one"
}, null, 2));

await db.close();
