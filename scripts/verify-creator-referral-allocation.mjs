/**
 * Creator and referral allocation, resolved at settlement.
 *
 * Spec 13.2 and 13.3. The allocation layer (validate_execution_fees,
 * accrue_commission_for_execution, the generated retained column) was already correct and
 * already tested. What was missing is upstream of it: settlement wrote a literal 0 into the
 * creator and referral columns and never wrote either identity, so with the fee switched on
 * the ledger would have shown 200 bps of platform revenue and nothing else, forever, without
 * erroring anywhere.
 *
 * This drives the whole chain with real PostgreSQL: queue row -> intent -> settlement ->
 * execution row -> accrual trigger -> four balanced ledger entries.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();

const FIXTURE_TABLES = [
  "app_private.app_users",
  "app_private.bot_config_versions",
  "app_private.trade_intents",
  "public.approved_groups",
  "public.subscriptions",
  "public.calls",
  "app_private.call_executions",
  "public.copy_subscriptions",
  "app_private.copy_executions",
  "app_private.trade_executions",
  "app_private.commission_ledger_entries"
];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.ensure_app_user(p text) returns void
  language plpgsql security definer set search_path = '' as $x$
  begin insert into app_private.app_users (privy_user_id) values (trim(p))
        on conflict (privy_user_id) do nothing; end $x$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);

// Tables settlement now reads, in their migration-source shape.
await db.exec(`
  create table app_private.system_flags (
    flag_key text primary key,
    value jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );
  create table app_private.kol_strategies (
    id uuid primary key default gen_random_uuid(),
    bot_id uuid,
    owner_privy_user_id text not null references app_private.app_users(privy_user_id),
    slug text not null unique,
    moderation_status text not null default 'approved',
    creator_fee_bps integer not null default 20 check (creator_fee_bps between 0 and 1000),
    created_at timestamptz not null default now()
  );
  create table app_private.referral_links (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null references app_private.app_users(privy_user_id),
    code text not null unique,
    subject_type text not null, subject_id text not null,
    active boolean not null default true
  );
  create table app_private.referral_attributions (
    id uuid primary key default gen_random_uuid(),
    referral_link_id uuid not null references app_private.referral_links(id),
    referrer_privy_user_id text not null references app_private.app_users(privy_user_id),
    referred_privy_user_id text not null references app_private.app_users(privy_user_id) unique,
    visitor_hash text not null, capture_nonce text not null unique,
    captured_at timestamptz not null,
    attributed_at timestamptz not null default now(),
    attribution_expires_at timestamptz not null,
    status text not null default 'verified',
    status_reason text not null,
    check (referrer_privy_user_id <> referred_privy_user_id)
  );
  create table app_private.positions (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null, bot_id uuid, config_version_id uuid,
    mint text not null, status text not null,
    quantity_base_units numeric not null, cost_lamports bigint not null,
    realized_pnl_lamports bigint not null default 0, fees_lamports bigint not null default 0,
    entry_config_snapshot jsonb not null default '{}'::jsonb,
    opened_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    closed_at timestamptz
  );
  create table app_private.position_lots (
    id uuid primary key default gen_random_uuid(),
    position_id uuid not null references app_private.positions(id),
    entry_execution_id uuid not null,
    quantity_base_units numeric not null, remaining_base_units numeric not null,
    cost_lamports bigint not null, created_at timestamptz not null default now()
  );
`);

for (const file of [
  "degenaration-fee-allocation-integrity.sql",
  "degenaration-commission-allocation-balance.sql",
  "degenaration-trade-intent-fanout.sql",
  "degenaration-settlement-writer.sql",
  "degenaration-execution-record-fields.sql",
  "degenaration-exit-settlement.sql",
  "degenaration-creator-referral-allocation.sql"
]) {
  await db.exec(await readFile(`${repo}/supabase/${file}`, "utf8"));
}

const results = {};
const TRADER = "did:privy:trader";
const DISCORD_CREATOR = "did:privy:discord-creator";
const KOL_CREATOR = "did:privy:kol-creator";
const REFERRER = "did:privy:referrer";
const MINT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const GROUP = "aaaaaaaa-0000-0000-0000-000000000001";
const SELF_GROUP = "aaaaaaaa-0000-0000-0000-000000000002";
const SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const SELF_SUB = "bbbbbbbb-0000-0000-0000-000000000002";
const STRATEGY = "dddddddd-0000-0000-0000-000000000001";
const WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

for (const user of [TRADER, DISCORD_CREATOR, KOL_CREATOR, REFERRER]) {
  await db.query("insert into app_private.app_users (privy_user_id) values ($1::text)", [user]);
}
await db.query(
  `insert into public.approved_groups (id, name, owner_privy_user_id, creator_fee_bps)
   values ($1::uuid,'Alpha Calls',$2::text,70), ($3::uuid,'Own Server',$4::text,70)`,
  [GROUP, DISCORD_CREATOR, SELF_GROUP, TRADER]);
await db.query(
  `insert into public.subscriptions (id, group_id, privy_user_id, user_pubkey, wallet_id,
     size_sol, daily_cap_sol, enabled)
   values ($1::uuid,$2::uuid,$3::text,$4::text,'pw-1',1::numeric,50::numeric,true),
          ($5::uuid,$6::uuid,$3::text,$4::text,'pw-1',1::numeric,50::numeric,true)`,
  [SUB, GROUP, TRADER, WALLET, SELF_SUB, SELF_GROUP]);
await db.query(
  `insert into app_private.kol_strategies (id, owner_privy_user_id, slug)
   values ($1::uuid,$2::text,'momentum-scalps')`, [STRATEGY, KOL_CREATOR]);

let seq = 0;
const nextCall = async () => {
  seq += 1;
  const id = `cccccccc-0000-0000-0000-${String(seq).padStart(12, "0")}`;
  await db.query("insert into public.calls (id, group_id, mint) values ($1::uuid,$2::uuid,$3::text)",
    [id, GROUP, MINT]);
  return id;
};

/** A confirmed Discord buy of `sol` through `subscription`. */
async function discordBuy(sol, subscription = SUB) {
  const call = await nextCall();
  const row = await db.query(
    `insert into app_private.call_executions (call_id, subscription_id, claim_token, status, amount_sol)
     values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',$3::double precision)
     returning id, intent_id`, [call, subscription, sol]).then(r => r.rows[0]);
  await db.query(
    `update app_private.call_executions set status='succeeded', tx_signature=$2::text
     where id=$1::uuid`, [row.id, `sig-${seq}`]);
  return (await db.query("select * from app_private.trade_executions where intent_id=$1::uuid",
    [row.intent_id])).rows[0];
}

