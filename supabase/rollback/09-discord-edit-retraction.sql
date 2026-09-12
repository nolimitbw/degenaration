-- Rollback of degenaration-discord-edit-retraction.sql
--
-- Nothing to drop. The migration is a single `create or replace function` for
-- public.bot_ingest_discord_signal_v2 at an unchanged arity of 17, with no table DDL and no
-- DML. It only moves WHEN the edit-supersede UPDATE runs, and adds `retractedCalls` to the
-- response.
--
-- The restore is the reapply step in supabase/rollback/plan.mjs:
--
--     degenaration-discord-signal-ingestion.sql
--
-- READ THIS BEFORE ROLLING BACK. Reverting restores the unconditional supersede, so an edit
-- that names a token the same source called within the last sixty seconds retracts the call
-- it was replacing and records no successor — while returning `accepted: false, status:
-- "duplicate"`, which tells the caller nothing happened. A measured call disappears from the
-- source's record with no audit trail.
--
-- Calls already retracted by the previous behaviour are NOT restored by this rollback, and
-- cannot be: `deleted_at` and `rejection_reason` do not record whether the supersession that
-- set them ever completed. Production has none — public.calls holds one row, from a 2026-07-18
-- /alpha command — so there is nothing to repair today, but that is a property of the empty
-- journal rather than of this rollback.

do $$
begin
  if to_regprocedure('public.bot_ingest_discord_signal_v2(text, text, text, text, text, numeric, numeric, numeric, text, text, text, text, text, timestamptz, text, integer, text)') is null then
    raise notice 'bot_ingest_discord_signal_v2 is absent; nothing to restore';
  end if;
end
$$;
