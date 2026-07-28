-- Keep transaction-producing owner actions behind controlled release gates.

create or replace function public.admin_decide_payout_v2(
  p_secret text,
  p_actor_privy_user_id text,
  p_payout_id uuid,
  p_action text,
  p_reason text,
  p_tx_signature text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  if lower(p_action) in ('processing', 'confirm') then
    select coalesce((value #>> '{}')::boolean, false) into v_enabled
    from app_private.system_flags
    where flag_key = 'payout_processing_enabled';
    if not coalesce(v_enabled, false) then
      raise exception 'payout processing is disabled' using errcode = '42501';
    end if;
  end if;

  return public.admin_decide_payout(
    p_secret,
    p_actor_privy_user_id,
    p_payout_id,
    p_action,
    p_reason,
    p_tx_signature
  );
end;
$$;

create or replace function public.admin_update_system_flag_v2(
  p_secret text,
  p_actor_privy_user_id text,
  p_flag_key text,
  p_value jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  if p_flag_key in ('mainnet_execution_enabled', 'payout_processing_enabled')
    and p_value = 'true'::jsonb then
    raise exception 'controlled deployment review required' using errcode = '42501';
  end if;

  return public.admin_update_system_flag(
    p_secret,
    p_actor_privy_user_id,
    p_flag_key,
    p_value,
    p_reason
  );
end;
$$;

revoke execute on function public.admin_decide_payout_v2(text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_payout_v2(text, text, uuid, text, text, text) to service_role;
revoke execute on function public.admin_update_system_flag_v2(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_system_flag_v2(text, text, text, jsonb, text) to service_role;
