-- Rollback of degenaration-discord-marketplace-parity.sql
--
-- Nothing to drop. That migration contains a single `create or replace function` for
-- public.app_public_list_discord_marketplace(text, text, text, integer) plus its
-- revoke/grant block. No table DDL, no DML, and — verified by
-- npm run verify:migration-rollback — the same four-argument signature as the definition
-- it supersedes, so create-or-replace genuinely replaces rather than adding an overload.
--
-- The restore is therefore the reapply step recorded in supabase/rollback/plan.mjs:
--
--     degenaration-discord-public-profiles.sql
--
-- which reinstalls the earlier function body and its grants.
--
-- This file exists so that every migration in the package has a rollback artifact with the
-- same name shape, and so the verifier can execute a uniform sequence rather than special-
-- casing "this one is a no-op" in code that could drift from the truth.

do $$
begin
  if to_regprocedure('public.app_public_list_discord_marketplace(text, text, text, integer)')
     is null then
    raise notice 'app_public_list_discord_marketplace is absent; nothing to restore';
  end if;
end
$$;
