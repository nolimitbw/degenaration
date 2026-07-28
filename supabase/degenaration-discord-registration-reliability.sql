-- Reliable Discord registration resubmission and owner-console ordering.

alter table public.call_channels
  add column if not exists last_submitted_at timestamptz;

update public.call_channels
set last_submitted_at = created_at
where last_submitted_at is null;

alter table public.call_channels
  alter column last_submitted_at set default now();

create index if not exists call_channels_status_submitted_idx
  on public.call_channels (status, last_submitted_at desc);

create or replace function public.bot_register_call_channel(
  p_secret text,
  p_guild_id text,
  p_guild_name text,
  p_guild_member_count integer,
  p_channel_id text,
  p_channel_name text,
  p_registered_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_guild_id is null or p_guild_id !~ '^\d{17,20}$'
    or p_channel_id is null or p_channel_id !~ '^\d{17,20}$' then
    raise exception 'invalid Discord guild or channel' using errcode = '22023';
  end if;

  insert into public.call_channels (
    guild_id,
    guild_name,
    guild_member_count,
    channel_id,
    channel_name,
    registered_by,
    status,
    permissions_checked_at,
    last_verified_at,
    last_submitted_at
  ) values (
    p_guild_id,
    nullif(left(trim(coalesce(p_guild_name, '')), 120), ''),
    case when p_guild_member_count is not null and p_guild_member_count >= 0 then p_guild_member_count end,
    p_channel_id,
    nullif(left(trim(coalesce(p_channel_name, '')), 120), ''),
    nullif(left(trim(coalesce(p_registered_by, '')), 120), ''),
    'pending',
    now(),
    now(),
    now()
  )
  on conflict (channel_id) do update set
    guild_id = excluded.guild_id,
    guild_name = excluded.guild_name,
    guild_member_count = excluded.guild_member_count,
    channel_name = excluded.channel_name,
    registered_by = excluded.registered_by,
    status = case
      when public.call_channels.status in ('rejected', 'changes_requested') then 'pending'
      else public.call_channels.status
    end,
    decision_reason = case
      when public.call_channels.status in ('rejected', 'changes_requested') then null
      else public.call_channels.decision_reason
    end,
    permissions_checked_at = now(),
    last_verified_at = now(),
    last_submitted_at = now()
  returning id, status into v_id, v_status;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end;
$$;

create or replace function public.admin_list_call_channels(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(cc) order by coalesce(cc.last_submitted_at, cc.created_at) desc),
    '[]'::jsonb
  )
  into v_rows
  from public.call_channels cc;

  return v_rows;
end;
$$;

revoke execute on function public.bot_register_call_channel(
  text, text, text, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.bot_register_call_channel(
  text, text, text, integer, text, text, text
) to service_role;

revoke execute on function public.admin_list_call_channels(text)
  from public, anon, authenticated;
grant execute on function public.admin_list_call_channels(text)
  to service_role;
