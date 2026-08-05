-- Rollback of degenaration-registered-channel-authorization.sql
--
-- THE ARITY, AGAIN. The migration widened `bot_ingest_discord_signal_v2` from 17 arguments to
-- 18 and dropped the 17-argument signature first. Rolling back must drop the 18-argument one
-- BEFORE the reapply recreates the narrow signature, or both are installed and every call
-- raises "function is not unique" — the failure mode supabase/rollback/plan.mjs exists to
-- document, in the direction you only run during an incident.
--
-- `bot_approved_call_channels` and `admin_decide_call_channel` are replaced at unchanged
-- arities (1 and 3), so they need no drop; both bodies are restored by the reapply step in
-- supabase/rollback/plan.mjs:
--
--     degenaration-discord-signal-ingestion.sql  -- the 17-argument ingest, superseded by #9
--     degenaration-discord-edit-retraction.sql   -- #9's body, which #12 is built on
--     degenaration-discord-public-profiles.sql   -- bot_approved_call_channels
--     public-source-profiles.sql                 -- admin_decide_call_channel
--
-- WHAT ROLLING THIS BACK MEANS, IN PRODUCT TERMS
--
-- Three things stop being true:
--
--   1. The journal's gate stops checking whether the SOURCE is approved. It goes back to
--      checking the channel row alone, so an administrator removing a source no longer prevents
--      new calls from it until the listener's cached map next refreshes — and if the channel row
--      is still 'approved' for any reason, not even then.
--   2. The guild is no longer compared against the registration, so a call can be attributed to
--      a source the message did not come from with nothing able to detect it.
--   3. Approving a channel on a REMOVED source silently reinstates ingestion from it while
--      every marketplace surface keeps it hidden.
--
-- All three are silent. Prefer rolling forward.
--
-- The refusal table is dropped with the migration. Its rows are diagnostics — every one records
-- an event that was refused, so nothing that happened is lost, only the record of what did not.
-- If those rows are wanted, copy them out before running this.
--
-- Rerun-safe: every statement is `if exists`.

drop function if exists public.bot_ingest_discord_signal_v2(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text,
  text, text, timestamptz, text, integer, text, text
);

drop function if exists app_private.authorized_call_channel(text, text);

drop table if exists app_private.discord_ingestion_refusals;
