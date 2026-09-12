-- Rollback of degenaration-subscriber-config-versioning.sql
--
-- Drops exactly what that migration added: one table, nine columns across three
-- subscription tables, three indexes, nine functions and eleven triggers. Nothing needs
-- reapplying afterwards — every object here was new, so there is no earlier definition to
-- restore.
--
-- Order is deliberate: triggers before the functions they call, columns before the table
-- their foreign keys point at. Reversing that order fails with a dependency error partway
-- through and leaves the schema in neither state.
--
-- Rerun-safe: every statement is `if exists`, so running this twice is a no-op.
--
-- REFUSES rather than destroys. If any subscriber config version has been written, this
-- script stops before dropping anything, because dropping the table would take the exact
-- configuration snapshot an open position was opened under with it. Override deliberately
-- with:  set local degenaration.force_rollback = 'on';

do $$
declare
  v_versions bigint := 0;
begin
  if coalesce(current_setting('degenaration.force_rollback', true), '') = 'on' then
    return;
  end if;
  if to_regclass('app_private.subscriber_config_versions') is null then
    return; -- migration was never applied, or this rollback already ran
  end if;
  execute 'select count(*) from app_private.subscriber_config_versions' into v_versions;
  if v_versions > 0 then
    raise exception
      'refusing to roll back: % subscriber config version(s) exist and would be destroyed. '
      'Executions referencing them would lose the configuration they were opened under. '
      'To proceed anyway: set local degenaration.force_rollback = ''on'';', v_versions
      using errcode = '55006';
  end if;
end
$$;

-- 1. Triggers, before the functions they execute.
drop trigger if exists copy_executions_config_snapshot on app_private.copy_executions;
drop trigger if exists call_executions_config_snapshot on app_private.call_executions;
drop trigger if exists kol_subscriptions_config_version_update on app_private.kol_subscriptions;
drop trigger if exists kol_subscriptions_config_version_insert on app_private.kol_subscriptions;
drop trigger if exists copy_subscriptions_config_version_update on public.copy_subscriptions;
drop trigger if exists copy_subscriptions_config_version_insert on public.copy_subscriptions;
drop trigger if exists subscriptions_config_version_update on public.subscriptions;
drop trigger if exists subscriptions_config_version_insert on public.subscriptions;
drop trigger if exists subscriber_config_versions_immutable
  on app_private.subscriber_config_versions;

-- 2. Functions. Signatures are spelled out so a future overload cannot be dropped by
--    accident, and so this fails loudly if a signature ever changes underneath it.
drop function if exists app_private.attach_copy_execution_config();
drop function if exists app_private.attach_call_execution_config();
drop function if exists app_private.version_kol_subscription();
drop function if exists app_private.version_wallet_copy_subscription();
drop function if exists app_private.version_discord_subscription();
drop function if exists app_private.create_subscriber_config_version(
  text, uuid, text, uuid, jsonb, text
);
drop function if exists app_private.subscriber_config_valid(jsonb, text);
drop function if exists app_private.legacy_subscriber_config(
  text, text, numeric, numeric, integer, numeric, integer, numeric,
  integer, integer, boolean, boolean
);
drop function if exists app_private.reject_subscriber_config_mutation();

-- 3. Indexes on the added columns, before the columns.
drop index if exists app_private.copy_executions_subscriber_config_idx;
drop index if exists app_private.call_executions_subscriber_config_idx;
drop index if exists app_private.kol_subscriptions_subscriber_config_version_idx;
drop index if exists public.copy_subscriptions_subscriber_config_version_idx;
drop index if exists public.subscriptions_subscriber_config_version_idx;

-- 4. The added columns. These carry the foreign keys into subscriber_config_versions, so
--    they must go before the table itself.
--
--    The two execution tables are easy to miss: the migration adds columns to FIVE tables,
--    not the three subscription tables its opening `alter table` block names. Leaving these
--    behind would strand a foreign key into a table step 5 then tries to drop.
alter table app_private.copy_executions
  drop column if exists subscriber_config_snapshot,
  drop column if exists subscriber_config_version_id;

alter table app_private.call_executions
  drop column if exists subscriber_config_snapshot,
  drop column if exists subscriber_config_version_id;

alter table app_private.kol_subscriptions
  drop column if exists kill_switch,
  drop column if exists subscriber_config_snapshot,
  drop column if exists subscriber_config_version_id;

alter table public.copy_subscriptions
  drop column if exists kill_switch,
  drop column if exists subscriber_config_snapshot,
  drop column if exists subscriber_config_version_id;

alter table public.subscriptions
  drop column if exists kill_switch,
  drop column if exists subscriber_config_snapshot,
  drop column if exists subscriber_config_version_id;

-- 5. The table last. Its own index goes with it.
drop table if exists app_private.subscriber_config_versions;
