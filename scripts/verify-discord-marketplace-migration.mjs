import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

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

// Generated from the captured production shapes, never hand-written. See the comment at
// the top of scripts/lib/production-schema.mjs.
const FIXTURE_TABLES = [
  "app_private.bot_config_versions",
  "public.approved_groups",
  "public.calls",
  "public.subscriptions",
  "public.call_channels",
  "app_private.call_executions",
  "app_private.performance_snapshots",
  "app_private.trade_executions",
  "app_private.commission_ledger_entries"
];

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret = 'migration-test-secret' $$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);
await db.exec(`
  create index calls_group_called_at_idx on public.calls (group_id, called_at desc);
  create index idx_subscriptions_group_id on public.subscriptions (group_id);
  create index idx_call_channels_group_id on public.call_channels (group_id);
  create index performance_snapshots_subject_idx
    on app_private.performance_snapshots (subject_type, subject_id, period, as_of desc);
`);

await db.exec(`
  insert into public.approved_groups (
    id, name, members, avatar_url, bio, owner_display_name, discord_invite_url,
    public_slug, referral_code, creator_fee_bps, verification_status,
    marketplace_visible, integration_health, profile_synced_at,
    profile_sync_failed_at, profile_sync_grace_started_at, last_verified_at,
    created_at, active
  ) values
    ('10000000-0000-0000-0000-000000000001', 'Measured source', '1200', 'https://cdn.test/one.png',
      'Measured fixture', 'Owner one', 'https://discord.test/one', 'measured', 'ref-one', 70,
      'approved', true, 'healthy', now() - interval '1 hour', null,
      now() - interval '20 days', now() - interval '1 hour',
      now() - interval '60 days', true),
    ('10000000-0000-0000-0000-000000000002', 'Collecting source', '250', 'https://cdn.test/two.png',
      'Collecting fixture', 'Owner two', 'https://discord.test/two', 'collecting', 'ref-two', 70,
      'approved', true, 'healthy', now() - interval '2 hours', null,
      now() - interval '10 days', now() - interval '2 hours',
      now() - interval '30 days', true),
    -- Unavailable but inside the seven-day grace window: stays listed, reported degraded.
    -- The previous fixture left profile_sync_grace_started_at NULL, which production
    -- forbids, so coalesce(null, null) >= now() - interval '7 days' was NULL and this
    -- whole branch was unreachable.
    ('10000000-0000-0000-0000-000000000003', 'Grace source', '90', 'https://cdn.test/three.png',
      'Grace fixture', 'Owner three', 'https://discord.test/three', 'grace', 'ref-three', 70,
      'approved', true, 'unavailable', now() - interval '3 days', null,
      now() - interval '2 days', now() - interval '3 days',
      now() - interval '20 days', true),
    -- Unavailable with an expired grace window: dropped from the marketplace.
    ('10000000-0000-0000-0000-000000000004', 'Stale source', '40', 'https://cdn.test/four.png',
      'Stale fixture', 'Owner four', 'https://discord.test/four', 'stale', 'ref-four', 70,
      'approved', true, 'unavailable', now() - interval '30 days',
      now() - interval '30 days', now() - interval '40 days', now() - interval '30 days',
      now() - interval '50 days', true);

  insert into public.call_channels (id, guild_id, group_id, channel_id, channel_name, status) values
    ('20000000-0000-0000-0000-000000000001', 'guild-one', '10000000-0000-0000-0000-000000000001', 'channel-one', 'calls', 'approved'),
    ('20000000-0000-0000-0000-000000000002', 'guild-two', '10000000-0000-0000-0000-000000000002', 'channel-two', 'calls', 'approved'),
    ('20000000-0000-0000-0000-000000000003', 'guild-three', '10000000-0000-0000-0000-000000000003', 'channel-three', 'calls', 'approved'),
    ('20000000-0000-0000-0000-000000000004', 'guild-four', '10000000-0000-0000-0000-000000000004', 'channel-four', 'calls', 'approved');

  insert into public.subscriptions (id, group_id, privy_user_id, enabled) values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fixture-user-one', true),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'fixture-user-two', false);

  insert into public.calls (
    id, group_id, mint, called_at, parse_status, called_price_usd, peak_price_usd,
    latest_price_usd, executed_at, last_scanned_at
  ) values
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'mintOne', now() - interval '6 hours', 'accepted', 100, 200, 150, now() - interval '5 hours', now() - interval '1 hour'),
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'mintTwo', now() - interval '5 hours', 'accepted', 100, null, null, null, now() - interval '2 hours'),
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'mintThree', now() - interval '4 hours', 'rejected', null, null, null, null, null),
    ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'mintFour', now() - interval '3 hours', 'duplicate', null, null, null, null, null),
    -- Production declares no foreign key from calls to approved_groups, so an orphaned
    -- call is possible and must not break or inflate any source's metrics.
    ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-0000000000ff', 'mintOrphan', now() - interval '2 hours', 'accepted', 100, 900, 900, null, now() - interval '1 hour');

  insert into app_private.call_executions (
    id, call_id, subscription_id, status, amount_sol, finished_at
  ) values
    ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'succeeded', 0.5, now() - interval '4 hours');

  insert into app_private.performance_snapshots (
    id, subject_type, subject_id, period, as_of, sample_size, net_pnl_lamports
  ) values
    ('60000000-0000-0000-0000-000000000001', 'discord-source', '10000000-0000-0000-0000-000000000001', '1d', now() - interval '30 minutes', 1, -100),
    ('60000000-0000-0000-0000-000000000002', 'discord-source', '10000000-0000-0000-0000-000000000001', '7d', now() - interval '30 minutes', 2, 500);

  insert into app_private.trade_executions (
    id, intent_id, owner_privy_user_id, execution_mode, status
  ) values (
    '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000f1',
    'fixture-user-one', 'solana-mainnet', 'confirmed'
  );
  insert into app_private.commission_ledger_entries (
    id, account_type, source_type, account_owner_privy_user_id, amount_lamports, idempotency_key
  ) values (
    '80000000-0000-0000-0000-000000000001', 'creator', 'discord', 'creator-one', 14,
    'fixture-commission-1'
  );
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
assert.equal(beforePayload.sources.length, 3, "pre-migration marketplace fixture is valid");

await db.exec(migration);
await db.exec(migration);

const afterCounts = await counts();
assert.deepEqual(afterCounts, beforeCounts, "migration and rerun preserve all fixture rows");

const afterPayload = await marketplace();
assert.equal(afterPayload.ok, true);
assert.equal(afterPayload.period, "7d");
assert.equal(afterPayload.sources.length, 3);

const measured = afterPayload.sources.find((source) => source.id === "10000000-0000-0000-0000-000000000001");
const collecting = afterPayload.sources.find((source) => source.id === "10000000-0000-0000-0000-000000000002");
const grace = afterPayload.sources.find((source) => source.id === "10000000-0000-0000-0000-000000000003");
const stale = afterPayload.sources.find((source) => source.id === "10000000-0000-0000-0000-000000000004");
assert.ok(measured && collecting);

// The integration grace window, which the old fixture could not reach.
assert.ok(grace, "an unavailable source inside its grace window stays listed");
assert.equal(grace.integrationHealth, "degraded");
assert.equal(stale, undefined, "an unavailable source past its grace window is delisted");
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

// ---------------------------------------------------------------------------
// Controller section 2: the -50% bucket, win rate vs 2x rate, best/worst call,
// and confirmed copied volume.
//
// New fixture rows are added HERE, after the parity assertions above, so those keep
// asserting exactly what they asserted before and the new behaviour is isolated.
// ---------------------------------------------------------------------------
const callPerformance = await readFile(`${repo}/supabase/degenaration-discord-call-performance.sql`, "utf8");
const MEASURED = "10000000-0000-0000-0000-000000000001";

await db.exec(`
  insert into public.calls (
    id, group_id, mint, symbol, called_at, parse_status, called_price_usd, peak_price_usd,
    latest_price_usd, last_scanned_at
  ) values
    -- Peak 0.4x: never recovered half of entry at any point. This is the case the old
    -- ladder could not express, because it shared a cell with the +40% call below.
    ('40000000-0000-0000-0000-000000000010', '${MEASURED}', 'mintRug', 'RUG', now() - interval '3 hours', 'accepted', 100, 40, 20, now() - interval '1 hour'),
    -- Peak 1.2x: went up, never reached +50%.
    ('40000000-0000-0000-0000-000000000011', '${MEASURED}', 'mintFlat', 'FLAT', now() - interval '2 hours', 'accepted', 100, 120, 110, now() - interval '1 hour');

  insert into app_private.trade_executions (
    id, intent_id, owner_privy_user_id, execution_mode, status,
    gross_notional_lamports, source_group_id_snapshot, confirmed_at
  ) values
    ('70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-0000000000f2',
      'fixture-user-one', 'solana-mainnet', 'confirmed', 2500000000, '${MEASURED}', now() - interval '2 hours'),
    ('70000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-0000000000f3',
      'fixture-user-two', 'solana-mainnet', 'reconciled', 1500000000, '${MEASURED}', now() - interval '1 hour'),
    -- Never confirmed. Volume must exclude it: spec section 8 defines volume as confirmed
    -- executed notional, and counting a failed leg would overstate every source.
    ('70000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-0000000000f4',
      'fixture-user-two', 'solana-mainnet', 'failed', 9000000000, '${MEASURED}', null),
    -- Outside the period. Excluded from a 7d figure, included in 30d.
    ('70000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-0000000000f5',
      'fixture-user-two', 'solana-mainnet', 'confirmed', 7000000000, '${MEASURED}', now() - interval '20 days');
`);

const countsBeforeCallPerf = await counts();
await db.exec(callPerformance);
await db.exec(callPerformance);
assert.deepEqual(await counts(), countsBeforeCallPerf, "call-performance migration and rerun write no row");

const perf = (await marketplace()).sources.find((source) => source.id === MEASURED);

// The ladder is exclusive and now separates a rug from a call that went nowhere.
assert.equal(perf.measuredCalls, 3, "three measured calls: peaks 2.0, 0.4, 1.2");
assert.equal(perf.down50, 1, "the 0.4x call is reported as down 50%+");
assert.equal(perf.under50, 1, "the 1.2x call is not a rug and not a +50%");
assert.equal(perf.plus50, 0);
assert.equal(perf.twoX, 1);
assert.equal(perf.fiveX, 0);
assert.equal(perf.down50 + perf.under50 + perf.plus50 + perf.twoX + perf.fiveX, perf.measuredCalls,
  "every measured call lands in exactly one bucket");

// The two figures that shared one name. If these were ever equal the test would not
// distinguish the fix from the defect, so the fixture is chosen to make them differ.
assert.equal(Number(perf.winRate), 66.67, "two of three calls traded above entry");
assert.equal(Number(perf.twoXRate), 33.33, "one of three doubled");
assert.notEqual(Number(perf.winRate), Number(perf.twoXRate),
  "win rate and 2x rate must be separately computed, not one number under two labels");

assert.equal(perf.bestCall.mint, "mintOne");
assert.equal(Number(perf.bestCall.peakX), 2);
assert.equal(perf.worstCall.mint, "mintRug");
assert.equal(Number(perf.worstCall.peakX), 0.4);

// Confirmed copied volume, in integer lamports, from the authoritative ledger only.
assert.equal(perf.copiedExecutions, 2, "the failed leg and the out-of-period leg are excluded");
assert.equal(perf.copiedVolumeLamports, "4000000000", "2.5 SOL + 1.5 SOL, as integer lamports");
const perf30 = (await marketplace("30d")).sources.find((source) => source.id === MEASURED);
assert.equal(perf30.copiedVolumeLamports, "11000000000", "the 20-day-old leg is inside a 30d window");

// A source with no confirmed execution reports zero volume, which is a fact, while its
// unmeasured return statistics stay null, which is an absence. These must not render alike.
const stillCollecting = (await marketplace()).sources.find((source) => source.id === "10000000-0000-0000-0000-000000000002");
assert.equal(stillCollecting.copiedVolumeLamports, "0");
assert.equal(stillCollecting.winRate, null);
assert.equal(stillCollecting.twoXRate, null);
assert.equal(stillCollecting.bestCall, null);
assert.equal(stillCollecting.down50, 0);

// ─── migration 10: current return, beside peak ───────────────────────────────────────────
//
// Every return figure above is a PEAK multiple. Nothing in the payload said so and nothing
// said where the call is now, so a source whose calls all round-tripped to zero reported a
// perfect record. The fixture gains exactly that call — peaked 3x, currently at 0.5x — and
// the two families of statistic must now disagree. If they agreed, this would not
// distinguish the fix from the defect.
await db.exec(`
  insert into public.calls (
    id, group_id, mint, symbol, called_at, parse_status, called_price_usd, peak_price_usd,
    latest_price_usd, last_scanned_at
  ) values
    ('40000000-0000-0000-0000-000000000012', '${MEASURED}', 'mintRound', 'ROUND',
      now() - interval '4 hours', 'accepted', 100, 300, 50, now() - interval '1 hour');
`);

const currentReturn = await readFile(`${repo}/supabase/degenaration-discord-current-return.sql`, "utf8");
const countsBeforeCurrent = await counts();
await db.exec(currentReturn);
await db.exec(currentReturn);
assert.deepEqual(await counts(), countsBeforeCurrent, "current-return migration and rerun write no row");

const now = (await marketplace()).sources.find((source) => source.id === MEASURED);

// Peaks 2.0 / 0.4 / 1.2 / 3.0 — three of four traded above entry at some point.
assert.equal(now.measuredCalls, 4);
assert.equal(Number(now.winRate), 75, "peak: three of four went up at any point");
assert.equal(Number(now.averageReturnX), 1.65);
assert.equal(Number(now.medianReturnX), 1.6);

// Currents 1.5 / 0.2 / 1.1 / 0.5 — only two of four are above entry right now.
assert.equal(now.measuredCurrent, 4);
assert.equal(Number(now.currentWinRate), 50, "THE FIX: half of them are below entry today");
assert.equal(Number(now.averageCurrentX), 0.825, "the average call is currently DOWN, on the same population");
assert.equal(Number(now.medianCurrentX), 0.8);

assert.notEqual(Number(now.winRate), Number(now.currentWinRate),
  "peak and current win rate must be separately computed; equal values would prove nothing");
assert.ok(Number(now.averageReturnX) > 1 && Number(now.averageCurrentX) < 1,
  "the exact presentation this migration exists to end: a losing source with a winning average");

// The round trip is what drives drawdown, so the two must agree about it.
assert.equal(Number(now.maxDrawdownBps), 8333, "1 - (0.5 / 3.0) on the round-tripped call");

// Unknown still stays unknown. A source with no measured call reports null for the new
// figures too, never 0 — a zero here would read as "every call is flat", which is a claim.
const noHistory = (await marketplace()).sources.find((source) => source.id === "10000000-0000-0000-0000-000000000002");
assert.equal(noHistory.measuredCurrent, 0);
assert.equal(noHistory.averageCurrentX, null);
assert.equal(noHistory.medianCurrentX, null);
assert.equal(noHistory.currentWinRate, null);

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
  schemaParity: "PASS",
  rerun: "PASS",
  preservation: "PASS",
  authorization: "PASS",
  unknownMetricsRemainNull: "PASS",
  integrationGraceWindow: "PASS",
  expiredGraceDelisted: "PASS",
  orphanedCallDoesNotInflateMetrics: "PASS",
  down50BucketSeparatesRugFromFlat: "PASS",
  winRateDistinctFromTwoXRate: "PASS",
  bestAndWorstCall: "PASS",
  copiedVolumeExcludesUnconfirmed: "PASS",
  zeroVolumeIsNotNullMetrics: "PASS",
  currentReturnReportedBesidePeak: "PASS",
  unknownCurrentReturnStaysNull: "PASS",
  callPerformance: {
    down50: perf.down50,
    under50: perf.under50,
    twoX: perf.twoX,
    winRate: perf.winRate,
    twoXRate: perf.twoXRate,
    copiedVolumeLamports: perf.copiedVolumeLamports
  },
  measuredMetrics: {
    acceptedCalls: measured.acceptedCalls,
    rejectedCalls: measured.rejectedCalls,
    executedCalls: measured.executedCalls,
    netPnl7dLamports: measured.performance7d.netPnlLamports
  }
}, null, 2));

await db.close();
