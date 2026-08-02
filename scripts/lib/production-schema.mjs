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

// The worker's live position ledger. Distinct from app_private.positions, which the
// Portfolio and PnL cards read and which no code path writes. See OPEN_BLOCKERS I-1.
Object.assign(PRODUCTION_TABLES, {
  "public.positions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "user_id", type: "uuid" },
      { name: "user_pubkey", type: "text", notNull: true },
      { name: "wallet_id", type: "text" },
      { name: "mint", type: "text", notNull: true },
      { name: "entry_price_usd", type: "numeric", notNull: true },
      { name: "amount_raw", type: "numeric", notNull: true },
      { name: "tp1", type: "numeric" },
      { name: "tp1_sell", type: "integer", default: "50" },
      { name: "tp2", type: "numeric" },
      { name: "tp2_sell", type: "integer", default: "25" },
      { name: "stop_loss", type: "integer" },
      { name: "slippage_bps", type: "integer", notNull: true, default: "300" },
      { name: "filled_tp1", type: "boolean", notNull: true, default: "false" },
      { name: "filled_tp2", type: "boolean", notNull: true, default: "false" },
      { name: "status", type: "text", notNull: true, default: "'open'::text" },
      { name: "entry_sig", type: "text" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "closed_at", type: "timestamp with time zone" },
      { name: "privy_user_id", type: "text" },
      { name: "group_id", type: "uuid" },
      { name: "original_amount_raw", type: "numeric" },
      { name: "pending_exit_kind", type: "text" },
      { name: "pending_exit_sig", type: "text" },
      { name: "pending_exit_amount_raw", type: "numeric" },
      { name: "pending_exit_claim_token", type: "uuid" },
      { name: "pending_exit_at", type: "timestamp with time zone" },
      { name: "exit_attempts", type: "integer", notNull: true, default: "0" },
      { name: "last_exit_error", type: "text" }
    ],
    primaryKey: "primary key (id)",
    checks: [
      `check (amount_raw >= 0::numeric and coalesce(original_amount_raw, 0::numeric) >= 0::numeric
        and coalesce(pending_exit_amount_raw, 0::numeric) >= 0::numeric)`,
      "check ((status = 'exiting'::text) = (pending_exit_claim_token is not null))",
      "check (pending_exit_kind is null or pending_exit_kind = any (array['SL'::text, 'TP1'::text, 'TP2'::text]))",
      "check (status = any (array['open'::text, 'exiting'::text, 'closed'::text, 'error'::text]))"
    ],
    uniqueIndexes: [
      `create unique index positions_entry_sig_unique
         on public.positions (entry_sig) where entry_sig is not null`
    ]
  }
});

// ---- Discord marketplace ----
// public.calls and public.call_channels carry NO foreign key to approved_groups in
// production, so none is declared here. The previous hand-written fixture added one,
// which meant orphaned calls — which production permits — were never exercised.

