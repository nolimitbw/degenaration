-- Rollback of degenaration-discord-call-performance.sql
--
-- Nothing to drop, for the same reason as 03: this migration replaces
-- public.app_public_list_discord_marketplace(text, text, text, integer) in full, at an
-- unchanged arity, with no table DDL and no DML.
--
-- The restore is the reapply step in supabase/rollback/plan.mjs:
--
--     degenaration-discord-marketplace-parity.sql
--
-- i.e. migration 3, which is the definition this one supersedes. Rolling 4 back without
-- also rolling 3 back is a supported state: 3 is a strict subset of 4's response shape,
-- so an application build expecting 4's extra fields degrades to nulls rather than
-- erroring. Rolling BOTH back returns to degenaration-discord-public-profiles.sql.
--
-- What is lost by rolling back: the -50% outcome bucket, win rate reported separately from
-- the 2x rate, best/worst call, and confirmed copied volume in integer lamports. The
-- marketplace reverts to reporting the 2x rate under the label "Win rate", which is the
-- mislabelling this migration corrected. Prefer rolling forward.

do $$
begin
  if to_regprocedure('public.app_public_list_discord_marketplace(text, text, text, integer)')
     is null then
    raise notice 'app_public_list_discord_marketplace is absent; nothing to restore';
  end if;
end
$$;