/** A confirmed KOL buy of `lamports`. */
async function kolBuy(lamports) {
  const call = await nextCall();
  const intent = await db.query(
    `select * from app_private.open_trade_intent(
       $1::text, $2::text, $3::text, 'buy', 'entry', 'solana-mainnet',
       $4::bigint, null, $5::text, null, $6::uuid, '{}'::jsonb)`,
    [TRADER, `kol:${seq}`, MINT, String(lamports), WALLET, STRATEGY]).then(r => r.rows[0]);
  const row = await db.query(
    `insert into app_private.call_executions
       (call_id, subscription_id, claim_token, status, amount_sol, intent_id)
     values ($1::uuid,$2::uuid,gen_random_uuid(),'claimed',0::double precision,$3::uuid)
     returning id`, [call, SUB, intent.id]).then(r => r.rows[0]);
  await db.query(
    `update app_private.call_executions set status='succeeded', tx_signature=$2::text
     where id=$1::uuid`, [row.id, `sig-${seq}`]);
  return (await db.query("select * from app_private.trade_executions where intent_id=$1::uuid",
    [intent.id])).rows[0];
}

const entriesFor = async (executionId) => (await db.query(
  "select * from app_private.commission_ledger_entries where execution_id=$1::uuid",
  [executionId])).rows;

