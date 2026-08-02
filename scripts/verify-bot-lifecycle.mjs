import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTable, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const identitySql = await readFile(`${repo}/supabase/degenaration-product-identity-bots.sql`, "utf8");
const rpcSql = await readFile(`${repo}/supabase/degenaration-product-rpcs.sql`, "utf8");
const draftSql = await readFile(`${repo}/supabase/degenaration-mainnet-draft-storage.sql`, "utf8");
const safetySql = await readFile(`${repo}/supabase/degenaration-bot-lifecycle-safety.sql`, "utf8");
const activitySql = await readFile(`${repo}/supabase/degenaration-bot-activity.sql`, "utf8");
const attributionSql = await readFile(`${repo}/supabase/degenaration-position-bot-attribution.sql`, "utf8");

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `SQL section not found: ${startMarker}`);
  return source.slice(start, end);
}

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  create table public.approved_groups (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    active boolean not null default true,
    verification_status text not null default 'approved',
    creator_fee_bps integer not null default 70
  );

  create table public.subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid,
    privy_user_id text,
    group_id uuid not null references public.approved_groups(id),
    size_sol numeric not null default 0.5,
    tp1 numeric default 2,
    tp1_sell integer default 50,
    tp2 numeric default 5,
    tp2_sell integer default 25,
    stop_loss integer default 40,
    slippage_bps integer default 300,
    daily_cap_sol numeric default 2,
    enabled boolean not null default false,
    user_pubkey text,
    wallet_id text,
    daily_spent numeric not null default 0,
    created_at timestamptz not null default now()
  );

  create unique index subscriptions_privy_group_key
    on public.subscriptions (privy_user_id, group_id)
    where privy_user_id is not null;
