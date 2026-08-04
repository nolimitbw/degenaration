/**
 * Signal fan-out: a parsed call must reach the bots following its source.
 *
 * Spec section 7. A writer/reader inventory found signal_deliveries with ZERO writers, so the
 * ingestion chain stopped one step before subscribers: raw and parsed rows were written, and
 * no bot was ever offered a call. That is not blocked on the Discord bot being deployed --
 * it is a missing writer, the same class as the settlement writer.
 *
 * The property the control run targets: one offer per signal per bot, forever.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const sql = await readFile(`${repo}/supabase/degenaration-signal-fanout.sql`, "utf8");
const T = ["app_private.bot_config_versions", "public.approved_groups", "public.call_channels"];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
await db.exec(`
  create table app_private.raw_signals (
    id uuid primary key default gen_random_uuid(),
    source_type text not null, source_ref text not null,
    content_hash text not null, received_at timestamptz not null default now());
  create table app_private.parsed_signals (
    id uuid primary key default gen_random_uuid(),
    raw_signal_id uuid not null references app_private.raw_signals(id),
    parser_version text not null, status text not null, mint text,
    confidence_bps integer, rejection_reason text,
    normalized_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now());
  create table app_private.bot_profiles (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null, kind text not null,
    source_group_id uuid, status text not null default 'active');
  create table app_private.signal_deliveries (
    id uuid primary key default gen_random_uuid(),
    parsed_signal_id uuid not null references app_private.parsed_signals(id),
    bot_id uuid not null, config_version_id uuid not null,
    idempotency_key text not null unique, status text not null,
    evaluation jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), finished_at timestamptz);
`);
await db.exec(sql);

const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";
const CH = "chan-1";
const MINT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const results = {};

await db.query("insert into public.approved_groups (id, name) values ($1::uuid,'Src')", [GROUP]);
await db.query(`insert into public.call_channels (group_id, guild_id, channel_id, status)
  values ($1::uuid,'guild-1',$2::text,'approved')`, [GROUP, CH]);

const mkBot = async (owner, withVersion = true, status = "active") => {
  const b = (await db.query(`insert into app_private.bot_profiles
    (owner_privy_user_id, kind, source_group_id, status) values ($1::text,'discord',$2::uuid,$3::text)
    returning id`, [owner, GROUP, status])).rows[0].id;
  if (withVersion) {
    await db.query(`insert into app_private.bot_config_versions (bot_id, version, config, created_by)
      values ($1::uuid, 1, '{}'::jsonb, $2::text)`, [b, owner]);
  }
  return b;
};
const parse = async (status = "accepted", mint = MINT) => {
  const raw = (await db.query(`insert into app_private.raw_signals (source_type, source_ref, content_hash)
    values ('discord',$1::text, md5(random()::text)) returning id`, [CH])).rows[0].id;
  return (await db.query(`insert into app_private.parsed_signals
    (raw_signal_id, parser_version, status, mint, confidence_bps)
    values ($1::uuid,'v1',$2::text,$3::text,9000) returning id`, [raw, status, mint])).rows[0].id;
};
const deliveries = async (pid) => (await db.query(
  "select * from app_private.signal_deliveries where parsed_signal_id=$1::uuid", [pid])).rows;

// ---- an accepted signal reaches every live bot following the source ----
const b1 = await mkBot("did:privy:a");
const b2 = await mkBot("did:privy:b");
const p1 = await parse();
const d1 = await deliveries(p1);
assert.equal(d1.length, 2, "THE FIX: both subscribed bots are offered the call");
assert.ok(d1.every((d) => d.status === "pending"));
assert.ok(d1.every((d) => d.config_version_id), "the config version in force is captured per delivery");
assert.equal(d1[0].evaluation.mint, MINT);
results.acceptedSignalReachesSubscribers = "PASS";

// ---- one offer per signal per bot, forever ----
await db.query("select app_private.fan_out_parsed_signal($1::uuid)", [p1]);
await db.query("select app_private.fan_out_parsed_signal($1::uuid)", [p1]);
assert.equal((await deliveries(p1)).length, 2, "replayed ingestion offers the same call once");
results.oneOfferPerSignalPerBot = "PASS";

// ---- a rejected parse is not fanned out ----
const p2 = await parse("rejected", null);
assert.equal((await deliveries(p2)).length, 0,
  "a rejected parse is explained on parsed_signals; duplicating it per bot is noise, not journal");
results.rejectedParseNotDelivered = "PASS";

// ---- an archived bot is not offered calls ----
await mkBot("did:privy:c", true, "archived");
const p3 = await parse();
assert.equal((await deliveries(p3)).length, 2, "the archived bot is skipped");
results.archivedBotSkipped = "PASS";

// ---- a bot with no config version is counted, not silently dropped ----
await mkBot("did:privy:d", false);
const p4 = await parse();
// The trigger already fanned this out on insert, so a manual re-call returns delivered 0 by
// design -- idempotency working. Assert on the rows for delivery, and on the re-call for the
// skip count, which is recomputed each time.
assert.equal((await deliveries(p4)).length, 2, "both configured bots were offered the call");
const r4 = (await db.query("select app_private.fan_out_parsed_signal($1::uuid) as r", [p4])).rows[0].r;
assert.equal(r4.delivered, 0, "the re-call adds nothing — one offer per signal per bot");
assert.equal(r4.skipped, 1, "a bot with nothing to execute under is reported, not hidden");
results.botWithoutConfigCounted = "PASS";

// ---- an unapproved channel delivers nothing ----
await db.query("update public.call_channels set status='pending' where channel_id=$1::text", [CH]);
const p5 = await parse();
assert.equal((await deliveries(p5)).length, 0, "no delivery was created at all");
const r5 = (await db.query("select app_private.fan_out_parsed_signal($1::uuid) as r", [p5])).rows[0].r;
assert.equal(r5.delivered, 0);
assert.match(r5.reason, /no approved channel/i, "an unapproved source cannot reach subscribers");
results.unapprovedChannelDeliversNothing = "PASS";

console.log(JSON.stringify({ engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${T.length} tables)`,
  schemaParity: "PASS", ...results,
  note: "closes the gap between parsed_signals and trade intents; ingestion itself still needs the bot deployed (E-2)"
}, null, 2));
await db.close();
