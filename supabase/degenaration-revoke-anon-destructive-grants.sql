-- Revoke destructive grants from `anon` on the legacy public tables.
--
-- NOT YET APPLIED. Review, then run against the project. It is reversible (re-grant).
--
-- WHY THIS MATTERS
-- Row Level Security does not apply to TRUNCATE. Postgres checks the TRUNCATE privilege
-- and skips row policies entirely. So while every public table here has RLS enabled and
-- zero policies for `anon` — which correctly denies anon SELECT/INSERT/UPDATE/DELETE —
-- the TRUNCATE grant sits outside that protection.
--
-- Observed on the live database (2026-07-31):
--
--   table                  anon TRUNCATE   anon policies
--   trades                 true            0
--   profiles               true            0
--   journal_entries        true            0
--   subscriptions          true            0
--   daily_pnl              true            0
--   limit_orders           true            0
--   copy_subscriptions     true            0
--   wallet_pnl_snapshots   true            0
--   calls                  true            0
--   call_channels          true            0
--   server_applications    true            0
--
-- These are the broad default grants, not a deliberate choice: `approved_groups` and
-- `privy_profiles` in the same schema have no anon grants at all, so the correct posture
-- already exists here for two tables.
--
-- IS IT EXPLOITABLE TODAY? Not through the REST API. PostgREST exposes no TRUNCATE verb
-- and supabase-js has no truncate method, so there is no known path from the publishable
-- key to these statements. This is defense in depth, not an active breach — stated plainly
-- so it is not over- or under-read. The reason to fix it anyway is that RLS is currently
-- doing all the work, and it is the one operation RLS does not cover.
--
-- WHY ONLY THESE THREE PRIVILEGES
-- SELECT stays: `app/api/calls`, `app/api/call-sources` and `lib/publicSource.ts` read
-- with the publishable key, and the public-read policies on `calls` and `approved_groups`
-- are deliberate.
--
-- INSERT/UPDATE/DELETE stay: RLS already denies them for anon, so revoking changes no
-- outcome, only the error text. `lib/queries.ts` still contains client-side writes from
-- the pre-Privy architecture; they run under the `authenticated` role when a Supabase
-- session exists, and that path was not fully traced here. Removing a redundant grant is
-- not worth risking a path I did not verify.
--
-- TRUNCATE/REFERENCES/TRIGGER go: nothing in the codebase issues them (the only `truncate`
-- matches in the repo are the Tailwind CSS class), no client library can, and TRUNCATE is
-- the RLS bypass. REFERENCES and TRIGGER are schema-level privileges an application role
-- has no use for.

begin;

revoke truncate, references, trigger on table
  public.trades,
  public.profiles,
  public.journal_entries,
  public.subscriptions,
  public.daily_pnl,
  public.limit_orders,
  public.copy_subscriptions,
  public.wallet_pnl_snapshots,
  public.calls,
  public.call_channels,
  public.server_applications
from anon;

-- Stop future tables from inheriting the same grants. Without this, the next `create table`
-- in public re-introduces exactly what was just revoked.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon;

commit;

-- VERIFY (expect every row false):
--   select c.relname,
--          has_table_privilege('anon','public.'||quote_ident(c.relname),'TRUNCATE') as truncate_
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind='r' order by 1;
--
-- ROLLBACK if anything unexpected breaks:
--   grant truncate, references, trigger on all tables in schema public to anon;
