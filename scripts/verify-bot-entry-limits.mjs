/**
 * The builder's entry limits, proven to refuse a trade rather than merely to persist.
 *
 * WHAT THIS CLOSES. Maximum open trades, maximum capital, per-token exposure, the token
 * cooldown, first-call-only, the automatic-entry switch and the emergency stop were all
 * collected by BotBuilder, validated, versioned and reloaded — and read by nothing. There was
 * exactly one enforced limit in `worker_claim_call_execution`: the daily cap.
 *
 * A test of the save path cannot see that, because the save path is correct. So every property
 * below drives the REAL claim RPC against real PostgreSQL and asserts on what it did to the
 * queue — a refusal must be a refusal, and it must say which limit refused it.
 *
 * The control run at the end is what keeps this honest: it applies the PREVIOUS claim body over
 * the new one and asserts the exact same configuration is allowed straight through. Without it
 * a passing suite proves only that the limits are consistent with themselves.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
// Dependency order: renderTables emits these verbatim, and every foreign key below points
// backwards. subscriptions references bot_config_versions, calls references approved_groups,
// and call_executions references subscriptions.
const T = [
  "app_private.app_users",
  "app_private.bot_config_versions",
  "app_private.trading_wallets",
  "public.approved_groups",
  "public.subscriptions",
  "public.calls",
  "app_private.call_executions",
  "public.positions",
  "app_private.trade_intents",
  // The subscriber-config migration versions the copy path too, so both tables must exist.
  "public.copy_subscriptions",
  "app_private.copy_executions",
  "app_private.kol_subscriptions"
];
const results = {};
const sql = (file) => readFile(`${repo}/supabase/${file}`, "utf8");

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $x$ select null::uuid $x$;
  create table app_private.bot_profiles (id uuid primary key default gen_random_uuid());
  -- The role half of the real ensure_app_user needs app_private.user_roles, which is not part
  -- of this migration's surface. The app_users half is what open_trade_intent depends on.
  create function app_private.ensure_app_user(p_privy_user_id text)
  returns void language plpgsql security definer set search_path = ''
  as $x$
  begin
    insert into app_private.app_users (privy_user_id) values (trim(p_privy_user_id))
    on conflict (privy_user_id) do nothing;
  end $x$;
  -- automation-execution-integrity.sql also carries the limit-order queue, which is not part
  -- of this migration's surface. Present so that file parses; nothing below touches it.
  create table public.limit_orders (
    id uuid primary key default gen_random_uuid(),
    privy_user_id text, user_pubkey text, mint text, symbol text, trigger text,
    target_usd numeric, amount_sol numeric, slippage_bps integer,
    status text not null default 'open', claim_token uuid, claimed_at timestamptz,
    attempt_count integer default 0, last_error text, sig text, filled_at timestamptz,
    created_at timestamptz not null default now()
  );
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);

// The package this migration sits on, in the order production applied it. #1 is a hard
// prerequisite: the claim reads subscriptions.subscriber_config_snapshot, which #1 adds.
for (const file of [
  "automation-execution-integrity.sql",
  "degenaration-trade-intent-fanout.sql",
  "degenaration-subscriber-config-versioning.sql",
  "degenaration-bot-entry-limits.sql"
]) {
  await db.exec(await sql(file));
}
// Every deployment is a rerun after a rollback, so reapplying must be a no-op.
await db.exec(await sql("degenaration-bot-entry-limits.sql"));
results.rerunSafe = "PASS";

const one = async (text, params = []) => (await db.query(text, params)).rows[0];
const all = async (text, params = []) => (await db.query(text, params)).rows;

const GROUP = "11111111-1111-1111-1111-111111111111";
await db.query(
  "insert into public.approved_groups (id, discord_guild_id, name) values ($1::uuid,'g1','Source')",
  [GROUP]
);

const SOL = 1_000_000_000;

/**
 * The shape `app_private.subscriber_config_valid` demands of a versioned configuration, which
 * is what BotBuilder always sends. A payload missing any of it is refused rather than versioned
 * without the user's risk settings, so every test below layers its own limits on top of this.
 */
