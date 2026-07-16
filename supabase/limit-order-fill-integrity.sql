create or replace function public.app_user_list_limit_orders(p_secret text, p_privy_user_id text)
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

  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, mint, symbol, trigger, target_usd, amount_sol, slippage_bps,
      user_pubkey, status, created_at, sig
    from public.limit_orders
    where privy_user_id = p_privy_user_id
    order by created_at desc
  ) o;
  return v_rows;
end;
$$;

create or replace function public.app_user_update_limit_order(
  p_secret text,
  p_privy_user_id text,
  p_id uuid,
  p_action text,
  p_sig text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.limit_orders
  set status = case when p_action = 'filled' then 'filled' else 'cancelled' end,
    sig = case when p_action = 'filled' then nullif(p_sig, '') else sig end,
    filled_at = case when p_action = 'filled' then now() else filled_at end
  where id = p_id and privy_user_id = p_privy_user_id and status = 'open';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.app_user_list_limit_orders(text, text) from public, anon, authenticated;
grant execute on function public.app_user_list_limit_orders(text, text) to service_role;
revoke execute on function public.app_user_update_limit_order(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.app_user_update_limit_order(text, text, uuid, text, text) to service_role;
