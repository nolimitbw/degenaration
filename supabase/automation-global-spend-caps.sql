-- Reserve wallet-level automation spend inside the same transaction that claims work.

alter table public.privy_profiles
  add column if not exists daily_spent numeric not null default 0,
  add column if not exists daily_spent_on date;

alter table public.privy_profiles
  drop constraint if exists privy_profiles_daily_spent_check;

alter table public.privy_profiles
  add constraint privy_profiles_daily_spent_check check (daily_spent >= 0);

create or replace function public.worker_claim_limit_order(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.limit_orders%rowtype;
  v_profile public.privy_profiles%rowtype;
  v_claim uuid := gen_random_uuid();
  v_spent numeric;
  v_day date := (now() at time zone 'utc')::date;
begin
  select * into v_order
  from public.limit_orders o
  where o.id = p_id and o.status = 'open'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order unavailable', 'status', 409);
  end if;

  if nullif(v_order.privy_user_id, '') is null
    or nullif(v_order.wallet_id, '') is null
    or nullif(v_order.user_pubkey, '') is null
    or coalesce(v_order.amount_sol, 0) <= 0 then
    update public.limit_orders
    set last_error = 'delegated wallet or order amount unavailable'
    where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'delegated wallet or order amount unavailable', 'status', 422);
  end if;

  select * into v_profile
  from public.privy_profiles p
  where p.privy_user_id = v_order.privy_user_id
  for update;

  if not found then
    update public.limit_orders set last_error = 'wallet trade limits unavailable' where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'wallet trade limits unavailable', 'status', 422);
  end if;

  if nullif(v_profile.wallet_address, '') is null
    or v_profile.wallet_address <> v_order.user_pubkey then
    update public.limit_orders set last_error = 'wallet does not match saved trade limits' where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'wallet does not match saved trade limits', 'status', 422);
  end if;

  if v_order.amount_sol > v_profile.max_trade_sol then
    update public.limit_orders
    set last_error = left('amount exceeds max-per-trade ' || v_profile.max_trade_sol::text, 300)
    where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'max-per-trade limit reached', 'status', 422);
  end if;

  v_spent := case
    when v_profile.daily_spent_on = v_day then coalesce(v_profile.daily_spent, 0)
    else 0
  end;
  if v_spent + v_order.amount_sol > v_profile.daily_cap_sol then
    update public.limit_orders set last_error = 'wallet daily automation cap reached' where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'wallet daily automation cap reached', 'status', 429);
  end if;

  update public.privy_profiles
  set daily_spent = v_spent + v_order.amount_sol,
      daily_spent_on = v_day,
      updated_at = now()
  where privy_user_id = v_profile.privy_user_id;

  update public.limit_orders
  set status = 'processing',
      claim_token = v_claim,
      claimed_at = now(),
      attempt_count = coalesce(attempt_count, 0) + 1,
      last_error = null
  where id = p_id
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'daily_spent', v_spent + v_order.amount_sol,
    'daily_cap_sol', v_profile.daily_cap_sol,
    'order', to_jsonb(v_order)
  );
end;
$$;