const BASE = {
  walletAddress: "PUBKEY",
  walletId: "WALLET",
  buyAmountLamports: SOL,
  maximumCapitalLamports: 100 * SOL,
  dailyLossLimitLamports: 100 * SOL,
  maxOpenTrades: 100,
  slippageBps: 300,
  priorityFeeMaxLamports: 500_000,
  takeProfit: { enabled: true, levels: [{ targetBps: 10000, sellBps: 5000 }] },
  stopLoss: { enabled: true, stopBps: 4000 },
  dca: { enabled: false, levels: [] },
  safetyFilters: { ranges: {}, flags: {}, unavailableDataBehavior: "fail-closed" }
};

/**
 * A subscription created the way the product creates one.
 *
 * The snapshot is NOT supplied: `version_discord_subscription` overwrites it on insert, and a
 * row is only treated as "versioned" when it carries a bot profile AND a non-empty
 * extended_config. Writing the snapshot directly produced a legacy-baseline row here and would
 * have proved nothing about the path production takes.
 *
 * `killSwitch` is deliberately not passed through extended_config either — the same trigger
 * stamps it from the `kill_switch` COLUMN, so the emergency stop stays flippable without
 * cutting a new configuration version.
 */
async function subscription(overrides, { sizeSol = 1, dailyCapSol = 100, killSwitch = false } = {}) {
  const config = { ...BASE, ...overrides };
  const profile = await one(
    "insert into app_private.bot_profiles default values returning id"
  );
  return one(
    `insert into public.subscriptions
       (group_id, privy_user_id, user_pubkey, wallet_id, size_sol, daily_cap_sol,
        enabled, status, kill_switch, bot_profile_id, extended_config)
     values ($1::uuid, 'did:privy:' || gen_random_uuid()::text, 'PUBKEY', 'WALLET',
             $2::numeric, $3::numeric, true, 'active', $4::boolean, $5::uuid, $6::jsonb)
     returning *`,
    [GROUP, sizeSol, dailyCapSol, killSwitch, profile.id, JSON.stringify(config)]
  );
}

let callSeq = 0;
async function call(mint = "MINT") {
  callSeq += 1;
  return one(
    `insert into public.calls (group_id, mint, message_id) values ($1::uuid, $2::text, $3::text) returning *`,
    [GROUP, mint, `msg-${callSeq}`]
  );
}

const claim = async (callId, subId) =>
  (await one("select public.worker_claim_call_execution($1::uuid,$2::uuid) as r", [callId, subId])).r;

/** Drive a claim all the way to an OPEN position, which is what "committed" means. */
async function fill(callId, subId, claimResult, { mint = "MINT", closed = false } = {}) {
  const sig = `sig-${callId}-${subId}`.slice(0, 60);
  await db.query(
    `update app_private.call_executions set status='succeeded', tx_signature=$3::text
      where call_id=$1::uuid and subscription_id=$2::uuid and claim_token=$4::uuid`,
    [callId, subId, sig, claimResult.claim_token]
  );
  await db.query(
    `insert into public.positions (user_pubkey, mint, entry_price_usd, amount_raw, entry_sig, status, group_id)
     values ('PUBKEY', $1::text, 1, 1000, $2::text, $3::text, $4::uuid)`,
    [mint, sig, closed ? "closed" : "open", GROUP]
  );
  return sig;
}

const skipped = (subId) => all(
  `select status, error, amount_lamports from app_private.call_executions
    where subscription_id=$1::uuid and status='skipped' order by created_at`,
  [subId]
);

