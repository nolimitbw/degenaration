-- Privileged RPCs are server-only. Public users keep read-only access to approved sources.

revoke all on table public.approved_groups from anon, authenticated;
grant select (
  id, name, discord_channel_id, members, win_rate, pnl_30d, tag, active, created_at,
  public_slug, referral_code, bio, avatar_url, discord_invite_url
) on table public.approved_groups to anon, authenticated;

drop policy if exists "public apply" on public.server_applications;
revoke insert on table public.server_applications from anon, authenticated;

do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;
