import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
const { PERFORMANCE_CONCURRENCY, refreshCallPerformance } = require("../server/engine/performance");

const workerWrites = [];
let quoteCount = 0;
await refreshCallPerformance({
  loadPerformanceCalls: async () => [{ id: "call-a", mint: "mint-a" }, { id: "call-b", mint: "mint-a" }],
  quote: async () => {
    quoteCount += 1;
    return { provider: "dexscreener", observedAt: "2026-08-08T00:00:00.000Z", freshness: "fresh", priceUsd: 1 };
  },
  recordCallMarketScan: async (id, quote) => {
    workerWrites.push({ id, quote });
    return { measured: true, newMilestones: 0 };
  }
});
assert.equal(quoteCount, 1, "one deterministic tick reuses a mint quote across calls");
assert.deepEqual(workerWrites.map((entry) => entry.id), ["call-a", "call-b"]);

let activeQuotes = 0;
let peakQuotes = 0;
await refreshCallPerformance({
  loadPerformanceCalls: async () => Array.from({ length: PERFORMANCE_CONCURRENCY + 3 }, (_, index) => ({
    id: `parallel-${index}`,
    mint: `parallel-mint-${index}`
  })),
  quote: async () => {
    activeQuotes += 1;
    peakQuotes = Math.max(peakQuotes, activeQuotes);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeQuotes -= 1;
    return { provider: "test", freshness: "fresh", priceUsd: 1 };
  },
  recordCallMarketScan: async () => ({ measured: true })
});
assert.ok(peakQuotes > 1, "independent mint quotes run concurrently");
assert.ok(peakQuotes <= PERFORMANCE_CONCURRENCY, "quote concurrency stays bounded");

const failureEvents = [];
const loadFailure = await refreshCallPerformance({
  loadPerformanceCalls: async () => { throw new Error("database unavailable"); },
  recordCallMarketScan: async () => ({ measured: true }),
  onEvent: (event) => failureEvents.push(event)
});
assert.equal(loadFailure.loadErrors, 1);
assert.equal(failureEvents[0].type, "PERFORMANCE_LOAD_ERROR");

const db = new PGlite();
const migration = await readFile("supabase/degenaration-call-performance-journal.sql", "utf8");
const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";
const CALL = "bbbbbbbb-0000-0000-0000-000000000001";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const GUILD = "1520209045544374342";
const CHANNEL = "1521876069693526158";

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.admin_secret_ok(p text) returns boolean
    language sql stable security definer set search_path='' as $x$ select p='admin-secret' $x$;
  create table public.approved_groups (
    id uuid primary key, name text, active boolean not null default true,
    verification_status text not null default 'approved', removed_at timestamptz
  );
  create table public.call_channels (
    id uuid primary key default gen_random_uuid(), group_id uuid, guild_id text, channel_id text
  );
  create table public.calls (
    id uuid primary key, group_id uuid, mint text not null, symbol text,
    called_at timestamptz not null default now(), called_price_usd numeric,
    peak_price_usd numeric, latest_price_usd numeric, called_mcap numeric,
    peak_mcap numeric, latest_mcap numeric, latest_liquidity_usd numeric,
    last_scanned_at timestamptz, parse_status text not null default 'accepted', deleted_at timestamptz
  );
  create table app_private.scanner_tokens (
    mint text primary key, symbol text, first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(), validation_status text,
    validation_reason text, metadata jsonb not null default '{}'::jsonb
  );
  create table app_private.market_snapshots (
    id uuid primary key default gen_random_uuid(), mint text not null references app_private.scanner_tokens(mint),
    provider text not null, observed_at timestamptz not null, price_usd numeric,
    market_cap_usd numeric, liquidity_usd numeric, payload jsonb not null default '{}'::jsonb,
    freshness_status text not null default 'fresh', unique(mint,provider,observed_at)
  );
  create table app_private.raw_signals (
    id uuid primary key default gen_random_uuid(), source_type text, received_at timestamptz default now(),
    immutable_payload jsonb not null
  );
  create table app_private.parsed_signals (
    id uuid primary key default gen_random_uuid(), raw_signal_id uuid references app_private.raw_signals(id), status text
  );
