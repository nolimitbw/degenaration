/**
 * Stale-intent reconciliation: a dead worker must not freeze a user's funds.
 *
 * The fan-out trigger reserves capital when the worker claims a call and releases it when the
 * intent settles. Neither happens if the worker dies in between, and the reservation then
 * subtracts from withdrawable balance forever -- a balance that exists and cannot be used,
 * which is the funds incident reached by a different route.
 *
 * The property the control run targets: an intent carrying a transaction signature must NEVER
 * be auto-expired, because lamports may already have moved.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const fanout = await readFile(`${repo}/supabase/degenaration-trade-intent-fanout.sql`, "utf8");
const recon = await readFile(`${repo}/supabase/degenaration-intent-reconciliation.sql`, "utf8");
const wd = await readFile(`${repo}/supabase/degenaration-user-withdrawals.sql`, "utf8");
const stateRpc = wd.slice(wd.indexOf("create or replace function public.app_user_withdrawable_state("),
                          wd.indexOf("revoke execute on function public.app_user_withdrawable_state"));

const T = ["app_private.bot_config_versions", "app_private.app_users", "app_private.trade_intents",
  "public.subscriptions", "public.calls", "app_private.call_executions",
  "public.copy_subscriptions", "app_private.copy_executions"];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.admin_secret_ok(p text) returns boolean
  language sql stable security definer set search_path = ''
  as $x$ select p is not null and p = 'recon-secret' $x$;
  create function app_private.require_app_admin(p text) returns void
  language plpgsql set search_path = '' as $x$
  begin if p is distinct from 'admin-a' then raise exception 'forbidden' using errcode='42501'; end if; end $x$;
  create function app_private.ensure_app_user(p text) returns void
  language plpgsql security definer set search_path = '' as $x$
  begin insert into app_private.app_users (privy_user_id) values (trim(p))
        on conflict (privy_user_id) do nothing; end $x$;
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
await db.exec(fanout);
await db.exec(recon);
await db.exec(stateRpc);

const S = "recon-secret", U = "did:privy:alice";
const W = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const results = {};
await db.query("insert into app_private.app_users (privy_user_id) values ($1::text)", [U]);

const mk = async (key, state, ageMinutes) => {
  await db.query(`select app_private.open_trade_intent($1::text,$2::text,'M','buy','entry',
    'solana-mainnet',1000000000::bigint,null,$3::text,null,null,'{}'::jsonb)`, [U, key, W]);
  if (state !== "capital_reserved") {
    await db.query("update app_private.trade_intents set state=$2::text where idempotency_key=$1::text", [key, state]);
  }
  await db.query(
    `update app_private.trade_intents set updated_at = now() - make_interval(mins => $2::integer)
      where idempotency_key = $1::text`, [key, ageMinutes]);
};
const locked = async () => (await db.query(
  "select public.app_user_withdrawable_state($1::text,$2::text) as r", [S, U])).rows[0].r.lockedLamports;
const reconcile = async () => (await db.query(
  "select public.worker_reconcile_stale_intents($1::text,30::integer,60::integer) as r", [S])).rows[0].r;

// ---- a fresh reservation is untouched ----
await mk("fresh", "capital_reserved", 1);
assert.equal(await locked(), "1000000000");
let r = await reconcile();
assert.equal(r.expiredIntents, 0, "a fresh reservation is not expired");
assert.equal(await locked(), "1000000000", "and its capital stays locked");
results.freshReservationUntouched = "PASS";

// ---- an abandoned reservation is released ----
await mk("abandoned", "capital_reserved", 90);
assert.equal(await locked(), "2000000000");
r = await reconcile();
assert.equal(r.expiredIntents, 1, "the abandoned intent is expired");
assert.equal(await locked(), "1000000000",
  "THE FIX: a dead worker no longer freezes the user's SOL forever");
const st = (await db.query("select state, released_at from app_private.trade_intents where idempotency_key='abandoned'")).rows[0];
assert.equal(st.state, "expired");
assert.ok(st.released_at, "release went through the existing trigger, not a direct write");
results.abandonedReservationReleased = "PASS";

// ---- a SIGNED intent is never auto-expired ----
const sub = "bbbbbbbb-0000-0000-0000-000000000001";
const call = "cccccccc-0000-0000-0000-000000000001";
const grp = "aaaaaaaa-0000-0000-0000-000000000001";
await db.query(`insert into public.subscriptions (id,group_id,privy_user_id,user_pubkey,wallet_id,
  size_sol,daily_cap_sol,enabled) values ($1::uuid,$2::uuid,$3::text,$4::text,'pw',0.5,5,true)`,
  [sub, grp, U, W]);
await db.query("insert into public.calls (id,group_id,mint) values ($1::uuid,$2::uuid,'M')", [call, grp]);
const ex = (await db.query(`insert into app_private.call_executions
  (call_id,subscription_id,claim_token,status,amount_sol) values ($1::uuid,$2::uuid,gen_random_uuid(),
  'claimed',0.5::double precision) returning id,intent_id`, [call, sub])).rows[0];
await db.query("update app_private.call_executions set tx_signature='sig-x' where id=$1::uuid", [ex.id]);
// Two statements on purpose. release_intent_capital fires on `update of state` and sets
// updated_at := now(), so ageing the row in the same statement that changes state would have
// the trigger reset the clock -- which is correct production behaviour and a trap for tests.
await db.query("update app_private.trade_intents set state='submitted' where id=$1::uuid", [ex.intent_id]);
await db.query(`update app_private.trade_intents set updated_at = now() - interval '400 minutes'
  where id=$1::uuid`, [ex.intent_id]);

const before = await locked();
r = await reconcile();
assert.equal(r.expiredIntents, 0, "a signed intent is never auto-expired");
assert.equal(r.awaitingReconciliation, 1, "it is surfaced for the operator instead");
assert.equal(await locked(), before,
  "lamports may already have moved; releasing would let the user spend the same SOL twice");
results.signedIntentNeverAutoExpired = "PASS";

// ---- the crash window the signature guard actually exists for ----
//
// The worker submitted a transaction and died before updating state, so the intent is still
// capital_reserved -- inside the expiry state list -- but a signature exists. Only the
// signature check stands between this and releasing SOL the chain may already have taken.
const call2 = "cccccccc-0000-0000-0000-000000000002";
const sub2 = "bbbbbbbb-0000-0000-0000-000000000002";
const grp2 = "aaaaaaaa-0000-0000-0000-000000000002";
await db.query(`insert into public.subscriptions (id,group_id,privy_user_id,user_pubkey,wallet_id,
  size_sol,daily_cap_sol,enabled) values ($1::uuid,$2::uuid,$3::text,$4::text,'pw',0.25,5,true)`,
  [sub2, grp2, U, W]);
await db.query("insert into public.calls (id,group_id,mint) values ($1::uuid,$2::uuid,'M')", [call2, grp2]);
const ex2 = (await db.query(`insert into app_private.call_executions
  (call_id,subscription_id,claim_token,status,amount_sol) values ($1::uuid,$2::uuid,gen_random_uuid(),
  'claimed',0.25::double precision) returning id,intent_id`, [call2, sub2])).rows[0];
await db.query("update app_private.call_executions set tx_signature='sig-crash' where id=$1::uuid", [ex2.id]);
// Age it WITHOUT touching state, so it stays capital_reserved and inside the expiry window.
await db.query(`update app_private.trade_intents set updated_at = now() - interval '400 minutes'
  where id=$1::uuid`, [ex2.intent_id]);

const beforeCrash = await locked();
r = await reconcile();
assert.equal(
  (await db.query("select state from app_private.trade_intents where id=$1::uuid",
    [ex2.intent_id])).rows[0].state, "capital_reserved",
  "an intent inside the expiry state list but carrying a signature must survive — only the " +
  "signature check prevents releasing SOL the chain may already have taken"
);
assert.equal(await locked(), beforeCrash, "and its capital stays reserved");
results.crashWindowSignatureGuard = "PASS";

// ---- the operator can see what needs resolving ----
const stuck = (await db.query(
  "select public.admin_stuck_intents($1::text,'admin-a',100::integer) as r", [S])).rows[0].r;
assert.ok(stuck.stuckIntents.length >= 1);
const signed = stuck.stuckIntents.find((i) => i.txSignature === "sig-x");
assert.ok(signed, "the signed intent is listed with its signature so it can be checked on chain");
assert.ok(signed.correlationId && signed.walletAddress);
results.operatorCanResolve = "PASS";

// ---- authorization ----
await assert.rejects(() => db.query(
  "select public.worker_reconcile_stale_intents($1::text,30::integer,60::integer)", ["wrong"]), /unauthorized/i);
await assert.rejects(() => db.query(
  "select public.admin_stuck_intents($1::text,'not-admin',10::integer)", [S]), /forbidden/i);
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => reconcile(), /permission denied/i);
  await db.exec("reset role");
}
results.authorization = "PASS";

console.log(JSON.stringify({ engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${T.length} tables)`,
  schemaParity: "PASS", ...results }, null, 2));
await db.close();
