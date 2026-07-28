-- Verified-owner wrappers for legacy Discord approval flows.

create or replace function public.admin_decide_server_application_v2(
  p_secret text,
  p_actor_privy_user_id text,
  p_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous jsonb;
  v_next jsonb;
  v_result jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);
  if lower(p_action) not in ('approve', 'reject') then
    raise exception 'invalid application action' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required' using errcode = '22023';
  end if;

  select to_jsonb(a) into v_previous
  from public.server_applications a
  where a.id = p_id
  for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  v_result := public.admin_decide_server_application(p_secret, p_id, lower(p_action));
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  select to_jsonb(a) into v_next
  from public.server_applications a
  where a.id = p_id;

  insert into app_private.admin_audit_log (
    actor_privy_user_id, action, target_type, target_id, reason,
    previous_state, next_state
  ) values (
    p_actor_privy_user_id, 'discord-application.' || lower(p_action),
    'discord-application', p_id::text, left(trim(p_reason), 500),
    v_previous, v_next
  );

  return v_result;
end;
$$;

create or replace function public.admin_decide_call_channel_v2(
  p_secret text,
  p_actor_privy_user_id text,
  p_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous jsonb;
  v_next jsonb;
  v_result jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);
  if lower(p_action) not in ('approve', 'reject') then
    raise exception 'invalid channel action' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required' using errcode = '22023';
  end if;

  select to_jsonb(c) into v_previous
  from public.call_channels c
  where c.id = p_id
  for update;
  if not found then
    raise exception 'channel not found' using errcode = 'P0002';
  end if;

  v_result := public.admin_decide_call_channel(p_secret, p_id, lower(p_action));
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  update public.call_channels
  set decision_reason = left(trim(p_reason), 500)
  where id = p_id;

  select to_jsonb(c) into v_next
  from public.call_channels c
  where c.id = p_id;

  insert into app_private.admin_audit_log (
    actor_privy_user_id, action, target_type, target_id, reason,
    previous_state, next_state
  ) values (
    p_actor_privy_user_id, 'discord-channel.' || lower(p_action),
    'discord-channel', p_id::text, left(trim(p_reason), 500),
    v_previous, v_next
  );

  return v_result;
end;
$$;

revoke execute on function public.admin_decide_server_application_v2(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_server_application_v2(text, text, uuid, text, text) to service_role;
revoke execute on function public.admin_decide_call_channel_v2(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_call_channel_v2(text, text, uuid, text, text) to service_role;
