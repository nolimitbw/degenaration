-- Durable worker claims for limit orders and Discord call executions.

alter table public.limit_orders
  drop constraint if exists limit_orders_status_check;

alter table public.limit_orders
  add constraint limit_orders_status_check
  check (status in ('open', 'processing', 'filled', 'failed', 'cancelled')),
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

alter table public.subscriptions
  add column if not exists daily_spent_on date;

create index if not exists limit_orders_worker_queue_idx
  on public.limit_orders (status, created_at)
  where status in ('open', 'processing');

create table if not exists app_private.call_executions (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  claim_token uuid not null default gen_random_uuid(),
  status text not null check (status in ('claimed', 'succeeded', 'failed', 'skipped')),
  amount_sol numeric not null check (amount_sol >= 0),
  tx_signature text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (call_id, subscription_id)
);

create unique index if not exists call_executions_signature_unique
  on app_private.call_executions (tx_signature)
  where tx_signature is not null;

create index if not exists call_executions_subscription_idx
  on app_private.call_executions (subscription_id);

revoke all on table app_private.call_executions from public, anon, authenticated;

create or replace function public.worker_claim_limit_order(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.limit_orders%rowtype;
  v_claim uuid := gen_random_uuid();
begin
  update public.limit_orders
  set status = 'processing',
      claim_token = v_claim,
      claimed_at = now(),
      attempt_count = coalesce(attempt_count, 0) + 1,
      last_error = null
  where id = p_id and status = 'open'
  returning * into v_order;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order unavailable', 'status', 409);
  end if;

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'order', to_jsonb(v_order)
  );
end;
$$;

create or replace function public.worker_finish_limit_order(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_sig text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('filled', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid status', 'status', 400);
  end if;
  if p_status = 'filled' and nullif(trim(p_sig), '') is null then
    return jsonb_build_object('ok', false, 'error', 'signature required', 'status', 400);
  end if;

  update public.limit_orders
  set status = p_status,
      sig = case when p_status = 'filled' then trim(p_sig) else sig end,
      filled_at = case when p_status = 'filled' then now() else filled_at end,
      last_error = case when p_status = 'failed' then left(coalesce(p_error, 'execution failed'), 300) else null end
  where id = p_id
    and status = 'processing'
    and claim_token = p_claim_token;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;
  return jsonb_build_object('ok', true);
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
  v_existing app_private.call_executions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_spent numeric;
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

  if nullif(v_sub.wallet_id, '') is null or nullif(v_sub.user_pubkey, '') is null then
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
      'invalid trade limits', now()
    );
    return jsonb_build_object('ok', false, 'error', 'invalid trade limits', 'status', 422);
  end if;

  v_spent := case when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_spent, 0) else 0 end;
  if v_spent + v_sub.size_sol > v_sub.daily_cap_sol then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol,
      'daily cap reached', now()
    );
    return jsonb_build_object('ok', false, 'error', 'daily cap reached', 'status', 429);
  end if;

  update public.subscriptions
  set daily_spent = v_spent + v_sub.size_sol,
      daily_spent_on = v_day
  where id = v_sub.id;

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
    'daily_spent', v_spent + v_sub.size_sol,
    'daily_cap_sol', v_sub.daily_cap_sol
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'execution already claimed', 'status', 409);
end;
$$;

create or replace function public.worker_finish_call_execution(
  p_call_id uuid,
  p_subscription_id uuid,
  p_claim_token uuid,
  p_status text,
  p_sig text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid status', 'status', 400);
  end if;
  if p_status = 'succeeded' and nullif(trim(p_sig), '') is null then
    return jsonb_build_object('ok', false, 'error', 'signature required', 'status', 400);
  end if;

  update app_private.call_executions
  set status = p_status,
      tx_signature = case when p_status = 'succeeded' then trim(p_sig) else tx_signature end,
      error = case when p_status = 'failed' then left(coalesce(p_error, 'execution failed'), 300) else null end,
      updated_at = now(),
      finished_at = now()
  where call_id = p_call_id
    and subscription_id = p_subscription_id
    and claim_token = p_claim_token
    and status = 'claimed';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.worker_complete_call(p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select c.group_id into v_group_id
  from public.calls c
  where c.id = p_call_id and c.executed_at is null;

  if not found then
    return jsonb_build_object('ok', true, 'already_complete', true);
  end if;

  if exists (
    select 1
    from public.subscriptions s
    where s.group_id = v_group_id
      and s.enabled = true
      and not exists (
        select 1
        from app_private.call_executions e
        where e.call_id = p_call_id
          and e.subscription_id = s.id
          and e.status in ('succeeded', 'failed', 'skipped')
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'executions pending', 'status', 409);
  end if;

  update public.calls set executed_at = now()
  where id = p_call_id and executed_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.app_user_list_limit_orders(p_secret text, p_privy_user_id text)
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

  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, mint, symbol, trigger, target_usd, amount_sol, slippage_bps,
      user_pubkey, status, created_at, sig, last_error, claimed_at, attempt_count
    from public.limit_orders
    where privy_user_id = p_privy_user_id
    order by created_at desc
  ) o;
  return v_rows;
end;
$$;

revoke execute on function public.worker_claim_limit_order(uuid) from public, anon, authenticated;
grant execute on function public.worker_claim_limit_order(uuid) to service_role;
revoke execute on function public.worker_finish_limit_order(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.worker_finish_limit_order(uuid, uuid, text, text, text) to service_role;
revoke execute on function public.worker_claim_call_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_claim_call_execution(uuid, uuid) to service_role;
revoke execute on function public.worker_finish_call_execution(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.worker_finish_call_execution(uuid, uuid, uuid, text, text, text) to service_role;
revoke execute on function public.worker_complete_call(uuid) from public, anon, authenticated;
grant execute on function public.worker_complete_call(uuid) to service_role;
revoke execute on function public.app_user_list_limit_orders(text, text) from public, anon, authenticated;
grant execute on function public.app_user_list_limit_orders(text, text) to service_role;
