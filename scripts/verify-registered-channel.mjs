/**
 * Only a registered, approved, ACTIVE guild/channel pair may produce a call.
 *
 * WHAT THIS CLOSES. Two functions decided whether a channel is a call source, and they did not
 * check the same thing.
 *
 *   bot_approved_call_channels  (the listener's cached map)
 *     channel approved, not removed, AND source active, approved, not removed
 *
 *   bot_ingest_discord_signal_v2  (the gate the journal passes through)
 *     channel approved, not removed. LEFT JOIN approved_groups, for the NAME only.
 *
 * So the authoritative gate never looked at the source's approval state. Since the map is a
 * cache refreshed on a timer, an administrator removing a source did not stop calls until the
 * next refresh — and the gate would have accepted them even then. FINAL_LAUNCH_SPEC requires
 * removal to prevent new calls immediately.
 *
 * It was also reachable with no cache involved: `admin_decide_call_channel` reactivated a
 * previously REMOVED source by setting `active = true` while leaving verification_status,
 * removed_at, suspended_at and removal_reason untouched. Approving one channel therefore
 * resumed ingestion from a source removed for cause, while every marketplace surface — which
 * reads verification_status — kept it hidden.
 *
 * Every property below drives the REAL gate against real PostgreSQL. The control run at the end
 * reinstalls the previous gate and watches a removed source's call be accepted.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const results = {};
const read = (f) => readFile(`${repo}/supabase/${f}`, "utf8");

const T = ["public.approved_groups", "public.call_channels", "public.calls"];

const GUILD = "1520209045544374342";
const OTHER_GUILD = "1520209045544374399";
const MINT = "So11111111111111111111111111111111111111112";
const HASH = "a".repeat(64);

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.bot_secret_ok(p text) returns boolean
  language sql stable security definer set search_path='' as $x$ select p is not null and p='bot-secret' $x$;
  create function app_private.admin_secret_ok(p text) returns boolean
  language sql stable security definer set search_path='' as $x$ select p is not null and p='admin-secret' $x$;
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
await db.exec(`
  create table app_private.raw_signals (id uuid primary key default gen_random_uuid(),
    source_type text not null, source_ref text not null, external_event_id text,
    event_version text, immutable_payload jsonb not null, content_hash text not null,
    received_at timestamptz not null default now(),
    edited_at timestamptz, deleted_at timestamptz,
    constraint raw_signals_source_ref_external_key unique (source_type, source_ref, external_event_id));
  create table app_private.parsed_signals (id uuid primary key default gen_random_uuid(),
    raw_signal_id uuid not null references app_private.raw_signals(id), parser_version text not null,
    status text not null, mint text, confidence_bps integer, rejection_reason text,
    normalized_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint parsed_signals_raw_parser_key unique (raw_signal_id, parser_version));
  create unique index calls_message_id_unique
    on public.calls (message_id) where message_id is not null;
  -- public-source-profiles.sql also carries admin_decide_server_application, which is outside
  -- this migration's surface. Present so that file compiles; nothing below touches it.
  create table public.server_applications (
    id uuid primary key default gen_random_uuid(),
    guild_id text, guild_name text, guild_member_count integer, channel_id text,
    channel_name text, status text default 'pending', owner_privy_user_id text,
    decided_at timestamptz, decision_reason text, created_at timestamptz not null default now()
  );
`);

const PREVIOUS = [
  "degenaration-discord-signal-ingestion.sql",
  "degenaration-discord-edit-retraction.sql",
  "degenaration-discord-public-profiles.sql",
  "public-source-profiles.sql"
];
for (const file of PREVIOUS) await db.exec(await read(file));
await db.exec(await read("degenaration-registered-channel-authorization.sql"));
// Every deployment is a rerun after a rollback.
await db.exec(await read("degenaration-registered-channel-authorization.sql"));
results.rerunSafe = "PASS";

const one = async (text, params = []) => (await db.query(text, params)).rows[0];

// The 17-argument signature must be GONE, not overloaded beside the new one. An overload is
// how degenaration-exit-plan-state.sql broke, and here it would make every ingest raise
// "function is not unique" — worse than the hole being closed.
const arities = (await db.query(`
  select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bot_ingest_discord_signal_v2'
  order by pronargs
`)).rows.map((r) => Number(r.pronargs));
assert.deepEqual(arities, [18], "exactly one signature must exist, at the new arity");
results.noDuplicateArity = "PASS";

let messageSeq = 0;
async function ingest({ channelId, guildId = GUILD, eventType = "create" }) {
  messageSeq += 1;
  const messageId = String(1600000000000000000n + BigInt(messageSeq));
  return (await one(
    `select public.bot_ingest_discord_signal_v2(
       p_secret => 'bot-secret', p_guild_id => $1::text, p_channel_id => $2::text,
       p_channel_name => 'calls', p_mint => $3::text, p_symbol => 'SOL',
       p_called_mcap => 1000, p_called_price_usd => 1, p_called_liquidity_usd => 1000,
       p_message_id => $4::text, p_caller => 'caller', p_confidence => 'link',
       p_event_type => $5::text, p_event_version => 'original', p_edited_at => null,
       p_parser_version => 'discord-v3', p_confidence_bps => 9500, p_content_hash => $6::text
     ) as r`,
    [guildId, channelId, MINT, messageId, eventType, HASH.slice(0, 63) + String(messageSeq % 10)]
  )).r;
}

const refusals = async (channelId) => (await db.query(
  "select reason, guild_id, registered_guild_id from app_private.discord_ingestion_refusals where channel_id=$1::text order by refused_at",
  [channelId]
)).rows;

/**
 * A source and one approved channel on it, in whatever state the test needs.
 *
 * Each source gets its OWN guild. In production a Discord guild maps to one approved source,
 * and sharing one guild across fixtures made `admin_decide_call_channel`'s "find the group by
 * guild" lookup pick an arbitrary one — which made property 8 pass for the wrong reason.
 */