create or replace function public.worker_claim_call_execution(
  p_call_id uuid,
  p_subscription_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_sub public.subscriptions%rowtype;
  v_profile public.privy_profiles%rowtype;
  v_existing app_private.call_executions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_source_spent numeric;
  v_wallet_spent numeric;
  v_day date := (now() at time zone 'utc')::date;
begin
  select c.group_id into v_group_id
  from public.calls c
  where c.id = p_call_id and c.executed_at is null;

  if not found or v_group_id is null then
    return jsonb_build_object('ok', false, 'error', 'call unavailable', 'status', 409);
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.id = p_subscription_id
    and s.group_id = v_group_id
    and s.enabled = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription unavailable', 'status', 409);
  end if;

  select * into v_existing
  from app_private.call_executions e
  where e.call_id = p_call_id and e.subscription_id = p_subscription_id;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error', 'execution already claimed',
      'status', 409,
      'execution_status', v_existing.status
    );
  end if;

  if nullif(v_sub.privy_user_id, '') is null
    or nullif(v_sub.wallet_id, '') is null
    or nullif(v_sub.user_pubkey, '') is null then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', greatest(coalesce(v_sub.size_sol, 0), 0),
      'delegated wallet unavailable', now()
    );
    return jsonb_build_object('ok', false, 'error', 'delegated wallet unavailable', 'status', 422);
  end if;

  if coalesce(v_sub.size_sol, 0) <= 0 or coalesce(v_sub.daily_cap_sol, 0) <= 0 then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', greatest(coalesce(v_sub.size_sol, 0), 0),
      'invalid source trade limits', now()
    );
    return jsonb_build_object('ok', false, 'error', 'invalid source trade limits', 'status', 422);
  end if;

  select * into v_profile
  from public.privy_profiles p
  where p.privy_user_id = v_sub.privy_user_id
  for update;

  if not found
    or nullif(v_profile.wallet_address, '') is null
    or v_profile.wallet_address <> v_sub.user_pubkey then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol,
      'wallet trade limits unavailable', now()
    );
    return jsonb_build_object('ok', false, 'error', 'wallet trade limits unavailable', 'status', 422);
  end if;

  if v_sub.size_sol > v_profile.max_trade_sol then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol,
      'max-per-trade limit reached', now()
    );
    return jsonb_build_object('ok', false, 'error', 'max-per-trade limit reached', 'status', 422);
  end if;

  v_source_spent := case
    when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_spent, 0)
    else 0
  end;
  if v_source_spent + v_sub.size_sol > v_sub.daily_cap_sol then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol,
      'source daily cap reached', now()
    );
    return jsonb_build_object('ok', false, 'error', 'source daily cap reached', 'status', 429);
  end if;

  v_wallet_spent := case
    when v_profile.daily_spent_on = v_day then coalesce(v_profile.daily_spent, 0)
    else 0
  end;
  if v_wallet_spent + v_sub.size_sol > v_profile.daily_cap_sol then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol,
      'wallet daily automation cap reached', now()
    );
    return jsonb_build_object('ok', false, 'error', 'wallet daily automation cap reached', 'status', 429);
  end if;

  update public.subscriptions
  set daily_spent = v_source_spent + v_sub.size_sol,
      daily_spent_on = v_day
  where id = v_sub.id;

  update public.privy_profiles
  set daily_spent = v_wallet_spent + v_sub.size_sol,
      daily_spent_on = v_day,
      updated_at = now()
  where privy_user_id = v_profile.privy_user_id;

  insert into app_private.call_executions (
    call_id, subscription_id, claim_token, status, amount_sol
  ) values (
    p_call_id, p_subscription_id, v_claim, 'claimed', v_sub.size_sol
  );

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'subscription_id', v_sub.id,
    'privy_user_id', v_sub.privy_user_id,
    'user_pubkey', v_sub.user_pubkey,
    'wallet_id', v_sub.wallet_id,
    'size_sol', v_sub.size_sol,
    'slippage_bps', greatest(1, least(coalesce(v_sub.slippage_bps, 300), 5000)),
    'source_daily_spent', v_source_spent + v_sub.size_sol,
    'source_daily_cap_sol', v_sub.daily_cap_sol,
    'wallet_daily_spent', v_wallet_spent + v_sub.size_sol,
    'wallet_daily_cap_sol', v_profile.daily_cap_sol
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'execution already claimed', 'status', 409);
end;
$$;

revoke execute on function public.worker_claim_limit_order(uuid) from public, anon, authenticated;
grant execute on function public.worker_claim_limit_order(uuid) to service_role;
revoke execute on function public.worker_claim_call_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_claim_call_execution(uuid, uuid) to service_role;