// ── 1. maximum open trades ─────────────────────────────────────────────────────────────────
{
  const sub = await subscription({ buyAmountLamports: SOL, maxOpenTrades: 2 });
  const accepted = [];
  for (let i = 0; i < 3; i += 1) {
    const c = await call(`MINT-${i}`);
    const verdict = await claim(c.id, sub.id);
    accepted.push(verdict.ok);
    if (verdict.ok) await fill(c.id, sub.id, verdict, { mint: `MINT-${i}` });
  }
  assert.deepEqual(accepted, [true, true, false], "the third entry must be refused at a maximum of two");
  const rows = await skipped(sub.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, "maximum open trades reached", "the refusal must name the limit");
  results.maxOpenTrades = "PASS";

  // Closing one frees the slot. A cap that never releases is a cap that bricks the bot.
  await db.query("update public.positions set status='closed' where mint='MINT-0'");
  const c = await call("MINT-4");
  assert.equal((await claim(c.id, sub.id)).ok, true, "a closed position must free its slot");
  results.closedPositionFreesSlot = "PASS";
}

// ── 2. the in-flight race the cap exists to close ───────────────────────────────────────────
//
// The reason this is enforced in SQL rather than in the worker: a claim that has not yet
// opened a position is still an open trade in the making. Counting only positions would let a
// burst of calls all read zero and all claim.
{
  const sub = await subscription({ buyAmountLamports: SOL, maxOpenTrades: 2 });
  const verdicts = [];
  for (let i = 0; i < 3; i += 1) {
    const c = await call(`BURST-${i}`);
    verdicts.push((await claim(c.id, sub.id)).ok);
  }
  assert.deepEqual(verdicts, [true, true, false],
    "claims still in flight must count toward the maximum, or a burst overshoots it");
  results.inFlightCountsTowardMaximum = "PASS";
}

// ── 3. per-token exposure ───────────────────────────────────────────────────────────────────
{
  const sub = await subscription({
    buyAmountLamports: SOL,
    maxOpenTrades: 10,
    perTokenExposureLamports: 2 * SOL
  });
  const verdicts = [];
  for (let i = 0; i < 3; i += 1) {
    const c = await call("SAME");
    const verdict = await claim(c.id, sub.id);
    verdicts.push(verdict.ok);
    if (verdict.ok) await fill(c.id, sub.id, verdict, { mint: "SAME" });
  }
  assert.deepEqual(verdicts, [true, true, false], "a third buy would exceed two SOL in one token");
  assert.equal((await skipped(sub.id))[0].error, "per-token exposure limit reached");

  // A DIFFERENT token is unaffected — the limit is per token, not a second global cap.
  const other = await call("OTHER");
  assert.equal((await claim(other.id, sub.id)).ok, true, "another token must not be blocked by this one");
  results.perTokenExposure = "PASS";
}

// ── 4. maximum capital ──────────────────────────────────────────────────────────────────────
{
  const sub = await subscription({
    buyAmountLamports: SOL,
    maxOpenTrades: 10,
    maximumCapitalLamports: 3 * SOL
  });
  const verdicts = [];
  for (let i = 0; i < 4; i += 1) {
    const c = await call(`CAP-${i}`);
    const verdict = await claim(c.id, sub.id);
    verdicts.push(verdict.ok);
    if (verdict.ok) await fill(c.id, sub.id, verdict, { mint: `CAP-${i}` });
  }
  assert.deepEqual(verdicts, [true, true, true, false], "the fourth SOL exceeds a three-SOL ceiling");
  assert.equal((await skipped(sub.id))[0].error, "maximum capital reached");
  results.maximumCapital = "PASS";
}

// ── 5. the cooldown, and what may not extend it ─────────────────────────────────────────────
{
  const sub = await subscription({ buyAmountLamports: SOL, maxOpenTrades: 10, cooldownSeconds: 900 });
  const first = await call("COOL");
  assert.equal((await claim(first.id, sub.id)).ok, true);

  const second = await call("COOL");
  const refused = await claim(second.id, sub.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "token cooldown active");

  // A REFUSAL must not itself restart the cooldown. If it did, one refusal inside the window
  // would silence the token indefinitely, and the bot would look permanently broken.
  await db.query(
    `update app_private.call_executions set created_at = now() - interval '16 minutes'
      where subscription_id=$1::uuid and status <> 'skipped'`,
    [sub.id]
  );
  const third = await call("COOL");
  assert.equal((await claim(third.id, sub.id)).ok, true,
    "past the window the token must trade again — a skipped row cannot hold the cooldown open");
  results.cooldown = "PASS";
}

