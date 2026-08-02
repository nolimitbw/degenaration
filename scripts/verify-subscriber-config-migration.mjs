/**
 * Repeatable verification for supabase/degenaration-subscriber-config-versioning.sql.
 *
 * The fixture is GENERATED from scripts/lib/production-schema.mjs, not hand-written.
 * An earlier hand-written fixture declared copy_subscriptions.size_sol as numeric where
 * production declares double precision, which hid a defect that would have made every
 * write to that table raise. Read the comment at the top of production-schema.mjs before
 * changing anything here.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity, PRODUCTION_TABLES } from "./lib/production-schema.mjs";

const db = new PGlite();
const migration = await readFile(
  `${process.cwd()}/supabase/degenaration-subscriber-config-versioning.sql`,
  "utf8"
);

// FK order: referenced tables first.
const FIXTURE_TABLES = [
  "app_private.bot_config_versions",
  "app_private.trading_wallets",
  "public.subscriptions",
  "public.copy_subscriptions",
  "app_private.kol_subscriptions",
  "app_private.call_executions",
  "app_private.copy_executions"
];

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);

// Production grants: service_role writes these two tables directly and holds NO usage on
// app_private. Reproducing that exactly is what proves the trigger functions can run.
await db.exec(`
  grant usage on schema public to service_role;
  grant select, insert, update, delete on public.subscriptions to service_role;
  grant select, insert, update, delete on public.copy_subscriptions to service_role;
  revoke all on schema app_private from service_role, anon, authenticated;
`);

// The shape components/product/BotBuilder.tsx actually submits.
const creatorConfig = {
  buyAmountLamports: "500000000",
  maximumCapitalLamports: "3000000000",
  dailyLossLimitLamports: "1000000000",
  maxOpenTrades: 3,
  slippageBps: 300,
  priorityFeeMaxLamports: 500000,
  takeProfit: { levels: [{ targetBps: 10000, sellBps: 5000 }] },
  stopLoss: { stopBps: 4000 },
  dca: { enabled: true, levels: [{ dropBps: 1000, buyAmountSol: 0.25 }] },
  safetyFilters: { ranges: {}, flags: {}, unavailableDataBehavior: "fail-closed" }
};

await db.query(
  `insert into app_private.bot_config_versions (id, bot_id, version, config, created_by)
   values ($1, $2, 1, $3, 'creator-owner')`,
  ["10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000002", creatorConfig]
);
await db.exec(`
  insert into app_private.trading_wallets (id, privy_user_id, privy_wallet_id, address)
  values (
    '20000000-0000-0000-0000-000000000001', 'subscriber-kol',
    'kol-wallet-id', '11111111111111111111111111111111'
  );

  -- A Privy-owned legacy Discord row.
  insert into public.subscriptions (
    id, privy_user_id, group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell,
    stop_loss, slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id
  ) values (
    '30000000-0000-0000-0000-000000000001', 'subscriber-discord',
    '30000000-0000-0000-0000-000000000002', 0.5, 2, 50, 5, 25,
    40, 300, 2, true, '11111111111111111111111111111111', 'discord-wallet-id'
  );
  -- A Supabase-auth legacy row: owner identity comes from user_id, not privy_user_id.
  insert into public.subscriptions (
    id, user_id, group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell,
    stop_loss, slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id
  ) values (
    '30000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000005', 0.1, 2, 50, 5, 25,
    40, 300, 1, false, null, null
  );
  -- An orphaned row with neither owner identity. It must NOT be versioned, and must not
  -- be executable either — a durable configuration is the precondition for trading.
  insert into public.subscriptions (
    id, group_id, size_sol, daily_cap_sol, enabled, user_pubkey, wallet_id
  ) values (
    '30000000-0000-0000-0000-000000000006',
    '30000000-0000-0000-0000-000000000007', 0.2, 1, false, null, null
  );

  insert into public.copy_subscriptions (
    id, privy_user_id, leader_wallet, size_sol, tp1, tp1_sell, tp2, tp2_sell,
    stop_loss, slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id
  ) values (
    '40000000-0000-0000-0000-000000000001', 'subscriber-copy',
    '11111111111111111111111111111111', 0.25, 2, 50, 5, 25,
    35, 250, 1, true, '11111111111111111111111111111111', 'copy-wallet-id'
  );
  -- size_sol = 0 with a cap above int4 range once divided by the 1e-9 floor. Casting
  -- before clamping overflows here and aborts the migration mid-backfill.
  insert into public.copy_subscriptions (
    id, privy_user_id, leader_wallet, size_sol, tp1, daily_cap_sol, enabled, user_pubkey
  ) values (
    '40000000-0000-0000-0000-000000000002', 'subscriber-copy-zero',
    '22222222222222222222222222222222', 0, 1000000, 3, true,
    '22222222222222222222222222222222'
  );

  insert into app_private.kol_subscriptions (
    id, strategy_id, subscriber_privy_user_id, wallet_id, strategy_version_id, status, config
  ) values (
    '50000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002', 'subscriber-kol',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001', 'active',
    '{
      "walletAddress":"11111111111111111111111111111111",
      "walletId":"kol-wallet-id",
      "buyAmountLamports":"500000000",
      "maximumCapitalLamports":"3000000000",
      "dailyLossLimitLamports":"1000000000",
      "maxOpenTrades":3,
      "slippageBps":300,
      "priorityFeeMaxLamports":500000,
      "riskOverrides":{"mode":"stricter-only"}
    }'::jsonb
  );

  insert into app_private.call_executions (
    id, call_id, subscription_id, status, amount_sol
  ) values (
    '60000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001', 'succeeded', 0.5
  );
  insert into app_private.copy_executions (
    id, subscription_id, leader_wallet, mint, dedupe_key, status, amount_sol
  ) values (
    '70000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '11111111111111111111111111111111', 'So11111111111111111111111111111111111111112',
    'historical-1', 'succeeded', 0.25
  );
`);

async function counts() {
  const result = await db.query(`
    select
      (select count(*)::integer from public.subscriptions) as discord_subscriptions,
      (select count(*)::integer from public.copy_subscriptions) as copy_subscriptions,
      (select count(*)::integer from app_private.kol_subscriptions) as kol_subscriptions,
      (select count(*)::integer from app_private.call_executions) as call_executions,
      (select count(*)::integer from app_private.copy_executions) as copy_executions
  `);
  return result.rows[0];
}

const before = await counts();
await db.exec(migration);
await db.exec(migration);
const after = await counts();
assert.deepEqual(after, before);
await assertSchemaParity(db, FIXTURE_TABLES, assert);

// ---- backfill produced one durable version per owned subscription ----

const versions = await db.query(`
  select subscription_kind, subscription_ref, subscriber_privy_user_id,
    version, compatibility_mode, config
  from app_private.subscriber_config_versions
  order by subscription_kind
`);
assert.equal(versions.rows.length, 5);
const discord = versions.rows.find((row) => row.subscription_ref === "30000000-0000-0000-0000-000000000001");
const supabaseLegacy = versions.rows.find((row) => row.subscription_ref === "30000000-0000-0000-0000-000000000003");
const copy = versions.rows.find((row) => row.subscription_ref === "40000000-0000-0000-0000-000000000001");
const copyZero = versions.rows.find((row) => row.subscription_ref === "40000000-0000-0000-0000-000000000002");
const kol = versions.rows.find((row) => row.subscription_kind === "kol");
assert.equal(discord.compatibility_mode, "legacy-baseline");
assert.equal(discord.config.buyAmountLamports, "500000000");
assert.equal(discord.config.maxOpenTrades, 4);
assert.equal(supabaseLegacy.subscriber_privy_user_id, "supabase:30000000-0000-0000-0000-000000000004");
assert.equal(supabaseLegacy.compatibility_mode, "legacy-baseline");
assert.equal(copy.compatibility_mode, "legacy-baseline");
assert.equal(copy.config.priorityFeeMaxLamports, 0);
assert.equal(copy.config.buyAmountLamports, "250000000");
assert.equal(kol.compatibility_mode, "versioned");
assert.deepEqual(kol.config.takeProfit, creatorConfig.takeProfit);
assert.deepEqual(kol.config.stopLoss, creatorConfig.stopLoss);
assert.deepEqual(kol.config.dca, creatorConfig.dca);
assert.deepEqual(kol.config.safetyFilters, creatorConfig.safetyFilters);
assert.equal(kol.config.maximumCapitalLamports, "3000000000");

// Clamped before the int4 cast, so no overflow and no runaway trade count.
assert.equal(copyZero.config.maxOpenTrades, 100);
assert.equal(copyZero.config.takeProfit.levels[0].targetBps, 1000000);

// The orphaned row has no owner, so no version, and stays inert.
const orphan = await db.query(`
  select subscriber_config_version_id, subscriber_config_snapshot
  from public.subscriptions where id = '30000000-0000-0000-0000-000000000006'
`);
assert.equal(orphan.rows[0].subscriber_config_version_id, null);
assert.deepEqual(orphan.rows[0].subscriber_config_snapshot, {});
await assert.rejects(
  () => db.exec(`
    insert into app_private.call_executions (call_id, subscription_id, status, amount_sol)
    values ('60000000-0000-0000-0000-000000000009',
            '30000000-0000-0000-0000-000000000006', 'claimed', 0.2)
  `),
  /configuration unavailable/i,
  "a subscription with no durable configuration must not execute"
);

// ---- historical executions keep the configuration that created them ----

const historical = await db.query(`
  select subscriber_config_version_id, subscriber_config_snapshot
  from app_private.call_executions
  where id = '60000000-0000-0000-0000-000000000001'
`);
assert.equal(historical.rows[0].subscriber_config_version_id, null);
assert.deepEqual(historical.rows[0].subscriber_config_snapshot, {});

await db.exec(`
  insert into app_private.call_executions (call_id, subscription_id, status, amount_sol)
  values ('60000000-0000-0000-0000-000000000003',
          '30000000-0000-0000-0000-000000000001', 'claimed', 0.5);
  insert into app_private.copy_executions (
    subscription_id, leader_wallet, mint, dedupe_key, status, amount_sol
  ) values (
    '40000000-0000-0000-0000-000000000001',
    '11111111111111111111111111111111', 'So11111111111111111111111111111111111111112',
    'claimed-1', 'claimed', 0.25
  );
`);
const attached = await db.query(`
  select subscriber_config_version_id, subscriber_config_snapshot
  from app_private.call_executions where status = 'claimed'
`);
assert.ok(attached.rows[0].subscriber_config_version_id);
assert.equal(attached.rows[0].subscriber_config_snapshot.buyAmountLamports, "500000000");

const discordVersionOne = attached.rows[0].subscriber_config_version_id;
await db.exec(`
  update public.subscriptions
  set size_sol = 0.75
  where id = '30000000-0000-0000-0000-000000000001';
`);
const discordVersionTwo = await db.query(`
  select subscriber_config_version_id, subscriber_config_snapshot
  from public.subscriptions
  where id = '30000000-0000-0000-0000-000000000001'
`);
assert.notEqual(discordVersionTwo.rows[0].subscriber_config_version_id, discordVersionOne);
assert.equal(discordVersionTwo.rows[0].subscriber_config_snapshot.buyAmountLamports, "750000000");
const oldExecution = await db.query(`
  select subscriber_config_version_id, subscriber_config_snapshot
  from app_private.call_executions where status = 'claimed'
`);
assert.equal(oldExecution.rows[0].subscriber_config_version_id, discordVersionOne);
assert.equal(oldExecution.rows[0].subscriber_config_snapshot.buyAmountLamports, "500000000");

const versionCountBeforeSpend = await db.query(
  "select count(*)::integer as count from app_private.subscriber_config_versions"
);
await db.exec(`
  update public.subscriptions set daily_spent = 0.75
  where id = '30000000-0000-0000-0000-000000000001'
`);
const versionCountAfterSpend = await db.query(
  "select count(*)::integer as count from app_private.subscriber_config_versions"
);
assert.equal(versionCountAfterSpend.rows[0].count, versionCountBeforeSpend.rows[0].count);

await assert.rejects(
  () => db.query(
    "update app_private.subscriber_config_versions set config = $1 where id = $2",
    [{ changed: true }, discordVersionOne]
  ),
  /immutable/i
);
await assert.rejects(
  () => db.query(
    "update app_private.call_executions set subscriber_config_snapshot = $1 where status = 'claimed'",
    [{ changed: true }]
  ),
  /immutable/i
);

// ---- a valid builder payload versions as `versioned`, keeping the user's filters ----

await db.query(
  `update public.subscriptions
      set bot_profile_id = '80000000-0000-0000-0000-000000000001',
          config_version_id = '10000000-0000-0000-0000-000000000001',
          extended_config = $1
    where id = '30000000-0000-0000-0000-000000000001'`,
  [creatorConfig]
);
const builderRow = await db.query(`
  select subscriber_config_snapshot from public.subscriptions
  where id = '30000000-0000-0000-0000-000000000001'
`);
assert.deepEqual(
  builderRow.rows[0].subscriber_config_snapshot.safetyFilters,
  creatorConfig.safetyFilters,
  "a versioned snapshot must carry the subscriber's own safety filters"
);

// A builder payload missing safetyFilters must be REFUSED, not silently versioned.
// jsonb_typeof of a missing key is NULL, and an unguarded NULL makes `not valid(...)`
// NULL, which does not fire the guard.
const { safetyFilters, ...withoutFilters } = creatorConfig;
await assert.rejects(
  () => db.query(
    `update public.subscriptions set extended_config = $1
      where id = '30000000-0000-0000-0000-000000000001'`,
    [withoutFilters]
  ),
  /invalid subscriber configuration/i
);
// A non-numeric lamport value fails validation rather than raising a cast error.
await assert.rejects(
  () => db.query(
    `update public.subscriptions set extended_config = $1
      where id = '30000000-0000-0000-0000-000000000001'`,
    [{ ...creatorConfig, buyAmountLamports: "not-a-number" }]
  ),
  /invalid subscriber configuration/i
);

// ---- kill switch stops execution ----

await db.exec(`
  update public.copy_subscriptions set kill_switch = true
  where id = '40000000-0000-0000-0000-000000000001'
`);
await assert.rejects(
  () => db.exec(`
    insert into app_private.copy_executions (
      subscription_id, leader_wallet, mint, dedupe_key, status, amount_sol
    ) values (
      '40000000-0000-0000-0000-000000000001',
      '11111111111111111111111111111111', 'So11111111111111111111111111111111111111112',
      'killed-1', 'claimed', 0.25
    )
  `),
  /configuration unavailable/i
);

// ---- the trigger functions must hold definer rights ----

const definer = await db.query(`
  select proname, prosecdef from pg_proc
  where pronamespace = 'app_private'::regnamespace
    and proname in ('version_discord_subscription', 'version_wallet_copy_subscription',
                    'version_kol_subscription', 'attach_call_execution_config',
                    'attach_copy_execution_config', 'create_subscriber_config_version')
  order by proname
`);
assert.equal(definer.rows.length, 6);
for (const row of definer.rows) {
  assert.equal(row.prosecdef, true, `${row.proname} must be security definer`);
}

// ---- service_role, with no app_private usage, must be able to write ----

await db.exec("set role service_role");
await assert.rejects(
  () => db.query("select * from app_private.subscriber_config_versions"),
  /permission denied/i
);
await db.exec(`
  insert into public.subscriptions (
    id, privy_user_id, group_id, size_sol, daily_cap_sol, enabled, user_pubkey, wallet_id
  ) values (
    '30000000-0000-0000-0000-00000000000a', 'service-written',
    '30000000-0000-0000-0000-00000000000b', 0.3, 1.5, false,
    '11111111111111111111111111111111', 'svc-wallet'
  );
  -- double precision columns: the cast that makes legacy_subscriber_config resolvable
  insert into public.copy_subscriptions (
    id, privy_user_id, leader_wallet, size_sol, daily_cap_sol, enabled, user_pubkey
  ) values (
    '40000000-0000-0000-0000-000000000003', 'service-copy',
    '33333333333333333333333333333333', 0.1, 0.4, true,
    '33333333333333333333333333333333'
  );
  update public.copy_subscriptions set size_sol = 0.75
  where id = '40000000-0000-0000-0000-000000000003';
`);

// A forged snapshot is discarded: writing the column re-enters the trigger, which
// recomputes both fields from the authoritative columns.
await db.query(
  `update public.subscriptions set subscriber_config_snapshot = $1
    where id = '30000000-0000-0000-0000-00000000000a'`,
  [{ safetyFilters: { forged: true }, buyAmountLamports: "999999999999" }]
);
await db.exec("reset role");

const serviceWritten = await db.query(`
  select subscriber_config_version_id, subscriber_config_snapshot
  from public.subscriptions where id = '30000000-0000-0000-0000-00000000000a'
`);
assert.ok(serviceWritten.rows[0].subscriber_config_version_id, "service_role write must version");
assert.equal(serviceWritten.rows[0].subscriber_config_snapshot.buyAmountLamports, "300000000");
assert.equal(serviceWritten.rows[0].subscriber_config_snapshot.safetyFilters.forged, undefined);
assert.equal(
  serviceWritten.rows[0].subscriber_config_snapshot.safetyFilters.compatibilityMode,
  "platform-baseline"
);

const serviceCopy = await db.query(`
  select subscriber_config_snapshot from public.copy_subscriptions
  where id = '40000000-0000-0000-0000-000000000003'
`);
assert.equal(serviceCopy.rows[0].subscriber_config_snapshot.buyAmountLamports, "750000000");

// ---- control: without definer rights the same write fails ----
// Proves the service_role result above is not vacuous.
await db.exec(`
  create or replace function app_private.version_wallet_copy_subscription()
  returns trigger language plpgsql set search_path = '' as $control$
  begin
    new.subscriber_config_snapshot := app_private.legacy_subscriber_config(
      new.user_pubkey::text, new.wallet_id::text,
      new.size_sol::numeric, new.daily_cap_sol::numeric,
      new.slippage_bps::integer, new.tp1::numeric, new.tp1_sell::integer,
      new.tp2::numeric, new.tp2_sell::integer,
      new.stop_loss::integer, new.enabled::boolean, new.kill_switch::boolean
    );
    return new;
  end $control$;
`);
await db.exec("set role service_role");
await assert.rejects(
  () => db.exec(`
    insert into public.copy_subscriptions (
      privy_user_id, leader_wallet, size_sol, daily_cap_sol, enabled, user_pubkey
    ) values ('control', '44444444444444444444444444444444', 0.1, 0.4, true,
              '44444444444444444444444444444444')
  `),
  /permission denied/i,
  "invoker rights must fail, which is why the real triggers are security definer"
);
await db.exec("reset role");

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${Object.keys(PRODUCTION_TABLES).length} tables)`,
  schemaParity: "PASS",
  preservation: { before, after },
  migrationRerun: "PASS",
  legacyCompatibility: "PASS",
  doublePrecisionCopyPath: "PASS",
  integerClampBeforeCast: "PASS",
  kolEffectiveConfig: "PASS",
  versionedBuilderPayload: "PASS",
  invalidConfigRefused: "PASS",
  unownedRowNotExecutable: "PASS",
  durableVersions: "PASS",
  immutableExecutionSnapshot: "PASS",
  forgedSnapshotDiscarded: "PASS",
  killSwitch: "PASS",
  dailySpendDoesNotVersion: "PASS",
  triggersAreSecurityDefiner: "PASS",
  serviceRoleWithoutAppPrivate: "PASS",
  invokerRightsControlFails: "PASS",
  directRoleAccessDenied: "PASS"
}, null, 2));

await db.close();
