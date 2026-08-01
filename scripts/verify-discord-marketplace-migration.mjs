import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const repo = process.cwd();
const db = new PGlite();

const priorFile = await readFile(`${repo}/supabase/degenaration-discord-public-profiles.sql`, "utf8");
const migration = await readFile(`${repo}/supabase/degenaration-discord-marketplace-parity.sql`, "utf8");
const priorStart = priorFile.indexOf(
  "create or replace function public.app_public_list_discord_marketplace("
);
const priorEndMarker = `grant execute on function public.app_public_list_discord_marketplace(
  text, text, text, integer
) to service_role;`;
const priorEnd = priorFile.indexOf(priorEndMarker, priorStart);
assert.ok(priorStart >= 0 && priorEnd >= 0, "prior marketplace function was not found");
const priorFunction = priorFile.slice(priorStart, priorEnd + priorEndMarker.length);

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret = 'migration-test-secret' $$;

  create table public.approved_groups (
    id uuid primary key,
    name text not null,
    members text,
    avatar_url text,
    banner_url text,
    bio text,
    discord_description text,
    owner_display_name text,
    discord_invite_url text,
    public_slug text,
    referral_code text,
    creator_fee_bps integer not null default 70,
    verification_status text not null,
    marketplace_visible boolean not null default true,
    integration_health text not null default 'healthy',
    profile_synced_at timestamptz,
    profile_sync_failed_at timestamptz,
    profile_sync_grace_started_at timestamptz,
    last_verified_at timestamptz,
    created_at timestamptz not null default now(),
    active boolean not null default true,
    removed_at timestamptz,
    suspended_at timestamptz
  );

  create table public.calls (
    id uuid primary key,
    group_id uuid references public.approved_groups(id),
    called_at timestamptz not null,
    parse_status text,
    called_price_usd numeric,
    peak_price_usd numeric,
    latest_price_usd numeric,
    called_mcap numeric,
    peak_mcap numeric,
    latest_mcap numeric,
    deleted_at timestamptz,
    executed_at timestamptz,
    last_scanned_at timestamptz
  );
  create index calls_group_called_at_idx on public.calls (group_id, called_at desc);

  create table public.subscriptions (
    id uuid primary key,
    group_id uuid references public.approved_groups(id),
    privy_user_id text,
    enabled boolean not null default false
  );
  create index idx_subscriptions_group_id on public.subscriptions (group_id);

  create table public.call_channels (
    id uuid primary key,
    group_id uuid references public.approved_groups(id),
    channel_id text not null,
    channel_name text,
    status text not null,
    removed_at timestamptz
  );
  create index idx_call_channels_group_id on public.call_channels (group_id);

  create table app_private.call_executions (
    id uuid primary key,
    call_id uuid not null references public.calls(id),
    subscription_id uuid not null references public.subscriptions(id),
    status text not null,
    finished_at timestamptz,
    unique (call_id, subscription_id)
  );

  create table app_private.performance_snapshots (
    id uuid primary key,
    subject_type text not null,
    subject_id text not null,
    period text not null,
    as_of timestamptz not null,
    sample_size integer not null,
    net_pnl_lamports bigint,
    unique (subject_type, subject_id, period, as_of)
  );
  create index performance_snapshots_subject_idx
    on app_private.performance_snapshots (subject_type, subject_id, period, as_of desc);

  create table app_private.trade_executions (id uuid primary key, status text not null);
  create table app_private.commission_ledger_entries (id uuid primary key, amount_lamports bigint not null);
`);

await db.exec(`
  insert into public.approved_groups (
    id, name, members, avatar_url, bio, owner_display_name, discord_invite_url,
    public_slug, referral_code, creator_fee_bps, verification_status,
    marketplace_visible, integration_health, profile_synced_at, last_verified_at,
    created_at, active
  ) values
    ('10000000-0000-0000-0000-000000000001', 'Measured source', '1200', 'https://cdn.test/one.png',
      'Measured fixture', 'Owner one', 'https://discord.test/one', 'measured', 'ref-one', 70,
      'approved', true, 'healthy', now() - interval '1 hour', now() - interval '1 hour',
      now() - interval '60 days', true),
    ('10000000-0000-0000-0000-000000000002', 'Collecting source', '250', 'https://cdn.test/two.png',
      'Collecting fixture', 'Owner two', 'https://discord.test/two', 'collecting', 'ref-two', 70,
      'approved', true, 'healthy', now() - interval '2 hours', now() - interval '2 hours',
      now() - interval '30 days', true);

  insert into public.call_channels (id, group_id, channel_id, channel_name, status) values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'channel-one', 'calls', 'approved'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'channel-two', 'calls', 'approved');

  insert into public.subscriptions (id, group_id, privy_user_id, enabled) values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fixture-user-one', true),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'fixture-user-two', false);

  insert into public.calls (
    id, group_id, called_at, parse_status, called_price_usd, peak_price_usd,
    latest_price_usd, executed_at, last_scanned_at
  ) values
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now() - interval '6 hours', 'accepted', 100, 200, 150, now() - interval '5 hours', now() - interval '1 hour'),
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', now() - interval '5 hours', 'accepted', 100, null, null, null, now() - interval '2 hours'),
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', now() - interval '4 hours', 'rejected', null, null, null, null, null),
    ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', now() - interval '3 hours', 'duplicate', null, null, null, null, null);

  insert into app_private.call_executions (id, call_id, subscription_id, status, finished_at) values
    ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'succeeded', now() - interval '4 hours');

  insert into app_private.performance_snapshots (
    id, subject_type, subject_id, period, as_of, sample_size, net_pnl_lamports
  ) values
    ('60000000-0000-0000-0000-000000000001', 'discord-source', '10000000-0000-0000-0000-000000000001', '1d', now() - interval '30 minutes', 1, -100),
    ('60000000-0000-0000-0000-000000000002', 'discord-source', '10000000-0000-0000-0000-000000000001', '7d', now() - interval '30 minutes', 2, 500);

  insert into app_private.trade_executions values ('70000000-0000-0000-0000-000000000001', 'confirmed');
  insert into app_private.commission_ledger_entries values ('80000000-0000-0000-0000-000000000001', 14);
