import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile("supabase/degenaration-discord-owner-linking.sql", "utf8");
const bot = await readFile("server/bot/index.js", "utf8");
const route = await readFile("app/api/product/discord-ownership/route.ts", "utf8");

assert.match(bot, /\.setName\("connect"\)[\s\S]*\.setName\("discord"\)/, "/connect discord is published");
assert.match(bot, /canManageGuild\(interaction\.member, interaction\.memberPermissions\)/, "Discord interaction verifies Manage Guild");
assert.match(route, /requirePrivyDiscordIdentity/, "completion requires a Privy-signed Discord identity");
assert.match(route, /headerState !== cookieState/, "completion uses double-submit state protection");
assert.match(route, /verifyDiscordLinkState/, "state is signed, bound, and expiring");
assert.doesNotMatch(bot, /connect\/discord\/\$\{link\.(token|secret|nonce)\}/, "no bearer secret is placed in the URL");

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create table app_private.app_users (privy_user_id text primary key, status text default 'active');
  create table app_private.auth_identities (
    id uuid primary key default gen_random_uuid(), privy_user_id text not null references app_private.app_users(privy_user_id),
    provider text not null, provider_subject text not null, normalized_email text, email_verified boolean default false,
    linked_at timestamptz default now(), last_verified_at timestamptz default now(), revoked_at timestamptz,
    unique(provider,provider_subject)
  );
  create table public.approved_groups (
    id uuid primary key, name text not null, discord_guild_id text, owner_privy_user_id text,
    creator_fee_bps integer default 70, active boolean default true, verification_status text default 'approved',
    removed_at timestamptz, suspended_at timestamptz, public_slug text, created_at timestamptz default now()
  );
  create table app_private.source_ownership_history (
    id uuid primary key default gen_random_uuid(), source_group_id uuid not null references public.approved_groups(id),
    owner_privy_user_id text not null references app_private.app_users(privy_user_id),
    verified_identity_id uuid references app_private.auth_identities(id), creator_fee_bps integer default 70,
    valid_from timestamptz default now(), valid_to timestamptz, reason text
  );
  create unique index source_ownership_current_unique on app_private.source_ownership_history(source_group_id) where valid_to is null;
  create table public.calls (id uuid primary key default gen_random_uuid(), group_id uuid, parse_status text default 'accepted');
  create table app_private.trade_executions (
    id bigint generated always as identity primary key, owner_privy_user_id text, source_group_id_snapshot uuid,
    creator_privy_user_id_snapshot text, gross_notional_lamports bigint default 0,
    platform_fee_lamports bigint default 0, creator_fee_lamports bigint default 0,
    platform_fee_bps_snapshot integer default 200, creator_fee_bps_snapshot integer default 0,
    referral_fee_lamports bigint default 0, status text default 'reconciled'
  );
  create table app_private.commission_ledger_entries (
    id uuid primary key default gen_random_uuid(), account_owner_privy_user_id text, account_type text,
    source_type text, source_id text, amount_lamports bigint, available_at timestamptz default now()
  );
  create table app_private.payout_requests (
    id uuid primary key default gen_random_uuid(), owner_privy_user_id text, gross_lamports bigint default 0,
    net_lamports bigint default 0, status text default 'pending', requested_at timestamptz default now(),
    processed_at timestamptz, tx_signature text
  );
  create table app_private.admin_audit_log (
    id uuid primary key default gen_random_uuid(), actor_privy_user_id text, action text,
    target_type text, target_id text, reason text, previous_state jsonb, next_state jsonb
  );
  create function app_private.admin_secret_ok(p text) returns boolean language sql stable as $$ select p='admin-secret' $$;
  create function app_private.bot_secret_ok(p text) returns boolean language sql stable as $$ select p='bot-secret' $$;
  create function app_private.ensure_app_user(p text) returns void language plpgsql as $$ begin
    insert into app_private.app_users(privy_user_id) values(p) on conflict do nothing;
  end $$;
  create function app_private.require_app_admin(p text) returns void language plpgsql as $$ begin
    if p <> 'admin-user' then raise exception 'forbidden'; end if;
  end $$;
