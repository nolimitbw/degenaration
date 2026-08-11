-- Cover every foreign key reported by the Supabase advisor and prevent per-row auth.uid()
-- evaluation in the legacy public.positions policy.
-- Rollback: supabase/rollback/31-advisor-performance-fixes.sql.

create index if not exists call_performance_milestones_scan_idx
  on app_private.call_performance_milestones (scan_id);

create index if not exists discord_owner_link_sessions_completed_by_idx
  on app_private.discord_owner_link_sessions (completed_by_privy_user_id);

create index if not exists discord_owner_link_sessions_source_group_idx
  on app_private.discord_owner_link_sessions (source_group_id);

create index if not exists discord_ownership_events_link_session_idx
  on app_private.discord_ownership_events (link_session_id);

create index if not exists subscriber_config_versions_creator_config_idx
  on app_private.subscriber_config_versions (creator_config_version_id);

create index if not exists public_positions_user_idx
  on public.positions (user_id);

drop policy if exists "own positions" on public.positions;
create policy "own positions" on public.positions
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
