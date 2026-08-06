/**
 * Generate a SQL probe that proves production's deployed function bodies are byte-identical
 * to this repository's.
 *
 * WHY. Migrations reach production as text pasted into an apply call, not as a file
 * transfer. Nothing in that path detects a truncated paste, a dropped clause or a mangled
 * dollar-quote — and a plpgsql body is not validated at creation, so a corrupted function
 * installs cleanly and fails later, at runtime, on the worker's first tick. Checking that
 * the object EXISTS is not the same as checking it is the RIGHT object.
 *
 * So: apply the package to PGlite from the files on disk, take md5(prosrc) of every function
 * the package defines, and emit a query that asks production for the same digests and
 * returns only the rows that disagree. An empty result is the proof.
 *
 * Usage:  node scripts/deploy-checksums.mjs [stopAfterMigrationNumber]
 */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, PRODUCTION_TABLES } from "./lib/production-schema.mjs";
import { BASELINE, PACKAGE } from "../supabase/rollback/plan.mjs";

const stopAfter = Number(process.argv[2] ?? PACKAGE.length);
const repo = process.cwd();
const read = (p) => readFile(`${repo}/${p}`, "utf8");

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private; create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $x$ select null::uuid $x$;
  create function app_private.admin_secret_ok(t text) returns boolean
    language sql stable as $x$ select true $x$;
`);
await db.exec(renderTables(Object.keys(PRODUCTION_TABLES)));
await db.exec(`
  create table if not exists app_private.bot_profiles (
    id uuid primary key default gen_random_uuid(), owner_privy_user_id text,
    source_group_id uuid, kind text, status text);
  create table if not exists app_private.positions (
    id uuid primary key default gen_random_uuid(), bot_id uuid, config_version_id uuid,
    entry_config_snapshot jsonb not null default '{}'::jsonb, status text);
  create table if not exists app_private.cash_movements (
    id uuid primary key default gen_random_uuid(), tx_signature text);
  -- The signal journal. degenaration-signal-fanout.sql and
  -- degenaration-discord-signal-ingestion.sql are both in the baseline now, and a function
  -- body and an AFTER INSERT trigger both resolve at creation time.
  create table if not exists app_private.raw_signals (
    id uuid primary key default gen_random_uuid(), source_type text not null,
    source_ref text not null, external_event_id text, event_version text,
    immutable_payload jsonb not null default '{}'::jsonb, content_hash text not null,
    received_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz);
  create table if not exists app_private.parsed_signals (
    id uuid primary key default gen_random_uuid(),
    raw_signal_id uuid not null references app_private.raw_signals(id),
    parser_version text not null, status text not null, mint text, confidence_bps integer,
    rejection_reason text, normalized_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now());
  create table if not exists app_private.signal_deliveries (
    id uuid primary key default gen_random_uuid(),
    parsed_signal_id uuid not null references app_private.parsed_signals(id),
    bot_id uuid not null, config_version_id uuid not null,
    idempotency_key text not null unique, status text not null,
    evaluation jsonb not null default '{}'::jsonb);
  -- Partial unique indexes are not captured by production-schema.mjs, and
  -- bot_ingest_discord_signal_v2 infers its ON CONFLICT against this one.
  create unique index if not exists calls_message_id_unique
    on public.calls (message_id) where message_id is not null;
  -- Two queues no migration creates. automation-execution-integrity.sql and
  -- public-source-profiles.sql are both in the baseline now (migrations 11 and 12 replace
  -- function bodies they define), and each resolves its own table at apply time.
  create table if not exists public.limit_orders (
    id uuid primary key default gen_random_uuid(),
    privy_user_id text, user_pubkey text, mint text, symbol text, trigger text,
    target_usd numeric, amount_sol numeric, slippage_bps integer,
    status text not null default 'open', sig text, filled_at timestamptz,
    created_at timestamptz not null default now());
  create table if not exists public.server_applications (
    id uuid primary key default gen_random_uuid(),
    guild_id text, guild_name text, guild_member_count integer, channel_id text,
    channel_name text, status text default 'pending', owner_privy_user_id text,
    decided_at timestamptz, decision_reason text,
    created_at timestamptz not null default now());
  -- Verbatim from degenaration-product-ledgers-operations.sql, which is applied in production
  -- but is far too large a dependency chain to add to the baseline for one table. Migration 20
  -- reads it.
  create table if not exists app_private.worker_leases (
    worker_key text primary key,
    instance_id text not null,
    execution_mode text not null
      check (execution_mode in ('paper', 'solana-devnet', 'solana-mainnet')),
    heartbeat_at timestamptz not null default now(),
    lease_expires_at timestamptz not null,
    metadata jsonb not null default '{}'::jsonb);
`);
for (const f of BASELINE) await db.exec(await read(`supabase/${f}`));

// Digest the baseline so the diff below reports only what the package itself installs.
const digest = async () =>
  new Map(
    (
      await db.query(`
        select n.nspname || '.' || p.proname || '(' ||
               pg_get_function_identity_arguments(p.oid) || ')' as sig,
               md5(p.prosrc) as body
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app_private') and p.prokind = 'f'`)
    ).rows.map((r) => [r.sig, r.body]),
  );

const before = await digest();
const applied = [];
for (const step of PACKAGE.filter((s) => s.n <= stopAfter)) {
  await db.exec(await read(`supabase/${step.apply}`));
  applied.push(step.n);
}
const after = await digest();

// Only functions the package created or changed.
const expected = [...after].filter(([sig, body]) => before.get(sig) !== body).sort();

const values = expected.map(([sig, body]) => `('${sig.replace(/'/g, "''")}','${body}')`).join(",\n    ");

console.log(`-- ${expected.length} function(s) defined or changed by migrations ${applied.join(", ")}.
-- Run this against production. An EMPTY result set is the proof: every deployed body is
-- byte-identical to this repository. Any row is a mismatch or a missing function.
with expected(sig, body) as (values
    ${values}
),
deployed as (
  select n.nspname || '.' || p.proname || '(' ||
         pg_get_function_identity_arguments(p.oid) || ')' as sig,
         md5(p.prosrc) as body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app_private') and p.prokind = 'f'
)
select e.sig,
       case when d.sig is null then 'MISSING IN PRODUCTION' else 'BODY DIFFERS' end as problem
from expected e left join deployed d on d.sig = e.sig and d.body = e.body
where d.sig is null
order by 1;`);

await db.close();
