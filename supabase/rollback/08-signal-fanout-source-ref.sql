-- Rollback of degenaration-signal-fanout-source-ref.sql
--
-- Nothing to drop. The migration is a single `create or replace function` for
-- app_private.fan_out_parsed_signal(uuid) at an unchanged arity of 1, with no table DDL and
-- no DML. It only changes how the raw event's channel is resolved.
--
-- The restore is the reapply step in supabase/rollback/plan.mjs:
--
--     degenaration-signal-fanout.sql
--
-- READ THIS BEFORE ROLLING BACK. Reverting restores the broken join
-- (`ch.channel_id = rs.source_ref`) against a source_ref that ingestion writes as
-- `discord:<guild>:<channel>`, so fan-out resolves no source and every Discord call is
-- journaled as accepted while reaching zero subscribers. It fails SILENTLY: the trigger
-- discards the return value, so there is no error to notice. That is a worse state than
-- whatever prompted the rollback in almost every case — prefer rolling forward.
--
-- Deliveries already written survive. They are keyed on (parsed signal, bot) and are not
-- re-derived, so no offer already made to a bot is withdrawn or duplicated.

do $$
begin
  if to_regprocedure('app_private.fan_out_parsed_signal(uuid)') is null then
    raise notice 'fan_out_parsed_signal is absent; nothing to restore';
  end if;
end
$$;