let channelSeq = 0;
async function source({ groupState = {}, channelStatus = "approved", guildId = null, linked = true } = {}) {
  channelSeq += 1;
  const channelId = String(1521876069693526100n + BigInt(channelSeq));
  guildId = guildId ?? String(1520209045544370000n + BigInt(channelSeq));
  const group = await one(
    `insert into public.approved_groups
       (name, discord_guild_id, active, verification_status, removed_at, suspended_at)
     values ($1::text, $2::text, $3::boolean, $4::text, $5::timestamptz, $6::timestamptz)
     returning *`,
    [
      `Source ${channelSeq}`, guildId,
      groupState.active ?? true,
      groupState.verificationStatus ?? "approved",
      groupState.removedAt ?? null,
      groupState.suspendedAt ?? null
    ]
  );
  const channel = await one(
    `insert into public.call_channels (group_id, guild_id, channel_id, channel_name, status)
     values ($1::uuid, $2::text, $3::text, 'calls', $4::text) returning *`,
    [linked ? group.id : null, guildId, channelId, channelStatus]
  );
  return { group, channel, channelId, guildId };
}

// ── 1. the happy path still works ───────────────────────────────────────────────────────────
{
  const { channelId, group, guildId } = await source({ guildId: GUILD });
  const accepted = await ingest({ channelId, guildId });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.group, group.name);
  assert.equal((await refusals(channelId)).length, 0, "an approved pair must record no refusal");

  // The journal's source reference is built from the REGISTERED guild, which is what every
  // downstream projection keys on.
  const raw = await one("select source_ref, immutable_payload from app_private.raw_signals limit 1");
  assert.equal(raw.source_ref, `discord:${GUILD}:${channelId}`);
  assert.equal(raw.immutable_payload.reportedGuildId, GUILD,
    "what the caller claimed is kept beside what the registration says");
  results.approvedPairAccepted = "PASS";
}

