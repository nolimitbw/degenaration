/**
 * performance_snapshots: the writer four surfaces were waiting on.
 *
 * Spec 13 (Portfolio), 9.6/9.7 (marketplace periods), section 8 (My Bots). Portfolio
 * performance, the My Bots performance column, KOL cards and the Discord 1D/7D/30D figures
 * all left-join app_private.performance_snapshots, and nothing had ever written a row — so
 * every one of them rendered a dash rather than an error.
 *
 * The properties the control runs target: realized PnL comes only from measured exits, and a
 * subject with no closed trade reports null rather than zero.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();

const FIXTURE_TABLES = [
  "app_private.app_users",
  "app_private.bot_config_versions",
  "app_private.trade_intents",
  "public.approved_groups",
  "public.subscriptions",
  "public.calls",
  "app_private.call_executions",
  "public.copy_subscriptions",
  "app_private.copy_executions",
  "app_private.trade_executions",
  "app_private.commission_ledger_entries",
  "app_private.performance_snapshots"
];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.ensure_app_user(p text) returns void
  language plpgsql security definer set search_path = '' as $x$
  begin insert into app_private.app_users (privy_user_id) values (trim(p))
        on conflict (privy_user_id) do nothing; end $x$;
  create function app_private.admin_secret_ok(p text) returns boolean
  language sql immutable set search_path = '' as $x$ select p = 'test-secret' $x$;
  create function app_private.require_app_admin(p text) returns void
  language plpgsql set search_path = '' as $x$
  begin if p is distinct from 'did:privy:admin' then
    raise exception 'forbidden' using errcode = '42501'; end if; end $x$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);

await db.exec(`
  create table app_private.system_flags (
    flag_key text primary key, value jsonb not null default '{}'::jsonb
  );
  create table app_private.kol_strategies (
    id uuid primary key default gen_random_uuid(), bot_id uuid,
    owner_privy_user_id text not null references app_private.app_users(privy_user_id),
    slug text not null unique, moderation_status text not null default 'approved',
    creator_fee_bps integer not null default 20
  );
  create table app_private.referral_attributions (
    id uuid primary key default gen_random_uuid(),
    referrer_privy_user_id text not null, referred_privy_user_id text not null unique,
    status text not null default 'verified',
    attribution_expires_at timestamptz not null
  );
  create table app_private.positions (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null, bot_id uuid, config_version_id uuid,
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
    entry_execution_id uuid not null references app_private.trade_executions(id),
    quantity_base_units numeric not null check (quantity_base_units > 0),
    remaining_base_units numeric not null check (remaining_base_units >= 0),
    cost_lamports bigint not null, created_at timestamptz not null default now()
  );
`);

for (const file of [
  "degenaration-fee-allocation-integrity.sql",
  "degenaration-commission-allocation-balance.sql",
  "degenaration-trade-intent-fanout.sql",
  "degenaration-settlement-writer.sql",
  "degenaration-execution-record-fields.sql",
  "degenaration-exit-settlement.sql",
  "degenaration-creator-referral-allocation.sql",
  "degenaration-performance-snapshots.sql"
]) {
  await db.exec(await readFile(`${repo}/supabase/${file}`, "utf8"));
}

const results = {};
const TRADER = "did:privy:trader";
const CREATOR = "did:privy:creator";
const MINT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";
const SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

for (const user of [TRADER, CREATOR]) {
  await db.query("insert into app_private.app_users (privy_user_id) values ($1::text)", [user]);
}
await db.query(
  `insert into public.approved_groups (id, name, owner_privy_user_id) values ($1::uuid,'Alpha',$2::text)`,
  [GROUP, CREATOR]);
await db.query(
  `insert into public.subscriptions (id, group_id, privy_user_id, user_pubkey, wallet_id,
     size_sol, daily_cap_sol, enabled)
   values ($1::uuid,$2::uuid,$3::text,$4::text,'pw-1',1::numeric,50::numeric,true)`,
  [SUB, GROUP, TRADER, WALLET]);

let seq = 0;
async function buy(sol, filledUnits) {
  seq += 1;
  const call = `cccccccc-0000-0000-0000-${String(seq).padStart(12, "0")}`;
  await db.query("insert into public.calls (id, group_id, mint) values ($1::uuid,$2::uuid,$3::text)",
    [call, GROUP, MINT]);
  const row = await db.query(
    `insert into app_private.call_executions (call_id, subscription_id, claim_token, status, amount_sol)
     values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',$3::double precision) returning id`,
    [call, SUB, sol]).then(r => r.rows[0]);
  await db.query(
    `update app_private.call_executions set status='succeeded', tx_signature=$2::text,
       executed_base_units=$3::numeric where id=$1::uuid`, [row.id, `buy-${seq}`, filledUnits]);
}

async function sell(units, proceeds) {
  seq += 1;
  const call = `cccccccc-0000-0000-0000-${String(seq).padStart(12, "0")}`;
  await db.query("insert into public.calls (id, group_id, mint) values ($1::uuid,$2::uuid,$3::text)",
    [call, GROUP, MINT]);
  const intent = await db.query(
    `select * from app_private.open_trade_intent($1::text,$2::text,$3::text,'sell','take-profit',
       'solana-mainnet',$4::bigint,null,$5::text,$6::uuid,null,'{}'::jsonb)`,
    [TRADER, `sell:${seq}`, MINT, String(units), WALLET, GROUP]).then(r => r.rows[0]);
  const row = await db.query(
    `insert into app_private.call_executions
       (call_id, subscription_id, claim_token, status, amount_sol, intent_id)
     values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',0::double precision,$3::uuid)
     returning id`, [call, SUB, intent.id]).then(r => r.rows[0]);
  await db.query(
    `update app_private.call_executions set status='succeeded', tx_signature=$2::text,
       executed_base_units=$3::numeric, proceeds_lamports=$4::bigint where id=$1::uuid`,
    [row.id, `sell-${seq}`, String(units), proceeds === null ? null : String(proceeds)]);
}

const refresh = () => db.query("select app_private.refresh_all_performance_snapshots() n")
  .then(r => r.rows[0].n);
const snapshot = async (type, id, period) => (await db.query(
  `select * from app_private.performance_snapshots
    where subject_type=$1::text and subject_id=$2::text and period=$3::text
    order by as_of desc limit 1`, [type, id, period])).rows[0];

// ---- nothing traded means no snapshot at all -------------------------------------------
assert.equal(await refresh(), 0);
assert.equal((await db.query("select count(*)::integer n from app_private.performance_snapshots")).rows[0].n, 0,
  "a subject with no executions gets no row, which is what makes the marketplace show " +
  "tracking rather than a fabricated zero");
results.noDataWritesNoSnapshot = "PASS";

// ---- an open buy: volume counted, realized still unknown --------------------------------
await buy(1, 1000000);
await refresh();

let portfolio = await snapshot("portfolio", TRADER, "30d");
assert.equal(String(portfolio.volume_lamports), "1000000000");
assert.equal(portfolio.sample_size, 0);
assert.equal(portfolio.realized_pnl_lamports, null,
  "nothing has closed — zero would read as broke even");
assert.equal(portfolio.win_rate_bps, null,
  "and a zero win rate would read as every trade lost");
assert.equal(portfolio.max_drawdown_bps, null,
  "nothing has closed, so the realized curve has no peak to fall from");
assert.deepEqual(portfolio.metrics.equitySeries, [],
  "and no series — the chart shows its empty state rather than a flat invented line");
assert.equal(portfolio.metrics.openPositions, 1);
assert.equal(portfolio.metrics.unrealizedBasisLamports, "1000000000",
  "the cost basis still held — the ledger's half of unrealized PnL");
results.openPositionReportsBasisNotGuess = "PASS";

// ---- a profitable exit realizes -----------------------------------------------------------
await sell(1000000, 1500000000);
await refresh();

portfolio = await snapshot("portfolio", TRADER, "30d");
assert.equal(portfolio.sample_size, 1, "one measured exit");
assert.equal(String(portfolio.realized_pnl_lamports), "500000000", "1.5 SOL out, 1 SOL basis");
assert.equal(String(portfolio.net_pnl_lamports), "500000000", "no network fee was recorded");
assert.equal(portfolio.win_rate_bps, 10000);
assert.equal(String(portfolio.volume_lamports), "2500000000", "both legs count toward volume");
assert.equal(portfolio.metrics.openPositions, 0);
assert.equal(portfolio.metrics.unrealizedBasisLamports, "0");
results.realizedFromMeasuredExit = "PASS";

// ---- the chart finally has a series to draw --------------------------------------------
let series = portfolio.metrics.equitySeries;
assert.equal(series.length, 2, "one closed day, plus the zero origin the day before");
assert.equal(series[0].equityLamports, "0", "nothing had been realized before the first exit");
assert.equal(series[1].equityLamports, "500000000");
assert.ok(new Date(series[0].t) < new Date(series[1].t), "the series is ordered in time");
assert.equal(portfolio.max_drawdown_bps, 0, "a curve that only rose never drew down");
results.equitySeriesDrawn = "PASS";

// ---- a loss halves the win rate ------------------------------------------------------------
await buy(1, 1000000);
await sell(1000000, 400000000);
await refresh();

portfolio = await snapshot("portfolio", TRADER, "30d");
assert.equal(portfolio.sample_size, 2);
assert.equal(String(portfolio.realized_pnl_lamports), "-100000000",
  "+0.5 SOL then -0.6 SOL — a durable losing trade, which is what was previously impossible");
assert.equal(portfolio.win_rate_bps, 5000);
results.lossesAreDurable = "PASS";

// Both exits land on the same day here, so the curve is one net point rather than two — a
// real drawdown needs a peak on an earlier day, which the backdated case below produces.
series = portfolio.metrics.equitySeries;
assert.equal(series[series.length - 1].equityLamports, "-100000000",
  "the curve ends where realized PnL ends");

// ---- a fall from an earlier peak is a real drawdown ------------------------------------
await db.query(
  `update app_private.position_exits set created_at = created_at - interval '2 days'
    where realized_pnl_lamports > 0`);
await refresh();
portfolio = await snapshot("portfolio", TRADER, "30d");
assert.equal(portfolio.metrics.equitySeries.length, 3, "origin, the winning day, the losing day");
assert.equal(portfolio.max_drawdown_bps, 12000,
  "peak 0.5 SOL, trough -0.1 SOL: a 0.6 SOL fall is 120% of the peak");
results.drawdownFromRealizedCurve = "PASS";

// ---- an unpriced exit is counted apart, never as a loss -------------------------------------
await buy(1, 1000000);
await sell(1000000, null);
await refresh();

portfolio = await snapshot("portfolio", TRADER, "30d");
assert.equal(portfolio.sample_size, 2, "an unmeasured exit is not a measured one");
assert.equal(portfolio.metrics.unpricedExits, 1, "but it is visible rather than dropped");
assert.equal(portfolio.win_rate_bps, 5000, "and it does not dilute the win rate as a loss");
assert.equal(String(portfolio.realized_pnl_lamports), "-100000000");
results.unpricedExitCountedApart = "PASS";

// ---- the Discord source gets a copied-execution snapshot, labelled as such ------------------
const source = await snapshot("discord-source", GROUP, "30d");
assert.ok(source, "the marketplace 30D figure finally has a row to read");
assert.equal(source.metrics.basis, "copied-executions",
  "spec 9.2: copied-execution performance must never be presented as call-signal performance");
assert.equal(source.sample_size, 2);
assert.equal(String(source.realized_pnl_lamports), "-100000000");
results.discordSourceSnapshot = "PASS";

// ---- refreshing twice in the same hour updates rather than duplicates -----------------------
const before = (await db.query(
  "select count(*)::integer n from app_private.performance_snapshots")).rows[0].n;
await refresh();
assert.equal((await db.query(
  "select count(*)::integer n from app_private.performance_snapshots")).rows[0].n, before,
  "the snapshot is idempotent within its hour bucket");
results.refreshIsIdempotent = "PASS";

// ---- the window actually excludes older activity --------------------------------------------
await db.query("update app_private.trade_executions set reconciled_at = now() - interval '10 days'");
await db.query("update app_private.position_exits set created_at = now() - interval '10 days'");
await refresh();

const oneDay = await snapshot("portfolio", TRADER, "1d");
assert.equal(String(oneDay.volume_lamports), "0", "nothing traded in the last day");
assert.equal(oneDay.realized_pnl_lamports, null);
const thirtyDay = await snapshot("portfolio", TRADER, "30d");
assert.equal(String(thirtyDay.volume_lamports), "4900000000", "but the 30D window still sees it");
assert.equal(thirtyDay.sample_size, 2);
results.windowsAreReal = "PASS";

// ---- the operator entry point is gated ------------------------------------------------------
await assert.rejects(
  () => db.query("select public.admin_refresh_performance('wrong', 'did:privy:admin')"),
  /unauthorized/i);
await assert.rejects(
  () => db.query("select public.admin_refresh_performance('test-secret', $1::text)", [TRADER]),
  /forbidden/i,
  "the secret alone is not enough — the actor must be an admin");
const run = (await db.query(
  "select public.admin_refresh_performance('test-secret', 'did:privy:admin') r")).rows[0].r;
assert.equal(run.ok, true);
assert.ok(run.snapshotsRefreshed > 0);
results.operatorEntryPointGated = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results,
  unblocks: "Portfolio performance and chart, My Bots performance column, KOL cards, " +
            "Discord marketplace 1D/7D/30D — all four read this table and none had a writer",
  stillMissing: "unrealized PnL needs a live quote the ledger cannot supply. What it can " +
                "state — the cost basis still held — is published as unrealizedBasisLamports " +
                "for the surface to pair with a price. The equity curve is realized PnL by " +
                "day, so drawdown is a realized drawdown, never marked to market"
}, null, 2));

await db.close();
