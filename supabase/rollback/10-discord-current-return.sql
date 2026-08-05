-- Rollback of degenaration-discord-current-return.sql
--
-- Nothing to drop. The migration is a single `create or replace function` for
-- public.app_public_list_discord_marketplace(text, text, text, integer) at an unchanged arity
-- of 4, with no table DDL and no DML. It is read-only: it computes aggregates from rows other
-- code writes.
--
-- The restore is the reapply step in supabase/rollback/plan.mjs:
--
--     degenaration-discord-call-performance.sql
--
-- Rolling back loses four response fields — averageCurrentX, medianCurrentX, currentWinRate
-- and measuredCurrent. The marketplace card and the source detail page both render them as
-- "Collecting data" when absent, so the surfaces degrade rather than break.
--
-- READ THIS BEFORE ROLLING BACK. Reverting leaves every return figure on those surfaces
-- derived from PEAK multiples with no current-return counterpart, which is how a source
-- whose calls all round-tripped to zero reads as "Average return 2.00x, Win rate 100%".
-- Max drawdown still encodes the round trip, so the information stays derivable, but it is
-- no longer reported.

do $$
begin
  if to_regprocedure('public.app_public_list_discord_marketplace(text, text, text, integer)') is null then
    raise notice 'app_public_list_discord_marketplace is absent; nothing to restore';
  end if;
end
$$;
