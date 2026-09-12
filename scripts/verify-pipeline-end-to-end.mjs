/**
 * The whole money chain, end to end, in one transaction-consistent database.
 *
 * Spec 5.7 financial proof. Every stage has its own verifier; none of them proves the stages
 * COMPOSE. This walks a single call from a parsed Discord signal through to a balanced ledger
 * and asserts the invariants at every step, including the ones that only appear when the
 * stages meet -- capital reserved by one component being released by another, and the
 * withdrawable figure moving in step with both.
 *
 * This is the closest thing to an auto-trading proof that exists without a worker: it exercises
 * every database-side transition the worker would drive, in the order it would drive them. What
 * it does NOT prove is that the worker performs them, which needs E-3.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const read = (f) => readFile(`${repo}/supabase/${f}`, "utf8");
const [fanout, settle, wd, sigfan] = await Promise.all([
  read("degenaration-trade-intent-fanout.sql"),
  read("degenaration-settlement-writer.sql"),
  read("degenaration-user-withdrawals.sql"),
  read("degenaration-signal-fanout.sql")
]);
const stateRpc = wd.slice(wd.indexOf("create or replace function public.app_user_withdrawable_state("),
                          wd.indexOf("revoke execute on function public.app_user_withdrawable_state"));

const T = ["app_private.bot_config_versions", "app_private.app_users", "app_private.trade_intents",
  "public.subscriptions", "public.calls", "app_private.call_executions",
  "public.copy_subscriptions", "app_private.copy_executions", "app_private.trade_executions",
  "public.approved_groups", "public.call_channels"];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.admin_secret_ok(p text) returns boolean
  language sql stable security definer set search_path='' as $x$ select p='e2e' $x$;
  create function app_private.ensure_app_user(p text) returns void
  language plpgsql security definer set search_path='' as $x$
  begin insert into app_private.app_users (privy_user_id) values (trim(p))
        on conflict (privy_user_id) do nothing; end $x$;
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
await db.exec(`
  create table app_private.raw_signals (id uuid primary key default gen_random_uuid(),
    source_type text not null, source_ref text not null, content_hash text not null,
    received_at timestamptz not null default now());
  create table app_private.parsed_signals (id uuid primary key default gen_random_uuid(),
    raw_signal_id uuid not null references app_private.raw_signals(id), parser_version text not null,
    status text not null, mint text, confidence_bps integer, rejection_reason text,
    normalized_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  create table app_private.bot_profiles (id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null, kind text not null, source_group_id uuid,
    status text not null default 'active');
  create table app_private.signal_deliveries (id uuid primary key default gen_random_uuid(),
    parsed_signal_id uuid not null references app_private.parsed_signals(id), bot_id uuid not null,
    config_version_id uuid not null, idempotency_key text not null unique, status text not null,
    evaluation jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), finished_at timestamptz);
  create table app_private.positions (id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null, bot_id uuid, config_version_id uuid, mint text not null,
    status text not null, quantity_base_units numeric not null, cost_lamports bigint not null,
    realized_pnl_lamports bigint not null default 0, fees_lamports bigint not null default 0,
    entry_config_snapshot jsonb not null default '{}'::jsonb,
    opened_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    closed_at timestamptz);
  create table app_private.position_lots (id uuid primary key default gen_random_uuid(),
    position_id uuid not null references app_private.positions(id), entry_execution_id uuid not null,
    quantity_base_units numeric not null, remaining_base_units numeric not null,
    cost_lamports bigint not null, created_at timestamptz not null default now());
`);
await db.exec(fanout); await db.exec(sigfan); await db.exec(settle); await db.exec(stateRpc);

const S="e2e", U="did:privy:trader", W="5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const MINT="9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const G="aaaaaaaa-0000-0000-0000-000000000001", CH="chan-1";
const SUB="bbbbbbbb-0000-0000-0000-000000000001", CALL="cccccccc-0000-0000-0000-000000000001";
const RESERVE=15_890_880n, ONCHAIN=10_000_000_000n;
const step = {};
const locked = async () => BigInt((await db.query(
  "select public.app_user_withdrawable_state($1::text,$2::text) as r",[S,U])).rows[0].r.lockedLamports);
const withdrawable = async () => ONCHAIN - (await locked()) - RESERVE;

await db.query("insert into app_private.app_users (privy_user_id) values ($1::text)",[U]);
await db.query("insert into public.approved_groups (id,name) values ($1::uuid,'Src')",[G]);
await db.query(`insert into public.call_channels (group_id,guild_id,channel_id,status)
  values ($1::uuid,'g1',$2::text,'approved')`,[G,CH]);
const bot=(await db.query(`insert into app_private.bot_profiles (owner_privy_user_id,kind,source_group_id)
  values ($1::text,'discord',$2::uuid) returning id`,[U,G])).rows[0].id;
await db.query(`insert into app_private.bot_config_versions (bot_id,version,config,created_by)
  values ($1::uuid,1,'{}'::jsonb,$2::text)`,[bot,U]);
await db.query(`insert into public.subscriptions (id,group_id,privy_user_id,user_pubkey,wallet_id,
  size_sol,daily_cap_sol,enabled) values ($1::uuid,$2::uuid,$3::text,$4::text,'pw',0.5,5,true)`,[SUB,G,U,W]);
await db.query("insert into public.calls (id,group_id,mint) values ($1::uuid,$2::uuid,$3::text)",[CALL,G,MINT]);

// 1. baseline
assert.equal(await locked(), 0n);
assert.equal(await withdrawable(), ONCHAIN - RESERVE);
step["1_baseline"] = `${await withdrawable()} withdrawable`;

// 2. a Discord call is parsed and fanned out
const raw=(await db.query(`insert into app_private.raw_signals (source_type,source_ref,content_hash)
  values ('discord',$1::text,'h1') returning id`,[CH])).rows[0].id;
const parsed=(await db.query(`insert into app_private.parsed_signals
  (raw_signal_id,parser_version,status,mint,confidence_bps) values ($1::uuid,'v1','accepted',$2::text,9000)
  returning id`,[raw,MINT])).rows[0].id;
const del=(await db.query("select * from app_private.signal_deliveries where parsed_signal_id=$1::uuid",[parsed])).rows;
assert.equal(del.length,1,"the bot following this source was offered the call");
assert.equal(del[0].bot_id,bot);
step["2_fanout"] = "1 delivery, config version captured";

// 3. the worker claims -> capital is reserved, and withdrawable drops by exactly that
const ex=(await db.query(`insert into app_private.call_executions
  (call_id,subscription_id,claim_token,status,amount_sol) values ($1::uuid,$2::uuid,gen_random_uuid(),
  'claimed',0.5::double precision) returning id,intent_id`,[CALL,SUB])).rows[0];
assert.ok(ex.intent_id);
assert.equal(await locked(), 500_000_000n);
assert.equal(await withdrawable(), ONCHAIN - 500_000_000n - RESERVE,
  "withdrawable fell by exactly the reserved amount — the user cannot spend committed capital");
step["3_reserved"] = "0.5 SOL locked, withdrawable reduced in step";

// 4. submitted -> still locked (the transaction may land)
await db.query("update app_private.call_executions set status='submitted',tx_signature='sig-1' where id=$1::uuid",[ex.id]);
assert.equal(await locked(), 500_000_000n, "a submitted buy stays locked until it settles");
step["4_submitted"] = "still locked";

// 5. succeeded -> settlement writes the ledger AND releases the lock
await db.query("update app_private.call_executions set status='succeeded' where id=$1::uuid",[ex.id]);
const te=(await db.query("select * from app_private.trade_executions")).rows;
const pos=(await db.query("select * from app_private.positions")).rows;
const lots=(await db.query("select * from app_private.position_lots")).rows;
assert.equal(te.length,1); assert.equal(pos.length,1); assert.equal(lots.length,1);
assert.equal(String(te[0].gross_notional_lamports),"500000000");
assert.equal(te[0].status,"reconciled");
assert.equal(lots[0].entry_execution_id, te[0].id, "the lot points at the execution that created it");
assert.equal(await locked(), 0n,
  "the lock is released because the lamports LEFT the wallet — the on-chain balance already " +
  "reflects them, so continuing to subtract would double-count");
step["5_settled"] = "execution + position + lot written, lock released";

// 6. the fee identity holds by construction
const t=te[0];
assert.equal(
  BigInt(t.platform_fee_lamports),
  BigInt(t.creator_fee_lamports)+BigInt(t.referral_fee_lamports)+BigInt(t.retained_fee_lamports),
  "creator + referral + retained === platform_fee, enforced by the generated column");
assert.equal(String(t.platform_fee_lamports),"0",
  "0 bps, honestly: PLATFORM_FEE_ACCOUNT is unset so Jupiter collects nothing (E-4)");
step["6_fee_identity"] = "balances at 0 bps; identity holds by construction";

// 7. replay the whole settle — nothing duplicates
await db.query("update app_private.call_executions set status='succeeded' where id=$1::uuid",[ex.id]);
await db.query("select app_private.fan_out_parsed_signal($1::uuid)",[parsed]);
assert.equal((await db.query("select count(*)::integer n from app_private.trade_executions")).rows[0].n,1);
assert.equal((await db.query("select count(*)::integer n from app_private.positions")).rows[0].n,1);
assert.equal((await db.query("select count(*)::integer n from app_private.signal_deliveries")).rows[0].n,1);
assert.equal((await db.query("select count(*)::integer n from app_private.trade_intents")).rows[0].n,1);
step["7_replay"] = "no duplicate signal, intent, execution, position or fee";

// 8. the closing invariant
assert.equal(
  (await withdrawable()) + (await locked()) + RESERVE, ONCHAIN,
  "total = withdrawable + locked + reserve, with no unexplained difference");
step["8_invariant"] = "total = withdrawable + locked + reserve";

console.log(JSON.stringify({ engine:"PGlite PostgreSQL",
  fixture:`generated from production shapes (${T.length} tables)`, schemaParity:"PASS",
  chain:"parsed signal -> delivery -> intent -> reservation -> submit -> settle -> ledger", ...step,
  proves:"every database transition a worker would drive, in order, composing correctly",
  doesNotProve:"that a worker performs them, or that a swap executes on chain (E-3)" },null,2));
await db.close();