// ── 6. first call only ──────────────────────────────────────────────────────────────────────
{
  const sub = await subscription({ buyAmountLamports: SOL, maxOpenTrades: 10, firstCallOnly: true });
  const first = await call("ONCE");
  const opened = await claim(first.id, sub.id);
  assert.equal(opened.ok, true);
  await fill(first.id, sub.id, opened, { mint: "ONCE", closed: true });

  const again = await call("ONCE");
  const refused = await claim(again.id, sub.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "first call only: this token was already traded",
    "first-call-only outlives the position — a closed trade still counts as traded");
  results.firstCallOnly = "PASS";
}

// ── 7. the master switches ──────────────────────────────────────────────────────────────────
{
  const off = await subscription({ buyAmountLamports: SOL, autoEntry: false });
  const c1 = await call("OFF");
  const r1 = await claim(c1.id, off.id);
  assert.equal(r1.ok, false);
  assert.equal(r1.error, "automatic entries are off");

  const stopped = await subscription({ buyAmountLamports: SOL, autoEntry: true }, { killSwitch: true });
  const c2 = await call("STOP");
  const r2 = await claim(c2.id, stopped.id);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "emergency stop is on",
    "the emergency stop must outrank every other verdict, including auto-entry being on");
  results.masterSwitches = "PASS";
}

// ── 7b. the emergency stop toggle reaches the column, not just the config ───────────────────
//
// app_user_save_bot writes fourteen columns of public.subscriptions from the configuration and
// does NOT write kill_switch, while the versioning trigger builds the snapshot's `killSwitch`
// from that COLUMN and server/engine/store.js filters subscribers on it. Without the projection
// trigger the builder's switch would persist into extended_config and change nothing anywhere —
// the exact decorative-control defect this migration exists to close.
{
  const sub = await subscription({ buyAmountLamports: SOL });
  assert.equal(sub.kill_switch, false);

  await db.query(
    `update public.subscriptions
        set extended_config = extended_config || '{"killSwitch":true}'::jsonb
      where id = $1::uuid`,
    [sub.id]
  );
  const stopped = await one("select kill_switch, subscriber_config_snapshot from public.subscriptions where id=$1::uuid", [sub.id]);
  assert.equal(stopped.kill_switch, true, "the configuration switch must reach the column");
  assert.equal(stopped.subscriber_config_snapshot.killSwitch, true,
    "and the snapshot must carry it in the SAME save — trigger name order is what guarantees this");

  const c = await call("STOPPED");
  const refused = await claim(c.id, sub.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "emergency stop is on");

  // The refusal is RECORDED. Before this migration the config trigger raised on any insert for
  // a killed subscription, so an emergency stop erased its own audit trail.
  const rows = await skipped(sub.id);
  assert.equal(rows.length, 1, "the emergency stop must still be able to write its audit row");
  assert.equal(rows[0].error, "emergency stop is on");

  // An update that does not mention the switch must leave it alone rather than clearing it.
  // (A valid configuration, minus the killSwitch key — which is what an older client sends.)
  await db.query(
    "update public.subscriptions set extended_config = $2::jsonb where id = $1::uuid",
    [sub.id, JSON.stringify(BASE)]
  );
  const still = await one("select kill_switch from public.subscriptions where id=$1::uuid", [sub.id]);
  assert.equal(still.kill_switch, true, "an unrelated save must not silently lift the emergency stop");
  results.killSwitchReachesColumn = "PASS";
}

