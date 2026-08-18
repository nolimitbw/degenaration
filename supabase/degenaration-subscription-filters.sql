-- Per-subscription copy filters.
--
-- These are the CLIENT's own preferences about which of a source's calls they want
-- mirrored — not a platform safety gate. Every one of them is null/0 by default, which
-- means "take every call this source makes". They are enforced inside
-- worker_claim_call_execution so the decision is atomic with the claim, in the same
-- place the daily cap already lives, and every skip is written to call_executions with
-- its reason so the client can see exactly why a call passed them by.

alter table public.subscriptions
  add column if not exists min_liquidity_usd numeric,
  add column if not exists max_mcap_usd numeric,
  add column if not exists cooldown_seconds int not null default 0,
  add column if not exists skip_duplicate_mints boolean not null default true,
  add column if not exists max_open_positions int,
  add column if not exists max_calls_per_day int;

comment on column public.subscriptions.skip_duplicate_mints is
  'Do not buy a mint this subscription already bought (guards against the same token being called repeatedly).';
comment on column public.subscriptions.cooldown_seconds is
  'Minimum gap between two executed buys on this subscription. 0 = no cooldown.';

create index if not exists call_executions_sub_created_idx
  on app_private.call_executions (subscription_id, created_at desc);

-- ============================================================
-- Claim, now filter-aware
-- ============================================================
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
  v_call public.calls%rowtype;
  v_sub public.subscriptions%rowtype;
  v_existing app_private.call_executions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_spent numeric;
  v_day date := (now() at time zone 'utc')::date;
  v_skip text;
  v_skip_status integer := 422;
  v_last_started timestamptz;
  v_count integer;
begin
  select * into v_call
  from public.calls c
  where c.id = p_call_id and c.executed_at is null;

  if not found or v_call.group_id is null then
    return jsonb_build_object('ok', false, 'error', 'call unavailable', 'status', 409);
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.id = p_subscription_id
    and s.group_id = v_call.group_id
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

  -- ---- hard preconditions ----
  if nullif(v_sub.wallet_id, '') is null or nullif(v_sub.user_pubkey, '') is null then
    v_skip := 'delegated wallet unavailable';
  elsif coalesce(v_sub.size_sol, 0) <= 0 or coalesce(v_sub.daily_cap_sol, 0) <= 0 then
    v_skip := 'invalid trade limits';
  end if;

  -- ---- the client's own filters ----
  if v_skip is null and v_sub.min_liquidity_usd is not null
    and coalesce(v_call.called_liquidity_usd, 0) < v_sub.min_liquidity_usd then
    v_skip := 'below your minimum liquidity';
  end if;

  if v_skip is null and v_sub.max_mcap_usd is not null
    and v_call.called_mcap is not null and v_call.called_mcap > v_sub.max_mcap_usd then
    v_skip := 'above your maximum market cap';
  end if;

  if v_skip is null and coalesce(v_sub.skip_duplicate_mints, true) then
    if exists (
      select 1
      from app_private.call_executions e
      join public.calls c2 on c2.id = e.call_id
      where e.subscription_id = v_sub.id
        and e.status in ('claimed', 'succeeded')
        and c2.mint = v_call.mint
    ) then
      v_skip := 'you already bought this token from this source';
    end if;
  end if;

  if v_skip is null and coalesce(v_sub.cooldown_seconds, 0) > 0 then
    select max(e.created_at) into v_last_started
    from app_private.call_executions e
    where e.subscription_id = v_sub.id
      and e.status in ('claimed', 'succeeded');
    if v_last_started is not null
      and v_last_started > now() - make_interval(secs => v_sub.cooldown_seconds) then
      v_skip := 'still inside your cooldown';
      v_skip_status := 429;
    end if;
  end if;

  if v_skip is null and v_sub.max_calls_per_day is not null then
    select count(*) into v_count
    from app_private.call_executions e
    where e.subscription_id = v_sub.id
      and e.status in ('claimed', 'succeeded')
      and e.created_at >= date_trunc('day', now() at time zone 'utc');
    if v_count >= v_sub.max_calls_per_day then
      v_skip := 'daily call limit reached';
      v_skip_status := 429;
    end if;
  end if;

  -- How many positions this wallet is currently holding, across every source.
  if v_skip is null and v_sub.max_open_positions is not null then
    select count(*) into v_count
    from public.positions p
    where p.user_pubkey = v_sub.user_pubkey
      and p.status = 'open';
    if v_count >= v_sub.max_open_positions then
      v_skip := 'at your open position limit';
      v_skip_status := 429;
    end if;
  end if;

  -- ---- daily SOL cap ----
  v_spent := case when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_spent, 0) else 0 end;
  if v_skip is null and v_spent + v_sub.size_sol > v_sub.daily_cap_sol then
    v_skip := 'daily cap reached';
    v_skip_status := 429;
  end if;

  if v_skip is not null then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped',
      greatest(coalesce(v_sub.size_sol, 0), 0), v_skip, now()
    );
    return jsonb_build_object('ok', false, 'error', v_skip, 'status', v_skip_status);
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