// ── 2. the source's own state is now the gate ───────────────────────────────────────────────
//
// The whole defect: every one of these was accepted before, because the gate looked only at the
// channel row. The reasons are distinct so an operator can tell removal from suspension.
{
  const cases = [
    { name: "removed", groupState: { removedAt: "2026-01-01T00:00:00Z", verificationStatus: "removed", active: false }, reason: "source removed" },
    { name: "suspended", groupState: { suspendedAt: "2026-01-01T00:00:00Z", verificationStatus: "suspended", active: false }, reason: "source suspended" },
    { name: "inactive", groupState: { active: false }, reason: "source inactive" },
    { name: "pending", groupState: { verificationStatus: "pending" }, reason: "source pending" }
  ];
  for (const item of cases) {
    const { channelId, guildId } = await source({ groupState: item.groupState });
    const verdict = await ingest({ channelId, guildId });
    assert.equal(verdict.ok, false, `${item.name}: a call from this source must be refused`);
    assert.equal(verdict.status, 403);
    assert.equal(verdict.reason, item.reason, `${item.name}: the reason must name what is wrong`);

    const logged = await refusals(channelId);
    assert.equal(logged.length, 1, `${item.name}: the refusal must be recorded, not only returned`);
    assert.equal(logged[0].reason, item.reason);
  }
  results.sourceStateIsTheGate = "PASS";

  // And nothing was journaled. A refused call must not appear in the source's record.
  const journaled = await one("select count(*)::int as n from public.calls");
  assert.equal(journaled.n, 1, "only the accepted call from property 1 exists");
  results.refusedCallIsNotJournaled = "PASS";
}

// ── 3. the channel's own state ──────────────────────────────────────────────────────────────
{
  for (const status of ["pending", "rejected", "suspended", "removed"]) {
    const { channelId, guildId } = await source({ channelStatus: status });
    const verdict = await ingest({ channelId, guildId });
    assert.equal(verdict.ok, false, `a ${status} channel must be refused`);
    assert.equal((await refusals(channelId))[0].reason, `channel ${status}`);
  }

  const unregistered = "1521876069693599999";
  const verdict = await ingest({ channelId: unregistered });
  assert.equal(verdict.ok, false);
  assert.equal((await refusals(unregistered))[0].reason, "channel not registered");

  const { channelId, guildId } = await source({ linked: false });
  assert.equal((await ingest({ channelId, guildId })).ok, false);
  assert.equal((await refusals(channelId))[0].reason, "channel has no linked source");
  results.channelStateIsTheGate = "PASS";
}

// ── 4. the guild/channel PAIR ───────────────────────────────────────────────────────────────
//
// Channel snowflakes are globally unique, so this is not about a collision. source_ref is built
// from the REGISTERED guild and every projection keys on it, so a stale registration attributes
// a call to the wrong source with nothing able to detect it — the only two values being
// compared came from the same row.
{
  const { channelId, guildId } = await source();
  const verdict = await ingest({ channelId, guildId: OTHER_GUILD });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "channel registered to a different guild");

  const logged = await refusals(channelId);
  assert.equal(logged[0].guild_id, OTHER_GUILD, "the refusal records what the caller claimed");
  assert.equal(logged[0].registered_guild_id, guildId, "and what the registration says");
  results.guildChannelPair = "PASS";
}

// ── 5. a caller that sends no guild still works, and one that sends rubbish does not ─────────
//
// The deployment window: the bridge and the listener are deployed after the migration, so for a
// period the caller sends 17 arguments. That must keep ingesting. A MALFORMED guild is a
// different thing — it means the caller is broken, and it is refused rather than nulled.
{
  const { channelId, guildId } = await source();
  const accepted = await ingest({ channelId, guildId: null });
  assert.equal(accepted.ok, true, "a build predating p_guild_id must keep ingesting");

  const raw = await one(
    "select immutable_payload from app_private.raw_signals where source_ref = $1::text",
    [`discord:${guildId}:${channelId}`]
  );
  assert.equal(raw.immutable_payload.reportedGuildId, null,
    "and the journal records that no guild was supplied, rather than implying one was checked");

  const { channelId: other } = await source();
  await assert.rejects(
    () => ingest({ channelId: other, guildId: "not-a-snowflake" }),
    /invalid Discord event identifiers/,
    "a malformed guild must be refused, not read as absent"
  );
  results.absentGuildAcceptedMalformedRefused = "PASS";
}

