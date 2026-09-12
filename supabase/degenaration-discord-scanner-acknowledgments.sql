-- Per-source scanner acknowledgments for accepted Discord calls.
-- Forward-safe: existing sources default ON. No journal or financial row is rewritten.
-- Rollback: supabase/rollback/23-discord-scanner-acknowledgments.sql.

alter table public.approved_groups
  add column if not exists scanner_acknowledgments_enabled boolean not null default true;

create or replace function public.bot_approved_call_channels(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channels jsonb;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel_id', ch.channel_id,
    'group_id', a.group_id,
    'guild_id', ch.guild_id,
    'guild_name', a.group_name,
    'scanner_acknowledgments_enabled', g.scanner_acknowledgments_enabled
  ) order by ch.created_at desc), '[]'::jsonb)
  into v_channels
  from public.call_channels ch
  cross join lateral app_private.authorized_call_channel(ch.channel_id, ch.guild_id) a
  join public.approved_groups g on g.id = a.group_id
  where a.refusal is null;

  return v_channels;
end;
$$;

revoke execute on function public.bot_approved_call_channels(text) from public, anon, authenticated;
grant execute on function public.bot_approved_call_channels(text) to service_role;
