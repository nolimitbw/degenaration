-- Rollback of degenaration-exit-plan-state.sql
--
-- THIS IS THE ONE THAT WAS BROKEN.
--
-- The migration's header said "Rollback: reapply those two files". That is wrong, and
-- npm run verify:migration-rollback proves it with a control run. The migration widens
--
--     public.worker_open_position          15 -> 16 arguments  (adds p_entry_config)
--     public.worker_settle_position_exit     8 ->  9 arguments  (adds p_filled_levels)
--
-- and `create or replace function` at a DIFFERENT argument count creates an OVERLOAD, not
-- a replacement. So reapplying the predecessors on their own leaves both arities installed,
-- and the worker's own call — which passes the old argument count — fails with
--
--     function public.worker_open_position(...) is not unique
--
-- That is the identical defect the forward migration was already corrected for, and it is
-- strictly worse in reverse: a rollback runs during an incident, so backing this change out
-- would leave the worker unable to open OR settle any position, with no further rollback
-- available to recover from it.
--
-- Dropping the widened signatures HERE, before the predecessors are reapplied, is the fix.
--
-- Run this script, then reapply in this order (see supabase/rollback/plan.mjs):
--     degenaration-position-exit-state.sql
--     degenaration-buy-settlement.sql
--     degenaration-copy-execution-integrity.sql
--     degenaration-position-bot-attribution.sql
--
-- All four are needed. The last two are not optional tidiness: position-bot-attribution
-- restores the 15-argument worker_open_position body, and copy-execution-integrity restores
-- a worker_load_submitted_executions that does NOT read
-- call_executions.subscriber_config_snapshot — a column that rolling migration #1 back
-- afterwards removes.
--
-- Rerun-safe: every statement is `if exists`.

-- Check before destroying. Both conditions below would otherwise fail the reapply partway
-- through, after this script had already dropped columns and functions, leaving the schema
-- in neither state. Override deliberately with:
--     set local degenaration.force_rollback = 'on';
do $$
declare
  v_levels bigint := 0;
  v_plans  bigint := 0;
begin
  if coalesce(current_setting('degenaration.force_rollback', true), '') = 'on' then
    return;
  end if;
  if to_regclass('public.positions') is null then
    return;
  end if;

  -- degenaration-position-exit-state.sql restores a CHECK admitting only 'SL','TP1','TP2'.
  -- A position parked on TP3 or above would make that ALTER fail.
  execute $q$
    select count(*) from public.positions
    where pending_exit_kind is not null
      and pending_exit_kind not in ('SL', 'TP1', 'TP2')
  $q$ into v_levels;
  if v_levels > 0 then
    raise exception
      'refusing to roll back: % position(s) hold an exit level the pre-migration CHECK '
      'cannot express (only SL, TP1, TP2). Settle or clear them first, or override with '
      'set local degenaration.force_rollback = ''on'';', v_levels
      using errcode = '55006';
  end if;

  -- entry_config is the immutable exit plan an open position was opened under. Dropping
  -- the column discards it, and it cannot be reconstructed from the bot, because the bot
  -- may have been edited since.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'positions' and column_name = 'entry_config'
  ) then
    execute $q$
      select count(*) from public.positions
      where entry_config is not null and entry_config <> '{}'::jsonb
    $q$ into v_plans;
    if v_plans > 0 then
      raise exception
        'refusing to roll back: % position(s) carry an entry_config exit plan that would be '
        'permanently lost. Those positions would fall back to the legacy tp1/tp2/stop_loss '
        'scalars, which cannot express their configured plan. Override with '
        'set local degenaration.force_rollback = ''on'';', v_plans
        using errcode = '55006';
    end if;
  end if;
end
$$;

-- 1. Trigger before its function.
drop trigger if exists positions_protect_entry_plan on public.positions;
drop function if exists app_private.protect_position_entry_plan();

-- 2. Functions this migration introduced outright.
drop function if exists public.worker_record_position_peak(uuid, numeric);

-- 3. THE FIX. Drop the widened arities so the reapply reinstalls a single candidate rather
--    than a second overload. Signatures are spelled out in full: `drop function` without an
--    argument list would itself fail with "function name is not unique" once both exist.
drop function if exists public.worker_open_position(
  text, text, text, numeric, numeric, text, integer, numeric, integer, numeric,
  integer, integer, text, uuid, uuid, jsonb
);
drop function if exists public.worker_settle_position_exit(
  uuid, uuid, text, numeric, boolean, boolean, integer, text, jsonb
);

-- 4. The added columns. The widened CHECK on pending_exit_kind is restored by reapplying
--    degenaration-position-exit-state.sql, which drops and re-adds it narrow — the guard
--    above is what makes that safe.
alter table public.positions
  drop column if exists filled_levels,
  drop column if exists peak_price_usd,
  drop column if exists entry_config;