revoke execute on function public.worker_claim_call_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_claim_call_execution(uuid, uuid) to service_role;


-- ============================================================
-- Client-facing read/write of the new filter fields
-- ============================================================
create or replace function public.app_user_list_subscriptions(p_secret text, p_privy_user_id text)
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

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  into v_rows
  from (
    select group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell, stop_loss,
      slippage_bps, daily_cap_sol, enabled,
      min_liquidity_usd, max_mcap_usd, cooldown_seconds,
      skip_duplicate_mints, max_open_positions, max_calls_per_day
    from public.subscriptions
    where privy_user_id = p_privy_user_id
    order by created_at desc
  ) s;
  return v_rows;
end;
$$;

-- Filters are optional: a key absent from the payload leaves the stored value alone on
-- update, and falls back to "take every call" on insert.
create or replace function public.app_user_upsert_subscription(
  p_secret text,
  p_privy_user_id text,
  p_group_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_row jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select id into v_id
  from public.subscriptions
  where privy_user_id = p_privy_user_id and group_id = p_group_id
  limit 1;

  if v_id is null then
    insert into public.subscriptions (
      privy_user_id, group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell,
      stop_loss, slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id,
      min_liquidity_usd, max_mcap_usd, cooldown_seconds,
      skip_duplicate_mints, max_open_positions, max_calls_per_day
    ) values (
      p_privy_user_id, p_group_id,
      (p_payload->>'size_sol')::numeric,
      (p_payload->>'tp1')::numeric,
      (p_payload->>'tp1_sell')::integer,
      (p_payload->>'tp2')::numeric,
      (p_payload->>'tp2_sell')::integer,
      (p_payload->>'stop_loss')::integer,
      (p_payload->>'slippage_bps')::integer,
      (p_payload->>'daily_cap_sol')::numeric,
      coalesce((p_payload->>'enabled')::boolean, true),
      nullif(p_payload->>'user_pubkey', ''),
      nullif(p_payload->>'wallet_id', ''),
      (p_payload->>'min_liquidity_usd')::numeric,
      (p_payload->>'max_mcap_usd')::numeric,
      coalesce((p_payload->>'cooldown_seconds')::integer, 0),
      coalesce((p_payload->>'skip_duplicate_mints')::boolean, true),
      (p_payload->>'max_open_positions')::integer,
      (p_payload->>'max_calls_per_day')::integer
    )
    returning to_jsonb(subscriptions.*) into v_row;
  else
    update public.subscriptions
    set size_sol = (p_payload->>'size_sol')::numeric,
      tp1 = (p_payload->>'tp1')::numeric,
      tp1_sell = (p_payload->>'tp1_sell')::integer,
      tp2 = (p_payload->>'tp2')::numeric,
      tp2_sell = (p_payload->>'tp2_sell')::integer,
      stop_loss = (p_payload->>'stop_loss')::integer,
      slippage_bps = (p_payload->>'slippage_bps')::integer,
      daily_cap_sol = (p_payload->>'daily_cap_sol')::numeric,
      enabled = coalesce((p_payload->>'enabled')::boolean, true),
      user_pubkey = nullif(p_payload->>'user_pubkey', ''),
      wallet_id = nullif(p_payload->>'wallet_id', ''),
      min_liquidity_usd = case when p_payload ? 'min_liquidity_usd'
        then (p_payload->>'min_liquidity_usd')::numeric else min_liquidity_usd end,
      max_mcap_usd = case when p_payload ? 'max_mcap_usd'
        then (p_payload->>'max_mcap_usd')::numeric else max_mcap_usd end,
      cooldown_seconds = case when p_payload ? 'cooldown_seconds'
        then coalesce((p_payload->>'cooldown_seconds')::integer, 0) else cooldown_seconds end,
      skip_duplicate_mints = case when p_payload ? 'skip_duplicate_mints'
        then coalesce((p_payload->>'skip_duplicate_mints')::boolean, true) else skip_duplicate_mints end,
      max_open_positions = case when p_payload ? 'max_open_positions'
        then (p_payload->>'max_open_positions')::integer else max_open_positions end,
      max_calls_per_day = case when p_payload ? 'max_calls_per_day'
        then (p_payload->>'max_calls_per_day')::integer else max_calls_per_day end
    where id = v_id
    returning to_jsonb(subscriptions.*) into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.app_user_list_subscriptions(text, text) to anon, authenticated;
grant execute on function public.app_user_upsert_subscription(text, text, uuid, jsonb) to anon, authenticated;