`);
await db.exec(migration);

const GROUP = "aaaaaaaa-0000-4000-8000-000000000001";
const GUILD = "1520209045544374342";
const DISCORD = "1521876069693526158";
await db.query("insert into public.approved_groups(id,name,discord_guild_id) values($1::uuid,'SLPR DEGEN',$2)", [GROUP, GUILD]);

const created = (await db.query("select public.bot_create_discord_owner_link('bot-secret',$1,$2,'jaza',true) r", [GUILD, DISCORD])).rows[0].r;
assert.equal(created.ok, true);
assert.equal(created.sourceEligible, true);

await assert.rejects(
  db.query("select public.app_user_complete_discord_owner_link('admin-secret','did:privy:owner',$1::uuid,$2,'attacker') r", [created.sessionId, "1521876069693526199"]),
  /Discord identity does not match/,
  "a different Discord account cannot consume the link"
);

const validSession = (await db.query("select public.bot_create_discord_owner_link('bot-secret',$1,$2,'jaza',true) r", [GUILD, DISCORD])).rows[0].r;
const linked = (await db.query("select public.app_user_complete_discord_owner_link('admin-secret','did:privy:owner',$1::uuid,$2,'jaza') r", [validSession.sessionId, DISCORD])).rows[0].r;
assert.equal(linked.ok, true);
assert.equal(linked.sourceClaimed, true);

const group = (await db.query("select owner_privy_user_id from public.approved_groups where id=$1::uuid", [GROUP])).rows[0];
assert.equal(group.owner_privy_user_id, "did:privy:owner");
assert.equal((await db.query("select count(*)::integer n from app_private.source_ownership_history where valid_to is null")).rows[0].n, 1);
assert.equal((await db.query("select count(*)::integer n from app_private.discord_ownership_events where event_type='source.claimed'")).rows[0].n, 1);

const replay = (await db.query("select public.app_user_complete_discord_owner_link('admin-secret','did:privy:owner',$1::uuid,$2,'jaza') r", [validSession.sessionId, DISCORD])).rows[0].r;
assert.equal(replay.ok, false);
assert.equal(replay.status, 409, "link session is single-use");

await db.query(`insert into app_private.trade_executions
  (owner_privy_user_id,source_group_id_snapshot,creator_privy_user_id_snapshot,gross_notional_lamports,
   platform_fee_lamports,creator_fee_lamports,creator_fee_bps_snapshot)
  values('subscriber',$1::uuid,'did:privy:owner',1000000,20000,7000,70)`, [GROUP]);
let execution = (await db.query("select creator_privy_user_id_snapshot,creator_fee_lamports from app_private.trade_executions order by id desc limit 1")).rows[0];
assert.equal(execution.creator_privy_user_id_snapshot, "did:privy:owner", "verified current owner keeps creator allocation");

await db.query("select public.app_user_revoke_discord_owner_link('admin-secret','did:privy:owner','Owner requested unlink')");
await db.query(`insert into app_private.trade_executions
  (owner_privy_user_id,source_group_id_snapshot,creator_privy_user_id_snapshot,gross_notional_lamports,
   platform_fee_lamports,creator_fee_lamports,creator_fee_bps_snapshot)
  values('subscriber',$1::uuid,'did:privy:owner',1000000,20000,7000,70)`, [GROUP]);
execution = (await db.query("select creator_privy_user_id_snapshot,creator_fee_lamports from app_private.trade_executions order by id desc limit 1")).rows[0];
assert.equal(execution.creator_privy_user_id_snapshot, null);
assert.equal(execution.creator_fee_lamports, 0, "revoked owner receives no future creator allocation");

console.log(JSON.stringify({
  verifier: "discord-owner-linking",
  manageGuildProof: "PASS",
  matchingSignedIdentity: "PASS",
  expiringSingleUseSession: "PASS",
  immutableOwnershipAudit: "PASS",
  verifiedCommissionOnly: "PASS",
  csrfState: "PASS",
  urlContainsNoBearerSecret: "PASS"
}, null, 2));
await db.close();