// ── 6. removal takes effect immediately, mid-life ───────────────────────────────────────────
//
// The operational claim in FINAL_LAUNCH_SPEC: removing a source in Admin immediately prevents
// new calls without deleting history.
{
  const { channelId, group, guildId } = await source();
  assert.equal((await ingest({ channelId, guildId })).accepted, true);
  const before = await one("select count(*)::int as n from public.calls where group_id=$1::uuid", [group.id]);

  await db.query(
    `update public.approved_groups
        set verification_status='removed', active=false, removed_at=now()
      where id=$1::uuid`,
    [group.id]
  );

  const after = await ingest({ channelId, guildId });
  assert.equal(after.ok, false);
  assert.equal(after.reason, "source removed");

  const still = await one("select count(*)::int as n from public.calls where group_id=$1::uuid", [group.id]);
  assert.equal(still.n, before.n, "history is preserved — removal stops new calls, it does not erase old ones");
  results.removalIsImmediateAndPreservesHistory = "PASS";
}

// ── 7. the map and the gate cannot disagree ─────────────────────────────────────────────────
//
// bot_approved_call_channels is now derived from the same predicate. Asserting they agree ACROSS
// every state is the property; the two drifting apart is the defect this migration closes.
{
  const listed = new Set(
    ((await one("select public.bot_approved_call_channels('bot-secret') as r")).r || [])
      .map((row) => row.channel_id)
  );
  const every = (await db.query("select channel_id, guild_id from public.call_channels")).rows;
  for (const row of every) {
    const auth = await one(
      "select refusal from app_private.authorized_call_channel($1::text, $2::text)",
      [row.channel_id, row.guild_id]
    );
    assert.equal(
      listed.has(row.channel_id), auth.refusal === null,
      `channel ${row.channel_id}: the listener's map and the journal's gate must agree`
    );
  }
  assert.ok(every.length > 8, "fixture check: this is only meaningful across many states");
  results.mapAndGateAgree = "PASS";
}

// ── 8. approving a channel cannot silently reinstate a removed source ───────────────────────
{
  const { group, channelId } = await source({ groupState: { removedAt: "2026-01-01T00:00:00Z", verificationStatus: "removed", active: false } });
  const pending = await one(
    `insert into public.call_channels (guild_id, channel_id, channel_name, status)
     values ($1::text, $2::text, 'new-calls', 'pending') returning *`,
    [group.discord_guild_id, String(BigInt(channelId) + 500n)]
  );

  const verdict = (await one(
    "select public.admin_decide_call_channel('admin-secret', $1::uuid, 'approve') as r", [pending.id]
  )).r;
  assert.equal(verdict.ok, false, "approving a channel on a removed source must be refused");
  assert.equal(verdict.status, 409);
  assert.match(verdict.error, /removed/);
  assert.match(verdict.error, /reinstate it first/);

  const untouched = await one("select * from public.approved_groups where id=$1::uuid", [group.id]);
  assert.equal(untouched.active, false, "and the refusal must not have reactivated it");
  assert.equal(untouched.verification_status, "removed");
  assert.equal((await one("select status from public.call_channels where id=$1::uuid", [pending.id])).status, "pending");

  // Reinstating deliberately, then approving, works.
  await db.query(
    `update public.approved_groups
        set verification_status='approved', active=true, removed_at=null, suspended_at=null
      where id=$1::uuid`,
    [group.id]
  );
  const now = (await one(
    "select public.admin_decide_call_channel('admin-secret', $1::uuid, 'approve') as r", [pending.id]
  )).r;
  assert.equal(now.ok, true, "after an audited reinstatement the same approval succeeds");
  results.approvalCannotReinstateRemovedSource = "PASS";
}

