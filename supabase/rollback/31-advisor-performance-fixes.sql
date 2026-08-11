drop policy if exists "own positions" on public.positions;
create policy "own positions" on public.positions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop index if exists app_private.call_performance_milestones_scan_idx;
drop index if exists app_private.discord_owner_link_sessions_completed_by_idx;
drop index if exists app_private.discord_owner_link_sessions_source_group_idx;
drop index if exists app_private.discord_ownership_events_link_session_idx;
drop index if exists app_private.subscriber_config_versions_creator_config_idx;
drop index if exists public.public_positions_user_idx;
