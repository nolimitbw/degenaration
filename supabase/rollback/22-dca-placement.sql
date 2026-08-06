-- Rollback of degenaration-dca-placement.sql
--
-- REFUSES if any DCA level has been placed. `filled_dca_levels` is the only record of which
-- configured levels a position has already bought; dropping it makes every one of them look
-- unplaced, and a worker on the restored build would buy the whole ladder again into positions
-- that already hold it.
--
-- Override deliberately with:
--     set local degenaration.force_rollback = 'on';
--
-- The guard is separate statements with a dynamic count, NOT one IF condition with a subquery:
-- PL/pgSQL plans an IF as a single SQL expression, so referencing the column there would fail
-- at plan time on the rerun after the drop. Migration 21's guard was written the wrong way
-- first and verify:migration-rollback caught it.

do $$
declare
  v_filled bigint := 0;
begin
  if coalesce(current_setting('degenaration.force_rollback', true), '') = 'on' then
    return;
  end if;
  if to_regclass('public.positions') is null then
    return;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'positions' and column_name = 'filled_dca_levels'
  ) then
    return; -- never applied, or this rollback already ran
  end if;
  execute 'select count(*) from public.positions where jsonb_array_length(coalesce(filled_dca_levels, ''[]''::jsonb)) > 0'
    into v_filled;
  if v_filled > 0 then
    raise exception
      'refusing to roll back: % position(s) have DCA levels placed. Dropping this column makes '
      'them look unplaced, and the restored worker would buy the whole ladder again into '
      'positions that already hold it. '
      'To proceed anyway: set local degenaration.force_rollback = ''on'';', v_filled
      using errcode = '55006';
  end if;
end
$$;

drop function if exists public.worker_record_dca_fill(uuid, integer, numeric, numeric, text);
alter table public.positions drop column if exists filled_dca_levels;

-- WHAT ROLLING THIS BACK MEANS. The four dca.* controls return to persisted-but-unplaced: the
-- builder keeps counting them into the minimum planned capital it tells the user to fund, and
-- nothing ever spends it. No exit path, position or ledger is otherwise affected.