`);

await db.exec(identitySql);
await db.exec(`
  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret = 'lifecycle-test-secret' $$;

  create table app_private.system_flags (
    flag_key text primary key,
    value jsonb not null
  );
  insert into app_private.system_flags values ('mainnet_execution_enabled', 'true'::jsonb);

  ${renderTable("public.positions")}

  create table app_private.positions (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null references app_private.app_users(privy_user_id),
    bot_id uuid references app_private.bot_profiles(id) on delete restrict,
    config_version_id uuid references app_private.bot_config_versions(id) on delete restrict,
    mint text not null,
    status text not null default 'open'
      check (status in ('opening', 'open', 'closing', 'closed', 'error')),
    quantity_base_units numeric(39, 0) not null default 0,
    cost_lamports bigint not null default 0,
    realized_pnl_lamports bigint not null default 0,
    fees_lamports bigint not null default 0,
    entry_config_snapshot jsonb not null default '{}'::jsonb,
    opened_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    closed_at timestamptz
  );

  create table app_private.performance_snapshots (
    id uuid primary key default gen_random_uuid(),
    subject_type text not null,
    subject_id text not null,
    period text not null,
    as_of timestamptz not null default now(),
    sample_size integer not null default 0,
    net_pnl_lamports bigint,
    volume_lamports bigint,
    network_fees_lamports bigint,
    platform_fees_lamports bigint,
    creator_fees_lamports bigint
  );

  create table app_private.outbox_events (
    id uuid primary key default gen_random_uuid(),
    aggregate_type text not null,
    aggregate_id text not null,
    event_type text not null,
    payload jsonb not null,
    idempotency_key text not null unique
  );

  create table app_private.raw_signals (
    id uuid primary key,
    source_type text not null,
    source_ref text not null,
    immutable_payload jsonb not null,
    content_hash text not null,
    received_at timestamptz not null default now()
  );
  create table app_private.parsed_signals (
    id uuid primary key,
    raw_signal_id uuid not null references app_private.raw_signals(id),
    parser_version text not null,
    status text not null,
    mint text,
    confidence_bps integer,
    rejection_reason text,
    normalized_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create table app_private.signal_deliveries (
    id uuid primary key,
    parsed_signal_id uuid not null references app_private.parsed_signals(id),
    bot_id uuid not null references app_private.bot_profiles(id),
    config_version_id uuid not null references app_private.bot_config_versions(id),
    idempotency_key text not null unique,
    status text not null,
    evaluation jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    finished_at timestamptz
  );
  create table app_private.trade_intents (
    id uuid primary key,
    owner_privy_user_id text not null references app_private.app_users(privy_user_id),
    bot_id uuid references app_private.bot_profiles(id),
    config_version_id uuid references app_private.bot_config_versions(id),
    signal_delivery_id uuid references app_private.signal_deliveries(id),
    intent_kind text not null,
    side text not null,
    mint text not null,
    requested_input_base_units numeric(39, 0) not null,
    execution_mode text not null,
    state text not null,
    idempotency_key text not null unique,
    safety_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table app_private.trade_executions (
    id uuid primary key,
    intent_id uuid not null references app_private.trade_intents(id),
    owner_privy_user_id text not null references app_private.app_users(privy_user_id),
    execution_mode text not null,
    status text not null,
    attempt integer not null default 1,
    tx_signature text,
    gross_notional_lamports bigint not null default 0,
    network_fee_lamports bigint not null default 0,
    priority_fee_lamports bigint not null default 0,
    platform_fee_lamports bigint not null default 0,
    creator_fee_lamports bigint not null default 0,
    submitted_at timestamptz,
    confirmed_at timestamptz,
    reconciled_at timestamptz,
    error_code text,
    error_message text,
    created_at timestamptz not null default now()
  );
`);

await db.exec(section(
  rpcSql,
  "create or replace function app_private.ensure_app_user(",
  "create or replace function app_private.is_app_admin("
));
await db.exec(section(
  rpcSql,
  "create or replace function public.app_user_save_bot(",
  "create or replace function public.app_user_list_bots("
));
await db.exec(section(
  rpcSql,
  "create or replace function public.app_user_list_bots(",
  "create or replace function public.app_user_get_bot("
));
await db.exec(section(
  rpcSql,
  "create or replace function public.app_user_get_bot(",
  "create or replace function public.app_public_list_discord_marketplace("
));
await db.exec(`
  revoke execute on function public.app_user_save_bot(text, text, jsonb) from public, anon, authenticated;
  revoke execute on function public.app_user_list_bots(text, text, text) from public, anon, authenticated;
  revoke execute on function public.app_user_get_bot(text, text, uuid) from public, anon, authenticated;
  grant execute on function public.app_user_save_bot(text, text, jsonb) to service_role;
  grant execute on function public.app_user_list_bots(text, text, text) to service_role;
  grant execute on function public.app_user_get_bot(text, text, uuid) to service_role;
`);
await db.exec(draftSql);
await db.exec(attributionSql);
await db.exec(attributionSql);
await db.exec(safetySql);
await db.exec(safetySql);
await assertSchemaParity(db, ["public.positions"], assert);
await db.exec(activitySql);
await db.exec(activitySql);

const sourceOne = "10000000-0000-0000-0000-000000000001";
const sourceTwo = "10000000-0000-0000-0000-000000000002";
await db.exec(`
  insert into public.approved_groups (id, name) values
    ('${sourceOne}', 'Fixture source one'),
    ('${sourceTwo}', 'Fixture source two');
`);

const baseConfig = {
  walletAddress: "11111111111111111111111111111111",
  walletId: "fixture-wallet",
  channelId: null,
  buyAmountLamports: "500000000",
  maximumCapitalLamports: "3000000000",
  dailyLossLimitLamports: "1000000000",
  perTokenExposureLamports: "1000000000",
  maxOpenTrades: 3,
  slippageBps: 300,
  priorityFeeMaxLamports: 500000,
  autoRetryCount: 2,
  limitRetryCount: 2,
  quoteExpirationSeconds: 30,
  cooldownSeconds: 900,
  simulationRequired: true,
  takeProfit: { levels: [{ targetBps: 10000, sellBps: 5000 }] },
  stopLoss: { stopBps: 4000 },
  safetyFilters: { ranges: {}, flags: {}, unavailableDataBehavior: "fail-closed" }
};

function payload(overrides = {}) {
  return {
    kind: "discord",
    name: "Lifecycle fixture",
    description: "Isolated lifecycle test",
    status: "draft",
    visibility: "private",
    executionMode: "solana-mainnet",
    sourceGroupId: sourceOne,
    confirmed: false,
    schemaVersion: 1,
    changeNote: "Lifecycle verification",
    config: baseConfig,
    ...overrides
  };
}

async function call(functionName, args, role = "service_role") {
  await db.exec(`set role ${role}`);
  try {
    const placeholders = args.map((_, index) => `$${index + 1}`).join(", ");
    const result = await db.query(`select public.${functionName}(${placeholders}) as payload`, args);
    return result.rows[0].payload;
  } finally {
    await db.exec("reset role");
  }
}

await assert.rejects(
  () => call("app_user_list_bots", ["lifecycle-test-secret", "user-a", null], "anon"),
  /permission denied/i
);
await assert.rejects(
  () => call("app_user_list_bots", ["wrong-secret", "user-a", null]),
  /unauthorized/i
);

const created = await call("app_user_save_mainnet_bot_draft", [
  "lifecycle-test-secret", "user-a", payload()
]);
const botId = created.bot.id;
assert.equal(created.bot.version, 1);
assert.equal(created.bot.executionMode, "solana-mainnet");

const denied = await call("app_user_get_bot", ["lifecycle-test-secret", "user-b", botId]);
assert.equal(denied.status, 404);
const otherList = await call("app_user_list_bots", ["lifecycle-test-secret", "user-b", null]);
assert.deepEqual(otherList.bots, []);

const editedConfig = { ...baseConfig, slippageBps: 425 };
const edited = await call("app_user_save_mainnet_bot_draft", [
  "lifecycle-test-secret", "user-a", payload({ id: botId, name: "Lifecycle fixture edited", config: editedConfig })
]);
assert.equal(edited.bot.version, 2);
const hydrated = await call("app_user_get_bot", ["lifecycle-test-secret", "user-a", botId]);
assert.equal(hydrated.bot.name, "Lifecycle fixture edited");
assert.equal(hydrated.bot.version, 2);
assert.equal(hydrated.bot.config.slippageBps, 425);

const versions = await db.query(
  "select id, version, config from app_private.bot_config_versions where bot_id = $1 order by version",
  [botId]
);
assert.equal(versions.rows.length, 2);
assert.equal(versions.rows[0].config.slippageBps, 300);
assert.equal(versions.rows[1].config.slippageBps, 425);

const versionTwoId = versions.rows[1].id;
await db.query(`
  insert into app_private.positions (
    owner_privy_user_id, bot_id, config_version_id, mint, status,
    quantity_base_units, cost_lamports, entry_config_snapshot
  )
  select 'user-a', $1, c.id, '11111111111111111111111111111111', 'open', 1000, 500000000, c.config
  from app_private.bot_config_versions c where c.id = $2
`, [botId, versionTwoId]);

await db.exec(`
  insert into app_private.raw_signals (
    id, source_type, source_ref, immutable_payload, content_hash
  ) values ('20000000-0000-0000-0000-000000000001', 'discord', 'fixture-channel', '{}'::jsonb, 'fixture-hash');
  insert into app_private.parsed_signals (
    id, raw_signal_id, parser_version, status, mint, confidence_bps
  ) values (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'fixture-parser', 'accepted',
    '11111111111111111111111111111111', 9900
  );
`);
await db.query(`
  insert into app_private.signal_deliveries (
    id, parsed_signal_id, bot_id, config_version_id, idempotency_key, status
  ) values (
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', $1, $2, 'delivery-fixture', 'completed'
  );
`, [botId, versionTwoId]);
await db.query(`
  insert into app_private.trade_intents (
    id, owner_privy_user_id, bot_id, config_version_id, signal_delivery_id,
    intent_kind, side, mint, requested_input_base_units, execution_mode, state,
    idempotency_key, safety_snapshot
  ) values (
    '50000000-0000-0000-0000-000000000001', 'user-a', $1, $2,
    '40000000-0000-0000-0000-000000000001', 'entry', 'buy',
    '11111111111111111111111111111111', 500000000, 'solana-mainnet',
    'reconciled', 'intent-fixture', '{"filters":"passed"}'::jsonb
  );
`, [botId, versionTwoId]);
await db.exec(`
  insert into app_private.trade_executions (
    id, intent_id, owner_privy_user_id, execution_mode, status, tx_signature,
    gross_notional_lamports, network_fee_lamports, platform_fee_lamports,
    creator_fee_lamports, submitted_at, confirmed_at, reconciled_at
  ) values (
    '60000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001', 'user-a', 'solana-mainnet',
    'reconciled', 'fixture-signature', 500000000, 5000, 10000000, 3500000,
    now(), now(), now()
  );
`);

const activity = await call("app_user_get_bot_activity", [
  "lifecycle-test-secret", "user-a", botId, 100
]);
assert.equal(activity.signals.length, 1);
assert.equal(activity.signals[0].status, "completed");
assert.equal(activity.executions.length, 1);
assert.equal(activity.executions[0].executionStatus, "reconciled");
assert.equal(activity.executions[0].platformFeeLamports, "10000000");
const deniedActivity = await call("app_user_get_bot_activity", [
  "lifecycle-test-secret", "user-b", botId, 100
]);
assert.equal(deniedActivity.status, 404);

await assert.rejects(
  () => db.query("update app_private.positions set entry_config_snapshot = '{}'::jsonb where bot_id = $1", [botId]),
  /entry configuration is immutable/i
);
await assert.rejects(
  () => call("app_user_save_mainnet_bot_draft", [
    "lifecycle-test-secret", "user-a", payload({ id: botId, status: "archived" })
  ]),
  /open positions/i
);

const active = await call("app_user_save_bot", [
  "lifecycle-test-secret", "user-a", payload({ id: botId, status: "active", confirmed: true, config: editedConfig })
]);
assert.equal(active.bot.status, "active");
assert.equal(active.bot.version, 3);
const paused = await call("app_user_save_mainnet_bot_draft", [
  "lifecycle-test-secret", "user-a", payload({ id: botId, status: "paused", config: editedConfig })
]);
assert.equal(paused.bot.status, "paused");
assert.equal(paused.bot.version, 4);
const resumed = await call("app_user_save_bot", [
  "lifecycle-test-secret", "user-a", payload({ id: botId, status: "active", confirmed: true, config: editedConfig })
]);
assert.equal(resumed.bot.status, "active");
assert.equal(resumed.bot.version, 5);

const positionAfterEdit = await db.query(
  "select config_version_id, entry_config_snapshot from app_private.positions where bot_id = $1",
  [botId]
);
assert.equal(positionAfterEdit.rows[0].config_version_id, versionTwoId);
assert.equal(positionAfterEdit.rows[0].entry_config_snapshot.slippageBps, 425);

await db.query("update app_private.positions set status = 'closed', closed_at = now() where bot_id = $1", [botId]);

// The worker opens positions in public.positions, not in the product ledger the check
// above uses. Closing the product-ledger row must NOT be enough to archive a bot that
// still holds a live worker position — before this case existed, it was.
const subscriptionGroup = await db.query(
  "select group_id from public.subscriptions where bot_profile_id = $1", [botId]
);
assert.ok(subscriptionGroup.rows[0]?.group_id, "the discord bot must own a subscription");
await db.query(`
  insert into public.positions (
    user_pubkey, privy_user_id, group_id, mint, entry_price_usd,
    amount_raw, original_amount_raw, status, entry_sig
  ) values (
    '11111111111111111111111111111111', 'user-a', $1,
    '11111111111111111111111111111111', 0.0001, 1000, 1000, 'open', 'worker-entry-sig'
  )
`, [subscriptionGroup.rows[0].group_id]);
await assert.rejects(
  () => call("app_user_save_mainnet_bot_draft", [
    "lifecycle-test-secret", "user-a", payload({ id: botId, status: "archived", config: editedConfig })
  ]),
  /open positions/i,
  "archival must fail closed on the worker's position ledger too"
);
await db.query(
  "update public.positions set status = 'closed', closed_at = now() where entry_sig = 'worker-entry-sig'"
);

// A position opened through the copy path carries group_id NULL, and a KOL bot has no
// source group at all, so a group-based join can never see either. Attribution by
// bot_profile_id is what makes the guard fire for every bot kind.
await db.query(`
  insert into public.positions (
    user_pubkey, privy_user_id, group_id, bot_profile_id, mint, entry_price_usd,
    amount_raw, original_amount_raw, status, entry_sig
  ) values (
    '11111111111111111111111111111111', 'user-a', null, $1,
    '11111111111111111111111111111111', 0.0001, 1000, 1000, 'open', 'ungrouped-entry-sig'
  )
`, [botId]);
await assert.rejects(
  () => call("app_user_save_mainnet_bot_draft", [
    "lifecycle-test-secret", "user-a", payload({ id: botId, status: "archived", config: editedConfig })
  ]),
  /open positions/i,
  "a position with no source group must still block archival when it is attributed to the bot"
);
await db.query(
  "update public.positions set status = 'closed', closed_at = now() where entry_sig = 'ungrouped-entry-sig'"
);

// A wallet-copy position belongs to no bot, so it must NOT block an unrelated bot.
await db.query(`
  insert into public.positions (
    user_pubkey, privy_user_id, group_id, bot_profile_id, mint, entry_price_usd,
    amount_raw, original_amount_raw, status, entry_sig
  ) values (
    '11111111111111111111111111111111', 'user-a', null, null,
    '11111111111111111111111111111111', 0.0001, 1000, 1000, 'open', 'wallet-copy-entry-sig'
  )
`);

const archived = await call("app_user_save_mainnet_bot_draft", [
  "lifecycle-test-secret", "user-a", payload({ id: botId, status: "archived", config: editedConfig })
]);
assert.equal(archived.bot.status, "archived");
assert.equal(archived.bot.version, 6);
await assert.rejects(
  () => call("app_user_save_mainnet_bot_draft", [
    "lifecycle-test-secret", "user-a", payload({ id: botId, status: "draft", config: editedConfig })
  ]),
  /archived bot cannot be restored/i
);

const liveDiscord = await call("app_user_save_mainnet_bot_draft", [
  "lifecycle-test-secret", "user-a", payload({ sourceGroupId: sourceTwo })
]);
await assert.rejects(
  () => call("app_user_save_mainnet_bot_draft", [
    "lifecycle-test-secret", "user-a", payload({ id: liveDiscord.bot.id, sourceGroupId: sourceOne })
  ]),
  /already exists|duplicate key/i
);

const kolPayload = payload({
  kind: "kol",
  name: "KOL fixture",
  sourceGroupId: null,
  config: { ...baseConfig, riskTier: "high" }
});
const kolOne = await call("app_user_save_mainnet_bot_draft", ["lifecycle-test-secret", "user-a", kolPayload]);
const kolCopy = await call("app_user_save_mainnet_bot_draft", [
  "lifecycle-test-secret", "user-a", { ...kolPayload, name: "KOL fixture copy" }
]);
assert.notEqual(kolOne.bot.id, kolCopy.bot.id);

const privilegeRows = await db.query(`
  select
    has_function_privilege('anon', 'public.app_user_get_bot(text,text,uuid)', 'execute') as anon_execute,
    has_function_privilege('authenticated', 'public.app_user_get_bot(text,text,uuid)', 'execute') as authenticated_execute,
    has_function_privilege('service_role', 'public.app_user_get_bot(text,text,uuid)', 'execute') as service_execute
`);
assert.deepEqual(privilegeRows.rows[0], {
  anon_execute: false,
  authenticated_execute: false,
  service_execute: true
});
const activityPrivilegeRows = await db.query(`
  select
    has_function_privilege('anon', 'public.app_user_get_bot_activity(text,text,uuid,integer)', 'execute') as anon_execute,
    has_function_privilege('authenticated', 'public.app_user_get_bot_activity(text,text,uuid,integer)', 'execute') as authenticated_execute,
    has_function_privilege('service_role', 'public.app_user_get_bot_activity(text,text,uuid,integer)', 'execute') as service_execute
`);
assert.deepEqual(activityPrivilegeRows.rows[0], {
  anon_execute: false,
  authenticated_execute: false,
  service_execute: true
});

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  migrationRerun: "PASS",
  ownerIsolation: "PASS",
  createHydrateEdit: "PASS",
  configurationVersions: 6,
  pauseResumeArchive: "PASS",
  archivedTerminal: "PASS",
  schemaParity: "PASS",
  openPositionArchiveGuard: "PASS",
  ungroupedPositionBlocksArchive: "PASS",
  walletCopyPositionDoesNotBlockArchive: "PASS",
  entrySnapshotRetention: "PASS",
  discordSourceUniqueness: "PASS",
  kolDuplicate: "PASS",
  ownerActivityJournal: "PASS",
  rpcAuthorization: "PASS"
}, null, 2));

await db.close();