`);
await db.exec(migration);
await db.query("insert into public.approved_groups(id,name) values($1::uuid,'Alpha')", [GROUP]);
await db.query("insert into public.call_channels(group_id,guild_id,channel_id) values($1::uuid,$2,$3)", [GROUP,GUILD,CHANNEL]);
await db.query(`insert into public.calls
  (id,group_id,mint,symbol,called_at,called_price_usd,peak_price_usd,latest_price_usd)
  values($1::uuid,$2::uuid,$3,'BONK',now()-interval '1 hour',1,1,1)`, [CALL,GROUP,MINT]);

async function scan(price, minute, freshness="fresh") {
  return (await db.query(`select public.worker_record_call_market_scan(
    $1::uuid,'dexscreener',date_trunc('minute',now())+($2::text||' minutes')::interval,$3::numeric,
    100::numeric,50::numeric,$4::text) r`, [CALL,String(minute),price,freshness])).rows[0].r;
}

assert.equal((await scan("0.5", -50)).newMilestones, 1);
assert.equal((await scan("1.5", -40)).newMilestones, 1);
assert.equal((await scan("2", -30)).newMilestones, 1);
assert.equal((await scan("5", -20)).newMilestones, 1, "the already-hit 2x milestone is not journaled twice");
await scan("1.2", -10);

const call = (await db.query("select * from public.calls where id=$1::uuid", [CALL])).rows[0];
assert.equal(String(call.minimum_price_usd), "0.5");
assert.equal(String(call.peak_price_usd), "5");
assert.equal(String(call.latest_price_usd), "1.2");
assert.equal(call.current_return_bps, 2000);
assert.equal(call.maximum_return_bps, 40000);
assert.equal(call.performance_status, "measured");
assert.equal(call.performance_provider, "dexscreener");

const milestones = (await db.query(`select milestone,first_hit_price_usd,scan_id
  from app_private.call_performance_milestones where call_id=$1::uuid order by milestone`, [CALL])).rows;
assert.equal(milestones.length, 4);
assert.deepEqual(milestones.map((row) => row.milestone), ["down_50","five_x","plus_50","two_x"]);
assert.ok(milestones.every((row) => row.scan_id), "every milestone cites its immutable market scan");

const replay = await scan("1.2", -10);
assert.equal(replay.newMilestones, 0);
assert.equal((await db.query("select count(*)::integer n from app_private.market_snapshots")).rows[0].n, 5,
  "the same provider observation is replay-idempotent");
assert.equal((await db.query("select count(*)::integer n from app_private.call_performance_milestones")).rows[0].n, 4);

await scan(null, -5, "unavailable");
const afterUnavailable = (await db.query("select performance_status,performance_freshness,latest_price_usd from public.calls where id=$1::uuid", [CALL])).rows[0];
assert.equal(afterUnavailable.performance_status, "measured", "a provider miss does not erase valid history");
assert.equal(afterUnavailable.performance_freshness, "unavailable");
assert.equal(String(afterUnavailable.latest_price_usd), "1.2", "missing data never overwrites the last observation with zero");

await db.query(`insert into app_private.raw_signals(source_type,immutable_payload) values
  ('discord',$1::jsonb),('discord',$1::jsonb) returning id`,
  [JSON.stringify({guildId:GUILD,channelId:CHANNEL})]);
const raw = (await db.query("select id from app_private.raw_signals order by received_at,id")).rows;
await db.query("insert into app_private.parsed_signals(raw_signal_id,status) values($1::uuid,'accepted'),($2::uuid,'rejected')", [raw[0].id,raw[1].id]);
const stats = (await db.query("select public.app_public_discord_journal_stats('admin-secret','7d') r")).rows[0].r.sources[0];
assert.equal(stats.totalCalls, 2);
assert.equal(stats.acceptedCalls, 1);
assert.equal(stats.rejectedCalls, 1);
assert.equal(stats.measuredCalls, 1);
assert.equal(stats.activeMonitoring, 1);
assert.equal(stats.down50Hits, 1);
assert.equal(stats.plus50Hits, 1);
assert.equal(stats.twoXHits, 1);
assert.equal(stats.fiveXHits, 1);
assert.equal(stats.milestoneHistoryComplete, true);
assert.equal(stats.medianCurrentReturnBps, 2000);
assert.equal(stats.medianPeakReturnBps, 40000);

console.log(JSON.stringify({
  verifier: "call-performance-journal",
  immutableScans: "PASS", milestoneFirstHitOnly: "PASS", exactThresholds: "PASS",
  currentAndMaximumContinue: "PASS", replayIdempotent: "PASS",
  truthfulSourceStats: "PASS", noHistoricalFabrication: "PASS"
}, null, 2));
await db.close();