`);

await db.exec(priorFunction);

async function counts() {
  const result = await db.query(`
    select
      (select count(*)::integer from public.approved_groups) as approved_groups,
      (select count(*)::integer from public.calls) as calls,
      (select count(*)::integer from public.subscriptions) as subscriptions,
      (select count(*)::integer from app_private.call_executions) as call_executions,
      (select count(*)::integer from app_private.performance_snapshots) as performance_snapshots,
      (select count(*)::integer from app_private.trade_executions) as trade_executions,
      (select count(*)::integer from app_private.commission_ledger_entries) as commissions
  `);
  return result.rows[0];
}

async function marketplace(period = "7d", sort = "performance") {
  const result = await db.query(
    "select public.app_public_list_discord_marketplace($1, $2, $3, $4) as payload",
    ["migration-test-secret", period, sort, 50]
  );
  return result.rows[0].payload;
}

const beforeCounts = await counts();
const beforePayload = await marketplace();
assert.equal(beforePayload.sources.length, 2, "pre-migration marketplace fixture is valid");

await db.exec(migration);
await db.exec(migration);

const afterCounts = await counts();
assert.deepEqual(afterCounts, beforeCounts, "migration and rerun preserve all fixture rows");

const afterPayload = await marketplace();
assert.equal(afterPayload.ok, true);
assert.equal(afterPayload.period, "7d");
assert.equal(afterPayload.sources.length, 2);

const measured = afterPayload.sources.find((source) => source.id === "10000000-0000-0000-0000-000000000001");
const collecting = afterPayload.sources.find((source) => source.id === "10000000-0000-0000-0000-000000000002");
assert.ok(measured && collecting);
assert.equal(measured.acceptedCalls, 2);
assert.equal(measured.rejectedCalls, 2);
assert.equal(measured.executedCalls, 1);
assert.equal(measured.measuredCalls, 1);
assert.equal(measured.twoX, 1);
assert.equal(Number(measured.averageReturnX), 2);
assert.equal(Number(measured.medianReturnX), 2);
assert.equal(Number(measured.winRate), 100);
assert.equal(Number(measured.maxDrawdownBps), 2500);
assert.equal(measured.performance1d.sampleSize, 1);
assert.equal(measured.performance1d.netPnlLamports, "-100");
assert.equal(measured.performance7d.sampleSize, 2);
assert.equal(measured.performance7d.netPnlLamports, "500");
assert.equal(measured.performance30d, null);
assert.ok(measured.dataFreshnessAt);
assert.ok(measured.lastProcessedCallAt);
assert.ok(measured.lastSuccessfulExecutionAt);

assert.equal(collecting.acceptedCalls, 0);
assert.equal(collecting.rejectedCalls, 0);
assert.equal(collecting.executedCalls, 0);
assert.equal(collecting.measuredCalls, 0);
assert.equal(collecting.averageReturnX, null);
assert.equal(collecting.medianReturnX, null);
assert.equal(collecting.winRate, null);
assert.equal(collecting.maxDrawdownBps, null);
assert.equal(collecting.performance1d, null);
assert.equal(collecting.performance7d, null);
assert.equal(collecting.performance30d, null);
assert.equal(collecting.dataFreshnessAt, null);
assert.equal(collecting.lastProcessedCallAt, null);
assert.equal(collecting.lastSuccessfulExecutionAt, null);

await db.exec("set role anon");
await assert.rejects(() => marketplace(), /permission denied/i);
await db.exec("reset role");
await db.exec("set role authenticated");
await assert.rejects(() => marketplace(), /permission denied/i);
await db.exec("reset role");
await db.exec("set role service_role");
const servicePayload = await marketplace("1d", "calls");
assert.equal(servicePayload.ok, true);
await db.exec("reset role");

const privileges = await db.query(`
  select
    has_function_privilege('anon', 'public.app_public_list_discord_marketplace(text,text,text,integer)', 'execute') as anon_execute,
    has_function_privilege('authenticated', 'public.app_public_list_discord_marketplace(text,text,text,integer)', 'execute') as authenticated_execute,
    has_function_privilege('service_role', 'public.app_public_list_discord_marketplace(text,text,text,integer)', 'execute') as service_role_execute
`);
assert.deepEqual(privileges.rows[0], {
  anon_execute: false,
  authenticated_execute: false,
  service_role_execute: true
});

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  beforeCounts,
  afterCounts,
  rerun: "PASS",
  preservation: "PASS",
  authorization: "PASS",
  unknownMetricsRemainNull: "PASS",
  measuredMetrics: {
    acceptedCalls: measured.acceptedCalls,
    rejectedCalls: measured.rejectedCalls,
    executedCalls: measured.executedCalls,
    netPnl7dLamports: measured.performance7d.netPnlLamports
  }
}, null, 2));

await db.close();
