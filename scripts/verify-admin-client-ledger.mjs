/**
 * Spec section 8: admin client table and business summary.
 *
 * These aggregate trade_executions, positions, trade_intents and withdrawal_intents. Until
 * degenaration-settlement-writer.sql none of those had a writer, so this would have returned
 * zeros for every client and looked identical to a broken query.
 *
 * The properties that matter: an admin sees real per-client figures, a non-admin sees nothing
 * at all, and no fabricated "balance" is reported for a non-custodial product.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const adminSql = await readFile(`${repo}/supabase/degenaration-admin-client-ledger.sql`, "utf8");

const FIXTURE_TABLES = [
  "app_private.bot_config_versions", "app_private.app_users", "app_private.trade_intents",
  "app_private.trade_executions", "app_private.commission_ledger_entries",
  "app_private.trading_wallets"
];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.admin_secret_ok(p text) returns boolean
  language sql stable security definer set search_path = ''
  as $x$ select p is not null and p = 'admin-test-secret' $x$;
  create function app_private.require_app_admin(p text) returns void
  language plpgsql set search_path = '' as $x$
  begin if p is distinct from 'admin-a' then
    raise exception 'forbidden' using errcode = '42501'; end if; end $x$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);
// is_primary arrives with degenaration-wallet-registration.sql, which is applied in
// production; the captured schema predates it.
// Columns added by migrations already applied in production; the captured schema predates them.
await db.exec(`
  alter table app_private.trading_wallets add column if not exists is_primary boolean not null default false;
  alter table app_private.trade_intents add column if not exists reserved_lamports bigint not null default 0;
`);
await db.exec(`
  create table app_private.positions (
    id uuid primary key default gen_random_uuid(), owner_privy_user_id text not null,
    bot_id uuid, config_version_id uuid, mint text not null, status text not null,
    quantity_base_units numeric not null, cost_lamports bigint not null,
    realized_pnl_lamports bigint not null default 0, fees_lamports bigint not null default 0,
    entry_config_snapshot jsonb not null default '{}'::jsonb,
    opened_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    closed_at timestamptz);
  create table app_private.withdrawal_intents (
    id uuid primary key default gen_random_uuid(), owner_privy_user_id text not null,
    amount_lamports bigint not null, state text not null default 'created');
  create table app_private.bot_profiles (
    id uuid primary key default gen_random_uuid(), owner_privy_user_id text not null,
    kind text not null, name text, status text not null default 'active');
`);
await db.exec(adminSql);

const S = "admin-test-secret";
const A = "did:privy:alice", B = "did:privy:bob";
const results = {};

await db.query("insert into app_private.app_users (privy_user_id) values ($1::text),($2::text)", [A, B]);
await db.query(`insert into app_private.trading_wallets (privy_user_id, address, is_primary, status)
  values ($1::text,'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',true,'active')`, [A]);
await db.query(`insert into app_private.trade_intents (owner_privy_user_id, intent_kind, side, mint,
  requested_input_base_units, reserved_lamports, execution_mode, state, idempotency_key)
  values ($1::text,'entry','buy','M',1000000000,1000000000,'solana-mainnet','submitted','k1')`, [A]);
const intent = (await db.query("select id from app_private.trade_intents limit 1")).rows[0];
await db.query(`insert into app_private.trade_executions (intent_id, owner_privy_user_id,
  execution_mode, status, gross_notional_lamports, platform_fee_lamports,
  platform_fee_bps_snapshot, tx_signature, confirmed_at, reconciled_at)
  values ($1::uuid,$2::text,'solana-mainnet','reconciled',1000000000,20000000,200,'s1',now(),now())`,
  [intent.id, A]);
await db.query(`insert into app_private.positions (owner_privy_user_id, mint, status,
  quantity_base_units, cost_lamports) values ($1::text,'M','open',1,1000000000)`, [A]);
await db.query(`insert into app_private.withdrawal_intents (owner_privy_user_id, amount_lamports, state)
  values ($1::text,500000000,'confirmed'),($1::text,250000000,'submitted')`, [A]);
await db.query(`insert into app_private.bot_profiles (owner_privy_user_id, kind)
  values ($1::text,'discord'),($1::text,'kol')`, [A]);

const ledger = (await db.query(
  "select public.admin_client_ledger($1::text,$2::text,100::integer) as r", [S, "admin-a"]
)).rows[0].r;
const alice = ledger.clients.find((c) => c.privyUserId === A);

assert.equal(ledger.ok, true);
assert.equal(ledger.clients.length, 2, "every client appears, including one with no activity");
assert.equal(alice.executedVolumeLamports, "1000000000", "trading volume is real executed notional");
assert.equal(alice.executionCount, 1);
assert.equal(alice.platformFeeLamports, "20000000", "platform revenue attributable to the client");
assert.equal(alice.committedLamports, "1000000000", "capital committed but not yet spent");
assert.equal(alice.openPositions, 1);
assert.equal(alice.withdrawnLamports, "500000000");
assert.equal(alice.pendingWithdrawalLamports, "250000000", "settled and unsettled are separated");
assert.equal(alice.discordBots, 1);
assert.equal(alice.kolBots, 1, "bot usage is split by product");
assert.equal(alice.walletAddress, "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1");
assert.ok(alice.lastTradeAt);
results.clientFiguresAreReal = "PASS";

const bob = ledger.clients.find((c) => c.privyUserId === B);
assert.equal(bob.executedVolumeLamports, "0");
assert.equal(bob.walletAddress, null, "a client with no registered wallet reports null, not a guess");
results.inactiveClientIsHonest = "PASS";

// No fabricated custodial balance.
assert.equal(ledger.custodyModel, "non-custodial");
assert.ok(!("balanceLamports" in alice),
  "a 'balance' column would be a number the database cannot verify for a non-custodial product");
results.noFabricatedBalance = "PASS";

const summary = (await db.query(
  "select public.admin_business_summary($1::text,$2::text) as r", [S, "admin-a"])).rows[0].r;
assert.equal(summary.clients, 2);
assert.equal(summary.clientsWithWallet, 1);
assert.equal(summary.executedVolumeLamports, "1000000000");
assert.equal(summary.platformFeeLamports, "20000000");
assert.equal(summary.retainedFeeLamports, "20000000",
  "retained is generated as platform - creator - referral and must reconcile");
assert.equal(summary.openPositions, 1);
assert.equal(summary.pendingWithdrawalLamports, "250000000");
results.businessSummaryReconciles = "PASS";

// ---- authorization: the secret authenticates, the role authorizes ----
await assert.rejects(() => db.query(
  "select public.admin_client_ledger($1::text,$2::text,10::integer)", ["wrong", "admin-a"]), /unauthorized/i);
await assert.rejects(() => db.query(
  "select public.admin_client_ledger($1::text,$2::text,10::integer)", [S, "not-an-admin"]), /forbidden/i,
  "a valid secret is not enough — the actor must hold the admin role");
await assert.rejects(() => db.query(
  "select public.admin_business_summary($1::text,$2::text)", [S, B]), /forbidden/i,
  "an ordinary client cannot read the business summary");
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => db.query(
    "select public.admin_client_ledger($1::text,$2::text,10::integer)", [S, "admin-a"]),
    /permission denied/i, `${role} must not reach the client ledger at all`);
  await db.exec("reset role");
}
results.authorizationHoldsOnBothAxes = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS", ...results,
  note: "on-chain balance is not readable from SQL; walletAddress is exposed for chain lookup " +
        "instead of reporting a number the database cannot verify"
}, null, 2));
await db.close();
