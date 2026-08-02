/**
 * Production column types for the tables the subscriber-configuration migration touches.
 *
 * WHY THIS FILE EXISTS
 *
 * Every `verify-*.mjs` script builds its PGlite fixture by hand-writing `create table`.
 * That is how a release-blocking defect reached a "PASS": the fixture declared
 * `copy_subscriptions.size_sol numeric`, production declares it `double precision`, and
 * `float8 -> numeric` is an *assignment* cast, not an implicit one. PostgreSQL therefore
 * refuses to resolve `legacy_subscriber_config(..., numeric, ...)` when the trigger passes
 * a `double precision` column, and every insert or update on that table raises
 *
 *     function app_private.legacy_subscriber_config(text, text, double precision, ...)
 *     does not exist
 *
 * The fixture passed because the fixture was wrong, not because the migration was right.
 *
 * So fixtures are no longer hand-written: `renderTable()` generates the DDL from the
 * captured production shape below. A fixture cannot drift from production without this
 * file changing, and this file is only changed by re-capturing from the database.
 *
 * Captured 2026-08-02 from project `uqccguunmjabjheeivhx` (PostgreSQL 17.6) with
 * read-only `information_schema` / `pg_catalog` queries. Re-capture with
 * `scripts/lib/README-schema-capture.sql` when production DDL changes.
 *
 * Only tables that a migration verification needs are captured. Foreign keys pointing
 * outside the captured set are intentionally omitted so a fixture stays self-contained.
 */

/** @typedef {{name: string, type: string, notNull?: boolean, default?: string}} Column */