Object.assign(PRODUCTION_TABLES, {
  "public.approved_groups": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "name", type: "text", notNull: true },
      { name: "discord_channel_id", type: "text" },
      { name: "members", type: "text" },
      { name: "win_rate", type: "integer" },
      { name: "pnl_30d", type: "text" },
      { name: "tag", type: "text" },
      { name: "active", type: "boolean", notNull: true, default: "true" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "discord_guild_id", type: "text" },
      { name: "public_slug", type: "text" },
      { name: "referral_code", type: "text" },
      { name: "bio", type: "text" },
      { name: "avatar_url", type: "text" },
      { name: "discord_invite_url", type: "text" },
      { name: "server_application_id", type: "uuid" },
      { name: "owner_privy_user_id", type: "text" },
      { name: "creator_fee_bps", type: "integer", notNull: true, default: "70" },
      { name: "verification_status", type: "text", notNull: true, default: "'approved'::text" },
      { name: "last_verified_at", type: "timestamp with time zone" },
      { name: "suspended_at", type: "timestamp with time zone" },
      { name: "removed_at", type: "timestamp with time zone" },
      { name: "removal_reason", type: "text" },
      { name: "banner_url", type: "text" },
      { name: "discord_description", type: "text" },
      { name: "owner_display_name", type: "text" },
      { name: "marketplace_visible", type: "boolean", notNull: true, default: "true" },
      { name: "integration_health", type: "text", notNull: true, default: "'pending'::text" },
      { name: "profile_synced_at", type: "timestamp with time zone" },
      { name: "profile_sync_failed_at", type: "timestamp with time zone" },
      { name: "profile_sync_error", type: "text" },
      // NOT NULL DEFAULT now() in production. A nullable fixture column made the
      // seven-day integration grace window unreachable, because coalesce(null, null)
      // >= now() - interval '7 days' is NULL, never true.
      { name: "profile_sync_grace_started_at", type: "timestamp with time zone", notNull: true, default: "now()" }
    ],
    primaryKey: "primary key (id)",
    checks: [
      "check (creator_fee_bps >= 0 and creator_fee_bps <= 1000)",
      `check (integration_health = any (array['pending'::text, 'healthy'::text,
        'degraded'::text, 'unavailable'::text]))`,
      `check (verification_status = any (array['pending'::text, 'approved'::text,
        'suspended'::text, 'removed'::text]))`
    ]
  },

  "public.calls": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "group_id", type: "uuid" },
      { name: "group_name", type: "text" },
      { name: "caller", type: "text" },
      { name: "mint", type: "text", notNull: true },
      { name: "symbol", type: "text" },
      { name: "called_mcap", type: "numeric" },
      { name: "peak_mcap", type: "numeric" },
      { name: "called_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "message_id", type: "text" },
      { name: "raw", type: "text" },
      { name: "executed_at", type: "timestamp with time zone" },
      { name: "channel_id", type: "text" },
      { name: "channel_name", type: "text" },
      { name: "confidence", type: "text" },
      { name: "called_price_usd", type: "numeric" },
      { name: "peak_price_usd", type: "numeric" },
      { name: "latest_price_usd", type: "numeric" },
      { name: "latest_mcap", type: "numeric" },
      { name: "called_liquidity_usd", type: "numeric" },
      { name: "latest_liquidity_usd", type: "numeric" },
      { name: "last_scanned_at", type: "timestamp with time zone" },
      { name: "parser_version", type: "text" },
      { name: "parser_confidence", type: "numeric" },
      { name: "parse_status", type: "text", notNull: true, default: "'accepted'::text" },
      { name: "rejection_reason", type: "text" },
      { name: "raw_event_id", type: "uuid" },
      { name: "parsed_signal_id", type: "uuid" },
      { name: "edited_at", type: "timestamp with time zone" },
      { name: "deleted_at", type: "timestamp with time zone" }
    ],
    primaryKey: "primary key (id)"
  },

  "public.call_channels": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "guild_id", type: "text", notNull: true },
      { name: "guild_name", type: "text" },
      { name: "channel_id", type: "text", notNull: true },
      { name: "channel_name", type: "text" },
      { name: "group_id", type: "uuid" },
      { name: "registered_by", type: "text" },
      { name: "status", type: "text", notNull: true, default: "'pending'::text" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "guild_member_count", type: "integer" },
      { name: "approved_at", type: "timestamp with time zone" },
      { name: "owner_privy_user_id", type: "text" },
      { name: "permissions_checked_at", type: "timestamp with time zone" },
      { name: "last_verified_at", type: "timestamp with time zone" },
      { name: "decision_reason", type: "text" },
      { name: "removed_at", type: "timestamp with time zone" },
      { name: "last_submitted_at", type: "timestamp with time zone", default: "now()" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (channel_id)"],
    checks: [
      "check (guild_member_count is null or guild_member_count >= 0)",
      `check (status = any (array['pending'::text, 'changes_requested'::text,
        'approved'::text, 'rejected'::text, 'suspended'::text, 'removed'::text]))`
    ]
  },

  "app_private.performance_snapshots": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "subject_type", type: "text", notNull: true },
      { name: "subject_id", type: "text", notNull: true },
      { name: "period", type: "text", notNull: true },
      { name: "as_of", type: "timestamp with time zone", notNull: true },
      { name: "sample_size", type: "integer", notNull: true, default: "0" },
      { name: "net_pnl_lamports", type: "bigint" },
      { name: "realized_pnl_lamports", type: "bigint" },
      { name: "volume_lamports", type: "bigint" },
      { name: "network_fees_lamports", type: "bigint" },
      { name: "platform_fees_lamports", type: "bigint" },
      { name: "creator_fees_lamports", type: "bigint" },
      { name: "max_drawdown_bps", type: "integer" },
      { name: "win_rate_bps", type: "integer" },
      { name: "metrics", type: "jsonb", notNull: true, default: "'{}'::jsonb" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (subject_type, subject_id, period, as_of)"],
    checks: [
      "check (period = any (array['1d'::text, '7d'::text, '30d'::text, '3m'::text, 'all'::text]))",
      "check (sample_size >= 0)",
      `check (subject_type = any (array['discord-source'::text, 'kol-strategy'::text,
        'bot'::text, 'portfolio'::text]))`
    ]
  },

  "app_private.trade_executions": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "intent_id", type: "uuid", notNull: true },
      { name: "owner_privy_user_id", type: "text", notNull: true },
      { name: "execution_mode", type: "text", notNull: true },
      { name: "status", type: "text", notNull: true, default: "'created'::text" },
      { name: "attempt", type: "integer", notNull: true, default: "1" },
      { name: "tx_signature", type: "text" },
      { name: "slot", type: "bigint" },
      { name: "gross_notional_lamports", type: "bigint", notNull: true, default: "0" },
      { name: "network_fee_lamports", type: "bigint", notNull: true, default: "0" },
      { name: "priority_fee_lamports", type: "bigint", notNull: true, default: "0" },
      { name: "platform_fee_lamports", type: "bigint", notNull: true, default: "0" },
      { name: "creator_fee_lamports", type: "bigint", notNull: true, default: "0" },
      { name: "platform_fee_bps_snapshot", type: "integer", notNull: true, default: "0" },
      { name: "creator_fee_bps_snapshot", type: "integer", notNull: true, default: "0" },
      { name: "creator_privy_user_id_snapshot", type: "text" },
      { name: "source_group_id_snapshot", type: "uuid" },
      { name: "strategy_id_snapshot", type: "uuid" },
      { name: "submitted_at", type: "timestamp with time zone" },
      { name: "confirmed_at", type: "timestamp with time zone" },
      { name: "reconciled_at", type: "timestamp with time zone" },
      { name: "error_code", type: "text" },
      { name: "error_message", type: "text" },
      { name: "correlation_id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "updated_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "referral_fee_lamports", type: "bigint", notNull: true, default: "0" },
      { name: "referral_share_bps_snapshot", type: "integer", notNull: true, default: "0" },
      { name: "referrer_privy_user_id_snapshot", type: "text" },
      // GENERATED ALWAYS ... STORED in production. The balance identity
      // creator + referral + retained === platform_fee holds by construction, so this
      // column must never be written. Emitting it as a plain DEFAULT would be a lie the
      // fixture could not even execute — a DEFAULT cannot reference another column.
      {
        name: "retained_fee_lamports", type: "bigint", generated: true,
        expression: "((platform_fee_lamports - creator_fee_lamports) - referral_fee_lamports)"
      }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (intent_id, attempt)"],
    checks: [
      "check (attempt > 0)",
      "check (creator_fee_bps_snapshot >= 0 and creator_fee_bps_snapshot <= 10000)",
      "check (creator_fee_lamports >= 0)",
      "check (execution_mode = any (array['paper'::text, 'solana-devnet'::text, 'solana-mainnet'::text]))",
      "check (gross_notional_lamports >= 0)",
      "check (network_fee_lamports >= 0)",
      "check (platform_fee_bps_snapshot >= 0 and platform_fee_bps_snapshot <= 10000)",
      "check (platform_fee_lamports >= 0)",
      "check (priority_fee_lamports >= 0)",
      "check (referral_fee_lamports >= 0)",
      "check (referral_share_bps_snapshot >= 0 and referral_share_bps_snapshot <= 10000)",
      `check (status = any (array['created'::text, 'submitted'::text, 'confirmed'::text,
        'reconciled'::text, 'failed'::text, 'dropped'::text, 'expired'::text]))`
    ]
  },

  "app_private.commission_ledger_entries": {
    columns: [
      { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "account_owner_privy_user_id", type: "text" },
      { name: "account_type", type: "text", notNull: true },
      { name: "source_type", type: "text", notNull: true },
      { name: "source_id", type: "text" },
      { name: "execution_id", type: "uuid" },
      { name: "payout_request_id", type: "uuid" },
      { name: "amount_lamports", type: "bigint", notNull: true },
      { name: "rate_bps", type: "integer" },
      { name: "gross_notional_lamports", type: "bigint" },
      { name: "available_at", type: "timestamp with time zone", notNull: true, default: "now()" },
      { name: "idempotency_key", type: "text", notNull: true },
      { name: "correlation_id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
      { name: "metadata", type: "jsonb", notNull: true, default: "'{}'::jsonb" },
      { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" }
    ],
    primaryKey: "primary key (id)",
    uniques: ["unique (idempotency_key)"],
    checks: [
      "check (account_type = any (array['creator'::text, 'platform'::text, 'referral'::text]))",
      "check (amount_lamports <> 0)",
      "check (gross_notional_lamports is null or gross_notional_lamports >= 0)",
      `check ((account_type = any (array['creator'::text, 'referral'::text])
        and account_owner_privy_user_id is not null) or account_type = 'platform'::text)`,
      "check (rate_bps is null or (rate_bps >= 0 and rate_bps <= 10000))",
      `check (source_type = any (array['discord'::text, 'kol'::text, 'referral'::text,
        'payout'::text, 'reversal'::text, 'adjustment'::text]))`
    ]
  }
});

/** `create table` DDL for one captured table, in production's exact column shape. */
export function renderTable(qualifiedName) {
  const table = PRODUCTION_TABLES[qualifiedName];
  if (!table) throw new Error(`no captured production shape for ${qualifiedName}`);

  const parts = table.columns.map((column) => {
    const bits = [`  ${column.name} ${column.type}`];
    if (column.generated) bits.push(`generated always as ${column.expression} stored`);
    else if (column.default !== undefined) bits.push(`default ${column.default}`);
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