// ---- today's truth: no fee account, so nothing is allocated ---------------------------
const unfunded = await discordBuy(1);
assert.equal(String(unfunded.platform_fee_lamports), "0");
assert.equal(String(unfunded.creator_fee_lamports), "0",
  "commission is funded FROM the fee, so a zero fee pays no creator");
assert.equal(unfunded.creator_privy_user_id_snapshot, null);
assert.equal(String(unfunded.referral_fee_lamports), "0");
assert.equal((await entriesFor(unfunded.id)).length, 0, "and writes no ledger entry at all");
results.zeroFeeAllocatesNothing = "PASS";

// ---- switch the platform fee on --------------------------------------------------------
await db.query(
  `insert into app_private.system_flags (flag_key, value)
   values ('platform_fee', '{"platformFeeBps": 200}'::jsonb)`);

// ---- a Discord trade with a referred trader --------------------------------------------
await db.query(
  `insert into app_private.referral_links (id, owner_privy_user_id, code, subject_type, subject_id)
   values ('eeeeeeee-0000-0000-0000-000000000001'::uuid, $1::text, 'refcode1', 'profile', $1::text)`,
  [REFERRER]);
await db.query(
  `insert into app_private.referral_attributions
     (referral_link_id, referrer_privy_user_id, referred_privy_user_id, visitor_hash,
      capture_nonce, captured_at, attribution_expires_at, status, status_reason)
   values ('eeeeeeee-0000-0000-0000-000000000001'::uuid, $1::text, $2::text,
           repeat('a',64), repeat('b',36), now() - interval '1 day',
           now() + interval '30 days', 'verified', 'verified signup')`,
  [REFERRER, TRADER]);

const funded = await discordBuy(1);
assert.equal(String(funded.gross_notional_lamports), "1000000000");
assert.equal(String(funded.platform_fee_lamports), "20000000", "200 bps of 1 SOL");
assert.equal(funded.platform_fee_bps_snapshot, 200);
assert.equal(String(funded.creator_fee_lamports), "7000000", "70 bps to the Discord creator");
assert.equal(funded.creator_fee_bps_snapshot, 70);
assert.equal(funded.creator_privy_user_id_snapshot, DISCORD_CREATOR);
assert.equal(String(funded.referral_fee_lamports), "2000000", "10% OF THE FEE, not of notional");
assert.equal(funded.referral_share_bps_snapshot, 1000);
assert.equal(funded.referrer_privy_user_id_snapshot, REFERRER);
assert.equal(String(funded.retained_fee_lamports), "11000000", "130 bps less the referral reward");
results.discordAllocation = "PASS";

// The user pays one flat rate; who gets paid out of it never changes what they were charged.
assert.equal(
  BigInt(funded.creator_fee_lamports) + BigInt(funded.referral_fee_lamports) +
  BigInt(funded.retained_fee_lamports),
  BigInt(funded.platform_fee_lamports),
  "creator + referral + retained === collected fee");
results.allocationBalances = "PASS";

const fundedEntries = await entriesFor(funded.id);
const byType = (type) => fundedEntries.filter(r => r.account_type === type)
  .reduce((n, r) => n + BigInt(r.amount_lamports), 0n);
assert.equal(byType("creator"), 7000000n);
assert.equal(byType("referral"), 2000000n);
assert.equal(byType("platform"), 11000000n,
  "platform nets to retained revenue, not to the gross fee it also credited");
assert.equal(byType("creator") + byType("referral") + byType("platform"), 20000000n,
  "the ledger credits exactly the fee that was collected");
assert.equal(
  fundedEntries.find(r => r.account_type === "creator").account_owner_privy_user_id,
  DISCORD_CREATOR);
assert.equal(
  fundedEntries.find(r => r.account_type === "referral").account_owner_privy_user_id,
  REFERRER);
results.ledgerEntriesBalance = "PASS";

// ---- a KOL trade pays 20 bps and records the strategy ----------------------------------
const kol = await kolBuy(1000000000);
assert.equal(String(kol.creator_fee_lamports), "2000000", "20 bps to the KOL creator");
assert.equal(kol.creator_fee_bps_snapshot, 20);
assert.equal(kol.creator_privy_user_id_snapshot, KOL_CREATOR);
assert.equal(kol.strategy_id_snapshot, STRATEGY,
  "the strategy is snapshotted — settlement never wrote this column before");