export const PRODUCTION_TABLES = {
  "app_private.bot_config_versions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "bot_id", type: "uuid", notNull: true },
      { name: "version", type: "integer", notNull: true },
      { name: "schema_version", type: "integer", notNull: true, default: "1" },
      { name: "config", type: "jsonb", notNull: true },
      { name: "created_by", type: "text", notNull: true },
      { name: "change_note", type: "text" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (bot_id, version)"],
    checks: [
      "check (jsonb_typeof(config) = 'object')",
      "check (schema_version > 0)",
      "check (version > 0)"
    ]
  },

  "app_private.trading_wallets": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "privy_user_id", type: "text", notNull: true },
      { name: "privy_wallet_id", type: "text" },
      { name: "address", type: "text", notNull: true },
      { name: "chain", type: "text", notNull: true, default: "'solana'::text" },
      { name: "label", type: "text" },
      { name: "status", type: "text", notNull: true, default: "'active'::text" },
      { name: "verified_at", type: "timestamp with time zone" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "updated_at", type: "timestamp with time zone", notNull: true, default: "now()" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (privy_user_id, address)"],
    checks: [
      "check (length(address) >= 32 and length(address) <= 64)",
      "check (chain = 'solana'::text)",
      "check (status = any (array['active'::text, 'paused'::text, 'revoked'::text]))"
    ],
    uniqueIndexes: [
      `create unique index trading_wallets_privy_wallet_unique
         on app_private.trading_wallets (privy_user_id, privy_wallet_id)
         where privy_wallet_id is not null`
    ]
  },

  // size_sol and daily_cap_sol are numeric here but double precision on
  // public.copy_subscriptions. That asymmetry is the whole reason this file exists.
  "public.subscriptions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "user_id", type: "uuid" },
      { name: "group_id", type: "uuid", notNull: true },
      { name: "size_sol", type: "numeric", notNull: true, default: "0.5" },
      { name: "tp1", type: "numeric", default: "2" },
      { name: "tp1_sell", type: "integer", default: "50" },
      { name: "tp2", type: "numeric", default: "5" },
      { name: "tp2_sell", type: "integer", default: "25" },
      { name: "stop_loss", type: "integer", default: "40" },
      { name: "slippage_bps", type: "integer", default: "300" },
      { name: "daily_cap_sol", type: "numeric", default: "2" },
      { name: "enabled", type: "boolean", notNull: true, default: "true" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "user_pubkey", type: "text" },
      { name: "wallet_id", type: "text" },
      { name: "daily_spent", type: "numeric", notNull: true, default: "0" },
      { name: "privy_user_id", type: "text" },
      { name: "daily_spent_on", type: "date" },
      { name: "bot_profile_id", type: "uuid" },
      { name: "config_version_id", type: "uuid" },
      { name: "channel_id", type: "text" },
      { name: "status", type: "text", notNull: true, default: "'paused'::text" },
      { name: "extended_config", type: "jsonb", notNull: true, default: "'{}'::jsonb" },
      { name: "updated_at", type: "timestamp with time zone", notNull: true, default: "now()" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (user_id, group_id)"],
    checks: [
      `check (status = any (array['draft'::text, 'active'::text, 'paused'::text,
        'stopping'::text, 'archived'::text, 'error'::text]))`
    ],
    foreignKeys: [
      "foreign key (config_version_id) references app_private.bot_config_versions(id) on delete restrict"
    ],
    uniqueIndexes: [
      `create unique index subscriptions_bot_profile_unique
         on public.subscriptions (bot_profile_id) where bot_profile_id is not null`,
      `create unique index subscriptions_privy_group_key
         on public.subscriptions (privy_user_id, group_id) where privy_user_id is not null`
    ]
  },

  // size_sol, daily_cap_sol and daily_spent are DOUBLE PRECISION here.
  "public.copy_subscriptions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "user_id", type: "uuid" },
      { name: "user_pubkey", type: "text", notNull: true },
      { name: "wallet_id", type: "text" },
      { name: "leader_wallet", type: "text", notNull: true },
      { name: "label", type: "text" },
      { name: "size_sol", type: "double precision", notNull: true, default: "0.1" },
      { name: "tp1", type: "numeric", default: "2" },
      { name: "tp1_sell", type: "integer", default: "50" },
      { name: "tp2", type: "numeric", default: "5" },
      { name: "tp2_sell", type: "integer", default: "25" },
      { name: "stop_loss", type: "integer", default: "40" },
      { name: "slippage_bps", type: "integer", notNull: true, default: "300" },
      { name: "daily_cap_sol", type: "double precision", notNull: true, default: "2" },
      { name: "daily_spent", type: "double precision", notNull: true, default: "0" },
      { name: "enabled", type: "boolean", notNull: true, default: "true" },
      { name: "created_at", type: "timestamp with time zone", default: "now()" },
      { name: "privy_user_id", type: "text" },
      { name: "extended_config", type: "jsonb" },
      { name: "daily_spent_on", type: "date" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (user_id, leader_wallet)"],
    uniqueIndexes: [
      `create unique index copy_subscriptions_privy_leader_key
         on public.copy_subscriptions (privy_user_id, leader_wallet)
         where privy_user_id is not null`
    ]
  },

  "app_private.kol_subscriptions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "strategy_id", type: "uuid", notNull: true },
      { name: "subscriber_privy_user_id", type: "text", notNull: true },
      { name: "wallet_id", type: "uuid" },
      { name: "strategy_version_id", type: "uuid", notNull: true },
      { name: "status", type: "text", notNull: true, default: "'draft'::text" },
      { name: "config", type: "jsonb", notNull: true, default: "'{}'::jsonb" },
      { name: "creator_fee_bps_snapshot", type: "integer", notNull: true, default: "20" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "updated_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "archived_at", type: "timestamp with time zone" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (strategy_id, subscriber_privy_user_id)"],
    checks: [
      "check (jsonb_typeof(config) = 'object')",
      "check (creator_fee_bps_snapshot >= 0 and creator_fee_bps_snapshot <= 1000)",
      `check (status = any (array['draft'::text, 'active'::text, 'paused'::text,
        'stopping'::text, 'archived'::text, 'error'::text]))`
    ],
    foreignKeys: [
      "foreign key (strategy_version_id) references app_private.bot_config_versions(id) on delete restrict",
      "foreign key (wallet_id) references app_private.trading_wallets(id) on delete set null"
    ]
  },

  "app_private.call_executions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "call_id", type: "uuid", notNull: true },
      { name: "subscription_id", type: "uuid", notNull: true },
      { name: "claim_token", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "status", type: "text", notNull: true },
      { name: "amount_sol", type: "numeric", notNull: true },
      { name: "tx_signature", type: "text" },
      { name: "error", type: "text" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "updated_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "finished_at", type: "timestamp with time zone" },
      { name: "submitted_at", type: "timestamp with time zone" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (call_id, subscription_id)"],
    checks: [
      "check (amount_sol >= 0::numeric)",
      `check (status = any (array['claimed'::text, 'submitted'::text, 'succeeded'::text,
        'failed'::text, 'skipped'::text]))`
    ],
    foreignKeys: [
      "foreign key (subscription_id) references public.subscriptions(id) on delete cascade"
    ],
    uniqueIndexes: [
      `create unique index call_executions_signature_unique
         on app_private.call_executions (tx_signature) where tx_signature is not null`
    ]
  },

  "app_private.copy_executions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "subscription_id", type: "uuid", notNull: true },
      { name: "leader_wallet", type: "text", notNull: true },
      { name: "mint", type: "text", notNull: true },
      { name: "dedupe_key", type: "text", notNull: true },
      { name: "claim_token", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "status", type: "text", notNull: true },
      { name: "amount_sol", type: "numeric", notNull: true },
      { name: "tx_signature", type: "text" },
      { name: "error", type: "text" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "updated_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "submitted_at", type: "timestamp with time zone" },
      { name: "finished_at", type: "timestamp with time zone" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (subscription_id, dedupe_key)"],
    checks: [
      "check (amount_sol >= 0::numeric)",
      `check (status = any (array['claimed'::text, 'submitted'::text, 'succeeded'::text,
        'failed'::text, 'skipped'::text]))`
    ],
    foreignKeys: [
      "foreign key (subscription_id) references public.copy_subscriptions(id) on delete cascade"
    ],
    uniqueIndexes: [
      `create unique index copy_executions_signature_unique
         on app_private.copy_executions (tx_signature) where tx_signature is not null`
    ]
  }
};

/** `create table` DDL for one captured table, in production's exact column shape. */
export function renderTable(qualifiedName) {
  const table = PRODUCTION_TABLES[qualifiedName];
  if (!table) throw new Error(`no captured production shape for ${qualifiedName}`);

  const parts = table.columns.map((column) => {
    const bits = [`  ${column.name} ${column.type}`];
    if (column.default !== undefined) bits.push(`default ${column.default}`);
    if (column.notNull) bits.push("not null");
    return bits.join(" ");
  });
  if (table.primaryKey) parts.push(`  ${table.primaryKey}`);
  for (const unique of table.uniques || []) parts.push(`  ${unique}`);
  for (const check of table.checks || []) parts.push(`  ${check}`);
  for (const fk of table.foreignKeys || []) parts.push(`  ${fk}`);

  const indexes = (table.uniqueIndexes || []).map((sql) => `${sql};`).join("\n");
  return `create table ${qualifiedName} (\n${parts.join(",\n")}\n);\n${indexes}`;
}

/** DDL for several captured tables, in the order given (respect FK order). */
export function renderTables(qualifiedNames) {
  return qualifiedNames.map(renderTable).join("\n\n");
}

/**
 * Fail if the live fixture drifted from the captured production shape.
 *
 * Guards against a fixture being edited by hand after `renderTable()` produced it, and
 * against a migration silently altering a column type it was not meant to touch.
 */
export async function assertSchemaParity(db, qualifiedNames, assert) {
  for (const qualifiedName of qualifiedNames) {
    const [schema, name] = qualifiedName.split(".");
    const { rows } = await db.query(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = $1 and table_name = $2`,
      [schema, name]
    );
    const actual = new Map(rows.map((row) => [row.column_name, row]));
    for (const column of PRODUCTION_TABLES[qualifiedName].columns) {
      const live = actual.get(column.name);
      assert.ok(live, `${qualifiedName}.${column.name} is missing from the fixture`);
      assert.equal(
        live.data_type, column.type,
        `${qualifiedName}.${column.name} is ${live.data_type} in the fixture but ` +
        `${column.type} in production`
      );
      assert.equal(
        live.is_nullable === "NO", Boolean(column.notNull),
        `${qualifiedName}.${column.name} nullability does not match production`
      );
    }
  }
}
