/**
 * bot_ingest_discord_signal_v2 — the boundary where untrusted input enters the system.
 *
 * Everything downstream of it was covered and it was not: verify:pipeline-e2e starts at
 * parsed_signals, one step AFTER ingestion. That left the least trusted input in the product
 * as the only untested stage, which is backwards.
 *
 * Asserts the guards that decide whether a call is actionable at all: Discord snowflake shape,
 * event type and version, base58 mint, parser evidence bounds, approved-channel enforcement,
 * and content-hash deduplication against a replayed delivery.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const sql = await readFile(`${repo}/supabase/degenaration-discord-signal-ingestion.sql`, "utf8");
const T = ["public.approved_groups", "public.call_channels", "public.calls"];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.bot_secret_ok(p text) returns boolean
  language sql stable security definer set search_path='' as $x$ select p is not null and p='bot-secret' $x$;
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
await db.exec(`
  create table app_private.raw_signals (id uuid primary key default gen_random_uuid(),
    source_type text not null, source_ref text not null, external_event_id text,
    event_version text, immutable_payload jsonb not null, content_hash text not null,
    received_at timestamptz not null default now(),
    edited_at timestamptz, deleted_at timestamptz);
  -- Production carries BOTH. The original external_event_id constraint is what the function's
  -- ON CONFLICT infers against; the content_hash one was added because the first is defeatable
  -- by NULL (Postgres treats NULLs as distinct, so two identical bodies with a null event id
  -- both inserted). Omitting either changes the function's behaviour.
  alter table app_private.raw_signals
    add constraint raw_signals_source_ref_external_key unique (source_type, source_ref, external_event_id);
  create unique index raw_signals_source_content_unique
    on app_private.raw_signals (source_type, source_ref, content_hash);
  create table app_private.parsed_signals (id uuid primary key default gen_random_uuid(),
    raw_signal_id uuid not null references app_private.raw_signals(id), parser_version text not null,
    status text not null, mint text, confidence_bps integer, rejection_reason text,
    normalized_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    -- The function upserts a parse per (raw signal, parser version), so a new parser version
    -- may re-parse the same event without destroying the previous verdict.
    constraint parsed_signals_raw_parser_key unique (raw_signal_id, parser_version));
`);
// production-schema.mjs captures CONSTRAINTS but not standalone unique INDEXES, so this one
// does not come through renderTables. The function's `on conflict (message_id) where
// message_id is not null` infers against it, and without it ingestion fails at 42P10.
await db.exec(`create unique index calls_message_id_unique
  on public.calls (message_id) where message_id is not null;`);
await db.exec(sql);

const S = "bot-secret";
const G = "aaaaaaaa-0000-0000-0000-000000000001";
const CH = "123456789012345678";           // Discord snowflake, 18 digits
const MSG = "987654321098765432";
const MINT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const HASH = "a".repeat(64);
const results = {};

await db.query("insert into public.approved_groups (id,name) values ($1::uuid,'Src')", [G]);
await db.query(`insert into public.call_channels (group_id,guild_id,channel_id,status)
  values ($1::uuid,'guild-1',$2::text,'approved')`, [G, CH]);

const ingest = (o = {}) => db.query(
  `select public.bot_ingest_discord_signal_v2(
     $1::text,$2::text,'general',$3::text,'SYM',null,null,null,$4::text,'caller','high',
     $5::text,$6::text,null,'v1',$7::integer,$8::text) as r`,
  // `in` rather than ??, so a deliberately NULL secret reaches the function instead of being
  // replaced by the valid one -- which is exactly the case being tested.
  ["secret" in o ? o.secret : S, o.channel ?? CH, o.mint === undefined ? MINT : o.mint, o.msg ?? MSG,
   o.eventType ?? "create", o.eventVersion ?? "1", o.confidence ?? 9000, o.hash ?? HASH]
).then((r) => r.rows[0].r);

const counts = async () => (await db.query(
  `select (select count(*)::integer from app_private.raw_signals) raw,
          (select count(*)::integer from app_private.parsed_signals) parsed,
          (select count(*)::integer from public.calls) calls`)).rows[0];

// ---- a valid call is ingested, parsed and journalled ----
const first = await ingest();
assert.equal(first.ok, true, "an approved channel with valid evidence is accepted");
let c = await counts();
assert.equal(c.raw, 1, "the raw event is persisted before anything is derived from it");
assert.equal(c.parsed, 1, "and a parsed signal is written alongside");
results.validCallIngested = "PASS";

// ---- content-hash dedupe survives a replayed delivery ----
//
// The pre-existing constraint keyed on external_event_id was defeatable by NULL. content_hash
// is NOT NULL, so an identical body cannot insert twice however the event id arrives.
const replay = await ingest();
c = await counts();
assert.equal(c.raw, 1, "an identical redelivery creates no second raw event");
assert.ok(replay.ok === true || replay.duplicate === true,
  "a replay is reported as handled, not as a failure the bot should retry");
results.replayDeduped = "PASS";

// ---- an unapproved channel is refused ----
// The channel EXISTS but is pending. An absent channel would be rejected by the join finding
// nothing, which tests the join and not the approval gate -- a control run caught exactly that.
const OTHER = "111222333444555666";
await db.query(`insert into public.call_channels (group_id,guild_id,channel_id,status)
  values ($1::uuid,'guild-1',$2::text,'pending')`, [G, OTHER]);
const unapproved = await ingest({ channel: OTHER, hash: "b".repeat(64), msg: "222333444555666777" });
assert.equal(unapproved.ok, false, "a channel nobody approved cannot inject a call");
assert.equal((await counts()).raw, 1, "and nothing was journalled for it");
results.unapprovedChannelRefused = "PASS";

// ---- malformed input is refused at the boundary ----
const bad = [
  [{ channel: "not-a-snowflake" }, /invalid Discord event identifiers/i, "channel id shape"],
  [{ msg: "123" }, /invalid Discord event identifiers/i, "message id shape"],
  [{ eventType: "sneeze" }, /invalid event version/i, "unknown event type"],
  [{ eventVersion: "" }, /invalid event version/i, "missing event version"],
  [{ mint: "0OIl-not-base58", hash: "c".repeat(64), msg: "333444555666777888" }, /invalid mint/i, "non-base58 mint"],
  [{ confidence: 10001, hash: "d".repeat(64), msg: "444555666777888999" }, /invalid parser evidence/i, "confidence out of range"],
  [{ hash: "short", msg: "555666777888999000" }, /invalid parser evidence/i, "malformed content hash"]
];
for (const [opts, pattern, why] of bad) {
  await assert.rejects(() => ingest(opts), pattern, `must reject: ${why}`);
}
assert.equal((await counts()).raw, 1, "no malformed event created a journal row");
results.malformedInputRefused = "PASS";

// ---- authorization ----
await assert.rejects(() => ingest({ secret: "wrong" }), /unauthorized/i);
await assert.rejects(() => ingest({ secret: null }), /unauthorized/i,
  "a NULL secret must not slip through the `if not ...` guard");
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => ingest(), /permission denied/i, `${role} cannot inject a call`);
  await db.exec("reset role");
}
results.authorization = "PASS";

console.log(JSON.stringify({ engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${T.length} tables)`, schemaParity: "PASS",
  ...results,
  closes: "the last untested stage — the boundary where untrusted Discord input enters" }, null, 2));
await db.close();