// ── 8. absent is not zero ───────────────────────────────────────────────────────────────────
//
// The failure mode this guards: reading an unset limit as 0 refuses every trade on every bot
// whose owner never opened that section. A legacy row carries a legacy-baseline snapshot and
// must trade on the daily cap alone.
{
  const bare = await subscription({ buyAmountLamports: SOL });
  const c1 = await call("BARE");
  assert.equal((await claim(c1.id, bare.id)).ok, true, "an unset maximum must not read as zero");

  // A subscription with no bot profile and no config version is what the trigger classifies as
  // legacy-baseline: it predates the builder, so it carries no limits at all.
  const legacy = await one(
    `insert into public.subscriptions
       (group_id, privy_user_id, user_pubkey, wallet_id, size_sol, daily_cap_sol, enabled, status,
        extended_config)
     values ($1::uuid, 'did:privy:legacy', 'PUBKEY', 'WALLET', 1, 100, true, 'active', '{}'::jsonb)
     returning *`,
    [GROUP]
  );
  assert.equal(legacy.subscriber_config_snapshot.compatibilityMode, "legacy-baseline",
    "fixture check: this row must actually be classified legacy, or the assertion below is vacuous");
  const c2 = await call("LEGACY");
  assert.equal((await claim(c2.id, legacy.id)).ok, true,
    "a legacy-baseline snapshot carries no limits and must not be read as all-zero");
  results.absentIsNotZero = "PASS";
}

// ── 9. the empty snapshot must not shadow a real configuration ──────────────────────────────
//
// subscriber_config_snapshot is NOT NULL DEFAULT '{}', and '{}' is truthy. A resolver that
// tested truthiness would read the default over a real extended_config and run a configured bot
// with NO limits — the same trap server/engine/store.js documents for safety filters.
//
// Reached by a row written BEFORE the versioning migration, which is why the trigger is disabled
// for this insert rather than the snapshot being forced: that is the exact state such a row was
// left in, and the column default is '{}'.
{
  await db.exec("alter table public.subscriptions disable trigger subscriptions_config_version_insert");
  const row = await one(
    `insert into public.subscriptions
       (group_id, privy_user_id, user_pubkey, wallet_id, size_sol, daily_cap_sol, enabled, status,
        extended_config)
     values ($1::uuid, 'did:privy:shadow', 'PUBKEY', 'WALLET', 1, 100, true, 'active', $2::jsonb)
     returning *`,
    [GROUP, JSON.stringify({ buyAmountLamports: SOL, maxOpenTrades: 1 })]
  );
  await db.exec("alter table public.subscriptions enable trigger subscriptions_config_version_insert");
  assert.deepEqual(row.subscriber_config_snapshot, {},
    "fixture check: the snapshot must really be the empty default, or this test means nothing");

  const resolved = (await one(
    "select app_private.subscription_entry_config($1::uuid) as c", [row.id]
  )).c;
  assert.equal(resolved.maxOpenTrades, 1,
    "the empty snapshot must fall through to extended_config rather than shadowing it");
  results.emptySnapshotDoesNotShadow = "PASS";

  // And independently: such a row cannot EXECUTE at all. The versioning migration's own guard
  // refuses to write a claimed execution with no configuration version, which is the correct
  // fail-closed direction — a trade must carry the immutable configuration it runs under.
  const c1 = await call("SHADOW-1");
  await assert.rejects(
    () => db.query("select public.worker_claim_call_execution($1::uuid,$2::uuid)", [c1.id, row.id]),
    /subscriber configuration unavailable/,
    "an unversioned subscription must not be able to open a live execution"
  );
  results.unversionedCannotExecute = "PASS";
}

// ── 10. money stays integral, and the intent reserves the same number ───────────────────────
//
// The cap comparison and the capital actually locked must come from ONE number. A float
// conversion of size_sol and the configuration's integer disagree on values a double cannot
// represent, and 1.001 SOL is one of them.
{
  const odd = 1_001_000_000;
  const sub = await subscription({ buyAmountLamports: odd, maxOpenTrades: 5 }, { sizeSol: 1.001 });
  const c = await call("ODD");
  const verdict = await claim(c.id, sub.id);
  assert.equal(verdict.ok, true);
  assert.equal(String(verdict.size_lamports), String(odd));

  const exec = await one(
    "select amount_lamports, intent_id from app_private.call_executions where call_id=$1::uuid",
    [c.id]
  );
  assert.equal(String(exec.amount_lamports), String(odd),
    "the queue row records the configuration's integer, not a converted double");
  assert.ok(exec.intent_id, "a claimed execution must still open a durable intent");

  const intent = await one(
    "select requested_input_base_units, reserved_lamports, subscriber_config_snapshot from app_private.trade_intents where id=$1::uuid",
    [exec.intent_id]
  );
  assert.equal(String(intent.reserved_lamports), String(odd),
    "the intent must reserve exactly what the caps were measured against");
  assert.equal(intent.subscriber_config_snapshot.maxOpenTrades, 5,
    "the intent records the configuration that authorised it");
  results.integerCapitalAndIntent = "PASS";
}

