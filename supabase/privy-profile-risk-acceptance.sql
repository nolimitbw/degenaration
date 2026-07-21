-- Persist the risk disclosure against the authenticated Privy profile.

create or replace function public.app_user_set_risk_acceptance(
  p_secret text,
  p_privy_user_id text,
  p_accepted boolean
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
  if nullif(trim(p_privy_user_id), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid user', 'status', 400);
  end if;

  insert into public.privy_profiles (privy_user_id, risk_accepted, updated_at)
  values (p_privy_user_id, coalesce(p_accepted, false), now())
  on conflict (privy_user_id) do update set
    risk_accepted = excluded.risk_accepted,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.app_user_set_risk_acceptance(text, text, boolean) from public, anon, authenticated;
grant execute on function public.app_user_set_risk_acceptance(text, text, boolean) to service_role;