assert.equal(kol.source_group_id_snapshot, null, "an execution has one creator source, not two");
assert.equal(String(kol.retained_fee_lamports), "16000000", "180 bps less the referral reward");
results.kolAllocation = "PASS";

// ---- a creator copying their own source is not paid ------------------------------------
const own = await discordBuy(1, SELF_SUB);
assert.equal(String(own.creator_fee_lamports), "0",
  "no creator reward on the creator's own copy activity");
assert.equal(own.creator_privy_user_id_snapshot, null);
assert.equal(String(own.platform_fee_lamports), "20000000", "the platform fee is still charged");
assert.equal(String(own.retained_fee_lamports), "18000000",
  "the unpaid creator share stays with the platform rather than discounting the user");
results.selfSourcePaysNoCreator = "PASS";

// ---- an expired attribution earns nothing ----------------------------------------------
await db.query(
  "update app_private.referral_attributions set attribution_expires_at = now() - interval '1 day'");
const expired = await discordBuy(1);
assert.equal(String(expired.referral_fee_lamports), "0");
assert.equal(expired.referrer_privy_user_id_snapshot, null,
  "an expired attribution is not a referrer");
assert.equal(String(expired.creator_fee_lamports), "7000000", "the creator is unaffected");
results.expiredAttributionEarnsNothing = "PASS";

await db.query(
  "update app_private.referral_attributions set attribution_expires_at = now() + interval '30 days'");

// ---- a rate change never rewrites a historical trade ------------------------------------
await db.query("update public.approved_groups set creator_fee_bps = 150 where id=$1::uuid", [GROUP]);
const reread = (await db.query("select * from app_private.trade_executions where id=$1::uuid",
  [funded.id])).rows[0];
assert.equal(reread.creator_fee_bps_snapshot, 70, "the historical snapshot is untouched");
const afterChange = await discordBuy(1);
assert.equal(afterChange.creator_fee_bps_snapshot, 150, "the new rate applies going forward");
assert.equal(String(afterChange.creator_fee_lamports), "15000000");
assert.equal(String(afterChange.referral_fee_lamports), "2000000",
  "the referral reward still fits inside what is left of the fee");
assert.equal(String(afterChange.retained_fee_lamports), "3000000");
results.rateChangeIsForwardOnly = "PASS";

// ---- control: a creator rate above the platform rate cannot overdraw the fee ------------
await db.query("update public.approved_groups set creator_fee_bps = 900 where id=$1::uuid", [GROUP]);
const overdraw = await discordBuy(1);
assert.equal(overdraw.creator_fee_bps_snapshot, 200,
  "clamped to the platform rate — the creator can never be owed more than was collected");
assert.equal(String(overdraw.creator_fee_lamports), "20000000");
assert.equal(String(overdraw.referral_fee_lamports), "0",
  "and the referral reward, funded from what remains, is correctly nothing");
assert.equal(String(overdraw.retained_fee_lamports), "0");
results.creatorRateClampedToFee = "PASS";

// ---- control: the validator still rejects a hand-forged allocation ----------------------
await assert.rejects(
  () => db.query(
    `update app_private.trade_executions set creator_fee_lamports = creator_fee_lamports + 1
     where id = $1::uuid`, [funded.id]),
  /creator fee does not match|reconciled/i,
  "a reconciled allocation cannot be edited to pay someone more");
results.forgedAllocationRejected = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results,
  note: "the platform fee is 0 bps in production because PLATFORM_FEE_ACCOUNT is unset (E-4). " +
        "Every allocation above is therefore 0 today. This proves the chain is complete the " +
        "moment the flag is set, rather than discovering it with live money flowing",
  rates: { platform: "200 bps of notional", discordCreator: "70 bps", kolCreator: "20 bps",
           referral: "1000 bps OF THE COLLECTED FEE" }
}, null, 2));

await db.close();