// ── 11. a refusal reserves nothing ──────────────────────────────────────────────────────────
//
// The whole apparatus is worthless if a refused claim still locks capital: the user's
// withdrawable balance would fall for a trade that never happened.
{
  const sub = await subscription({ buyAmountLamports: SOL, autoEntry: false });
  const c = await call("NORESERVE");
  await claim(c.id, sub.id);
  const row = await one(
    "select intent_id from app_private.call_executions where call_id=$1::uuid", [c.id]
  );
  assert.equal(row.intent_id, null, "a skipped execution must not open an intent");
  const locked = await one(
    `select coalesce(sum(reserved_lamports),0)::text as total from app_private.trade_intents
      where owner_privy_user_id = $1::text`,
    [sub.privy_user_id]
  );
  assert.equal(locked.total, "0", "a refused entry must leave no capital locked");
  results.refusalReservesNothing = "PASS";
}

// ── 12. the daily cap still works ───────────────────────────────────────────────────────────
{
  const sub = await subscription({ buyAmountLamports: SOL, maxOpenTrades: 50 }, { sizeSol: 1, dailyCapSol: 2 });
  const verdicts = [];
  for (let i = 0; i < 3; i += 1) {
    const c = await call(`DAILY-${i}`);
    verdicts.push((await claim(c.id, sub.id)).ok);
  }
  assert.deepEqual(verdicts, [true, true, false], "the pre-existing daily cap must survive the rewrite");
  assert.equal((await skipped(sub.id))[0].error, "daily cap reached");
  results.dailyCapPreserved = "PASS";
}

// ── CONTROL: the previous body allows everything this suite refuses ─────────────────────────
//
// Without this, the suite proves only that the new function agrees with itself. Reinstalling
// the shipped claim body over the new one and replaying the maximum-open-trades case must let
// the third entry straight through — which is precisely the production defect.
{
  await db.exec(await sql("automation-execution-integrity.sql"));
  const sub = await subscription({ buyAmountLamports: SOL, maxOpenTrades: 2 });
  const verdicts = [];
  for (let i = 0; i < 3; i += 1) {
    const c = await call(`CONTROL-${i}`);
    verdicts.push((await claim(c.id, sub.id)).ok);
  }
  assert.deepEqual(verdicts, [true, true, true],
    "CONTROL FAILED: the previous claim body should ignore maxOpenTrades entirely");
  results.controlRunReproducesDefect = "PASS";
  // Leave the fixture on the migration under test.
  await db.exec(await sql("degenaration-bot-entry-limits.sql"));
}

console.log(JSON.stringify({
  verifier: "bot-entry-limits",
  database: "PGlite (real PostgreSQL), schema rendered from the captured production shapes",
  migration: "supabase/degenaration-bot-entry-limits.sql",
  properties: Object.keys(results).length,
  ...results,
  enforcedControls: [
    "maxOpenTrades", "maximumCapitalLamports", "perTokenExposureLamports",
    "cooldownSeconds", "firstCallOnly", "autoEntry", "killSwitch"
  ],
  proves:
    "each limit refuses a real claim and names itself in the queue's audit row; an in-flight " +
    "claim counts toward the maximum, so a burst cannot overshoot it; a refusal reserves no " +
    "capital; an unset limit is not read as zero; and the previous body allows all of it",
  notProven: "that a deployed worker executes this path — E-3"
}, null, 2));

await db.close();
