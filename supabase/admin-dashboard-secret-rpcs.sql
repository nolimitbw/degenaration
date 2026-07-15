-- Owner dashboard RPCs.
-- Replace the hash in app_private.admin_secret_ok only when rotating ADMIN_KEY.

create schema if not exists app_private;

create or replace function app_private.admin_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select p_secret is not null
    and encode(extensions.digest(p_secret, 'sha256'), 'hex') = '7492d9993c25810f58cf85945732852878335dca059c402a9c730d43312515c6'
$$;

create or replace function public.admin_list_server_applications(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(sa) order by sa.created_at desc), '[]'::jsonb)
  into v_rows
  from public.server_applications sa;

  return v_rows;
end;
$$;

create or replace function public.admin_decide_server_application(p_secret text, p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'bad action', 'status', 400);
  end if;

  update public.server_applications
  set status = case when p_action = 'approve' then 'approved' else 'rejected' end
  where id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_call_channels(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cc) order by cc.created_at desc), '[]'::jsonb)
  into v_rows
  from public.call_channels cc;

  return v_rows;
end;
$$;

create or replace function public.admin_decide_call_channel(p_secret text, p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel public.call_channels%rowtype;
  v_group_id uuid;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'bad action', 'status', 400);
  end if;

  if p_action = 'reject' then
    update public.call_channels set status = 'rejected' where id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
    end if;
    return jsonb_build_object('ok', true);
  end if;

  select * into v_channel from public.call_channels where id = p_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
  end if;

  v_group_id := v_channel.group_id;

  if v_group_id is null then
    select group_id into v_group_id
    from public.call_channels
    where guild_id = v_channel.guild_id and group_id is not null
    limit 1;
  end if;

  if v_group_id is null then
    select id into v_group_id
    from public.approved_groups
    where discord_guild_id = v_channel.guild_id
    limit 1;
  end if;

  if v_group_id is null then
    insert into public.approved_groups (name, tag, active, members, discord_guild_id)
    values (
      coalesce(nullif(v_channel.guild_name, ''), 'Discord server'),
      'Discord',
      true,
      case when v_channel.guild_member_count is not null then v_channel.guild_member_count::text else null end,
      v_channel.guild_id
    )
    returning id into v_group_id;
  end if;

  update public.call_channels
  set status = 'approved', group_id = v_group_id, approved_at = now()
  where id = p_id;

  return jsonb_build_object('ok', true, 'group_id', v_group_id);
end;
$$;

create or replace function public.admin_dashboard_summary(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total numeric;
  v_trade_count integer;
  v_pending_apps integer;
  v_pending_channels integer;
  v_approved_channels integer;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(sum(fee_sol), 0), count(*) into v_total, v_trade_count from public.trades;
  select count(*) into v_pending_apps from public.server_applications where status = 'pending';
  select count(*) into v_pending_channels from public.call_channels where status = 'pending';
  select count(*) into v_approved_channels from public.call_channels where status = 'approved';

  return jsonb_build_object(
    'commissionSol', v_total,
    'tradeCount', v_trade_count,
    'pendingApplications', v_pending_apps,
    'pendingChannels', v_pending_channels,
    'approvedChannels', v_approved_channels
  );
end;
$$;

revoke all on function public.admin_list_server_applications(text) from public;
revoke all on function public.admin_decide_server_application(text, uuid, text) from public;
revoke all on function public.admin_list_call_channels(text) from public;
revoke all on function public.admin_decide_call_channel(text, uuid, text) from public;
revoke all on function public.admin_dashboard_summary(text) from public;

grant execute on function public.admin_list_server_applications(text) to anon, authenticated;
grant execute on function public.admin_decide_server_application(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_list_call_channels(text) to anon, authenticated;
grant execute on function public.admin_decide_call_channel(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_dashboard_summary(text) to anon, authenticated;
-- Run supabase/public-source-profiles.sql after this file so approval also assigns
-- public profile and referral identities.
