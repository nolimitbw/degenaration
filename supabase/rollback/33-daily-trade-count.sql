-- Rollback for migration 33, degenaration-daily-trade-count.sql
--
-- WHAT ROLLING BACK RESTORES
--
-- 1. No daily trade count. A bot configured to stop after ten entries takes as many as its
--    spend cap allows — fifty entries on a 1 SOL budget at a 0.02 margin.
-- 2. A UTC-midnight trading day. The spend cap reverts to resetting at 00:00 UTC rather than
--    06:00 America/New_York.
--
-- The column is dropped LAST and only after the function is restored, so no claim can run
-- against a function that reads a column that no longer exists.
--
-- Reapply after this: supabase/degenaration-bot-entry-limits.sql, which carries the previous
-- worker_claim_call_execution body. Registered in supabase/rollback/plan.mjs.
--
-- REFUSES rather than silently losing a limit that is in force. Dropping daily_trades while a
-- subscription is mid-window discards how many entries it has already taken today, and the
-- restored function would let it take a full allowance again — the same class of error as
-- freeing capital the chain has taken. Override deliberately with
--   set local degenaration.force_rollback = 'on';

-- The guard runs through EXECUTE, and the column check is a separate statement from the query
-- that reads it.
--
-- PL/pgSQL plans an IF condition as a single SQL expression, so `column_exists and exists
-- (select ... from t where daily_trades > 0)` resolves daily_trades at PLAN time and fails on
-- the rerun after the drop — breaking the rerun-safety this guard is part of. Migration 21 shipped
-- exactly that bug; verify:migration-rollback caught this one before it left the branch.
do $$
declare
  v_open integer := 0;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'daily_trades'
  ) then
    execute $q$
      select count(*)::integer from public.subscriptions
      where coalesce(daily_trades, 0) > 0
        and daily_spent_on >= ((now() at time zone 'America/New_York') - interval '6 hours')::date
    $q$ into v_open;
  end if;

  if v_open > 0 and coalesce(current_setting('degenaration.force_rollback', true), 'off') <> 'on' then
    raise exception
      'refusing rollback: % subscription(s) have entries counted in the current trading day. '
      'Rolling back now would grant them a fresh allowance. Wait for the window to roll over, '
      'or set local degenaration.force_rollback = ''on'' to proceed deliberately.', v_open;
  end if;
end;
$$;

-- The predecessor body is restored by reapplying degenaration-bot-entry-limits.sql; this file
-- only removes what migration 33 added. Arity is unchanged (uuid, uuid) in both directions, so
-- there is no overload to drop.

alter table public.subscriptions drop column if exists daily_trades;