// ── 9. reinstalling the predecessor WITHOUT dropping the new arity is ambiguous ─────────────
//
// Found by this suite's own control run. `create or replace` at a different arity creates an
// OVERLOAD, so reapplying the 17-argument predecessor over the 18-argument function leaves both
// installed and every call raises "function is not unique". That is the failure
// degenaration-exit-plan-state.sql already had, in the direction you only run during an
// incident. supabase/rollback/12-registered-channel-authorization.sql drops the wide signature
// FIRST; this proves the drop is load-bearing rather than defensive.
{
  await db.exec(await read("degenaration-discord-signal-ingestion.sql"));
  const installed = (await db.query(`
    select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bot_ingest_discord_signal_v2' order by pronargs
  `)).rows.map((r) => Number(r.pronargs));
  assert.deepEqual(installed, [17, 18], "fixture check: the naive reapply must leave both arities");

  await assert.rejects(
    () => db.query(
      `select public.bot_ingest_discord_signal_v2(
         'bot-secret', $1::text, 'calls', $2::text, 'SOL', 1000, 1, 1000, $3::text, 'caller',
         'link', 'create', 'original', null, 'discord-v3', 9500, $4::text)`,
      ["1521876069693526101", MINT, "1700000000000000001", "c".repeat(64)]
    ),
    /is not unique/,
    "both arities installed must break every call — which is why the rollback drops one first"
  );
  results.naiveReapplyIsAmbiguous = "PASS";
}

// ── CONTROL: the previous gate accepts a removed source's call ──────────────────────────────
//
// Without this the suite proves only that the new gate agrees with itself. The wide signature is
// dropped — exactly as the rollback script does — leaving the previous 17-argument body, and the
// removed-source case is replayed. It must be ACCEPTED, which is the production defect.
{
  const { channelId, group, guildId } = await source({
    groupState: { removedAt: "2026-01-01T00:00:00Z", verificationStatus: "removed", active: false }
  });

  await db.exec(`
    drop function if exists public.bot_ingest_discord_signal_v2(
      text, text, text, text, text, numeric, numeric, numeric, text, text, text,
      text, text, timestamptz, text, integer, text, text);
  `);
  await db.exec(await read("degenaration-discord-edit-retraction.sql"));

  messageSeq += 1;
  const messageId = String(1700000000000000000n + BigInt(messageSeq));
  const accepted = (await one(
    `select public.bot_ingest_discord_signal_v2(
       'bot-secret', $1::text, 'calls', $2::text, 'SOL', 1000, 1, 1000, $3::text, 'caller',
       'link', 'create', 'original', null, 'discord-v3', 9500, $4::text) as r`,
    [channelId, MINT, messageId, "b".repeat(64)]
  )).r;
  assert.equal(accepted.ok, true,
    "CONTROL FAILED: the previous gate should accept a call from a REMOVED source");
  assert.equal(accepted.accepted, true);
  assert.equal(
    (await one("select count(*)::int as n from public.calls where group_id=$1::uuid", [group.id])).n, 1,
    "and journal it against the removed source"
  );
  void guildId;
  results.controlProvesRemovedSourceWasAccepted = "PASS";
}

console.log(JSON.stringify({
  verifier: "registered-channel",
  database: "PGlite (real PostgreSQL), schema rendered from the captured production shapes",
  migration: "supabase/degenaration-registered-channel-authorization.sql",
  properties: Object.keys(results).length,
  ...results,
  proves:
    "the journal's gate refuses a call whose SOURCE is removed, suspended, inactive or pending " +
    "and not only whose channel is; the guild is checked against the registration; every " +
    "refusal is recorded with a truthful reason and journals nothing; the listener's map and " +
    "the gate are derived from one predicate and agree across every state; approving a channel " +
    "cannot reinstate a removed source; and the previous gate accepted all of it",
  notProven: "that Discord delivers such an event to the deployed process — E-2",
  sideEffects: "none: no network call, nothing signed, nothing submitted"
}, null, 2));

await db.close();
