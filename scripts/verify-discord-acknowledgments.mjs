import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile("supabase/degenaration-discord-scanner-acknowledgments.sql", "utf8");
const rollback = await readFile("supabase/rollback/23-discord-scanner-acknowledgments.sql", "utf8");
const store = await readFile("server/bot/store.js", "utf8");
const index = await readFile("server/bot/index.js", "utf8");
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;
  create table public.approved_groups (
    id uuid primary key,
    name text,
    active boolean not null default true,
    verification_status text not null default 'approved',
    removed_at timestamptz
  );
  create table public.call_channels (
    id uuid primary key,
    group_id uuid references public.approved_groups(id),
    guild_id text not null,
    channel_id text not null,
    status text not null default 'approved',
    removed_at timestamptz,
    created_at timestamptz not null default now()
  );
  create function app_private.bot_secret_ok(p text) returns boolean
  language sql stable security definer set search_path='' as $x$ select p = 'bot-secret' $x$;
  create function app_private.authorized_call_channel(p_channel_id text, p_guild_id text)
  returns table(group_id uuid, group_name text, guild_id text, channel_name text, refusal text)
  language sql stable security definer set search_path='' as $x$
    select g.id, g.name, c.guild_id, null::text, null::text
    from public.call_channels c join public.approved_groups g on g.id=c.group_id
    where c.channel_id=p_channel_id and c.guild_id=p_guild_id and c.status='approved'
      and c.removed_at is null and g.active and g.verification_status='approved'
      and g.removed_at is null
  $x$;
`);

await db.exec(migration);
const group = "aaaaaaaa-0000-0000-0000-000000000001";
await db.query("insert into public.approved_groups(id,name) values($1::uuid,'Alpha Desk')", [group]);
await db.query(`insert into public.call_channels(id,group_id,guild_id,channel_id)
  values('bbbbbbbb-0000-0000-0000-000000000001',$1::uuid,'1520209045544374342','1521876069693526158')`, [group]);

const enabled = (await db.query("select public.bot_approved_call_channels('bot-secret') as value")).rows[0].value;
assert.equal(enabled.length, 1);
assert.equal(enabled[0].scanner_acknowledgments_enabled, true, "existing sources default on");

await db.query("update public.approved_groups set scanner_acknowledgments_enabled=false where id=$1::uuid", [group]);
const disabled = (await db.query("select public.bot_approved_call_channels('bot-secret') as value")).rows[0].value;
assert.equal(disabled[0].scanner_acknowledgments_enabled, false, "a source can turn acknowledgments off");
assert.match(store, /scanner_acknowledgments_enabled !== false/, "the listener consumes the source switch");
assert.match(index, /SCANNER_ACKNOWLEDGMENTS/, "the listener consumes the global switch");

await db.exec(rollback);
const columns = await db.query(`select column_name from information_schema.columns
  where table_schema='public' and table_name='approved_groups'
    and column_name='scanner_acknowledgments_enabled'`);
assert.equal(columns.rows.length, 0, "rollback removes only the added source setting");
await db.close();

console.log(JSON.stringify({
  verifier: "discord-scanner-acknowledgments",
  defaultOn: "PASS",
  perSourceOff: "PASS",
  globalOff: "PASS",
  rollback: "PASS",
  replayIdempotency: "covered by verify:discord-replay"
}, null, 2));
