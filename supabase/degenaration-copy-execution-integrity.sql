-- Copy-trade execution integrity: atomic claims, durable spend, per-subscriber filters.
--
-- WHY THIS EXISTS. The wallet copy-trade path was the one execution path with no atomic
-- claim, and it carried three defects that limit orders and Discord calls did not:
--
--   1. The daily cap lived in a per-PROCESS Map, and `bumpDailySpent` PATCHed an ABSOLUTE
--      total. Two worker instances each kept their own map and overwrote each other's
--      figure, so a subscriber could spend several times their configured daily cap and the
--      loss persisted because the next read reseeded from the clobbered value.
--   2. There was no deduplication at all, so both instances mirrored the same detected buy.
--   3. `rugCheck(mint)` ran once per detected mint BEFORE the subscriber loop with no safety
--      argument, so only the baseline liquidity floor applied and every filter a user
--      configured in the builder — liquidity, market cap, mint authority, freeze authority —
--      was ignored. This is the defect B-6 closed on the Discord path, still present here.
--
-- (3) is why `copy_subscriptions` gains `extended_config`: there was no per-bot
-- configuration on this table to honour, which is why the earlier fix could not reach it.
-- Legacy rows without it stay on the platform baseline rather than being failed closed, so
-- this migration cannot silently disable an existing subscription.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Per-subscriber configuration
-- ---------------------------------------------------------------------------

alter table public.copy_subscriptions
  add column if not exists extended_config jsonb,
  add column if not exists daily_spent_on date;

-- ---------------------------------------------------------------------------
-- 2. Execution journal
-- ---------------------------------------------------------------------------

create table if not exists app_private.copy_executions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.copy_subscriptions(id) on delete cascade,
  leader_wallet text not null,
  mint text not null,
  -- Derived from the LEADER'S post-buy balance, so two worker instances observing the same
  -- holdings snapshot compute the same key and only one claim survives. A wall-clock or
  -- per-process value would differ between instances and defeat the unique index.
  dedupe_key text not null,
  claim_token uuid not null default gen_random_uuid(),
  status text not null check (status in ('claimed', 'submitted', 'succeeded', 'failed', 'skipped')),
  amount_sol numeric not null check (amount_sol >= 0),
  tx_signature text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  finished_at timestamptz,
  unique (subscription_id, dedupe_key)
);

create unique index if not exists copy_executions_signature_unique
  on app_private.copy_executions (tx_signature)
  where tx_signature is not null;

create index if not exists copy_executions_submitted_idx
  on app_private.copy_executions (submitted_at)
  where status = 'submitted';

-- Supports the cooldown lookup below.
create index if not exists copy_executions_sub_mint_idx
  on app_private.copy_executions (subscription_id, mint, created_at desc);

revoke all on table app_private.copy_executions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Claim (atomic cap reservation + dedupe + cooldown)
-- ---------------------------------------------------------------------------

create or replace function public.worker_claim_copy_execution(
  p_subscription_id uuid,
  p_leader_wallet text,
  p_mint text,
  p_dedupe_key text,
  p_cooldown_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.copy_subscriptions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_spent numeric;
  v_day date := (now() at time zone 'utc')::date;
begin
  -- FOR UPDATE serialises concurrent claimers on this subscription, which is what makes the
  -- cap reservation below atomic rather than read-then-write.
  select * into v_sub
  from public.copy_subscriptions s
  where s.id = p_subscription_id and s.enabled = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription unavailable', 'status', 409);
  end if;

  if nullif(v_sub.wallet_id, '') is null or nullif(v_sub.user_pubkey, '') is null then
    return jsonb_build_object('ok', false, 'error', 'delegated wallet unavailable', 'status', 422);
  end if;

  if coalesce(v_sub.size_sol, 0) <= 0 or coalesce(v_sub.daily_cap_sol, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid trade limits', 'status', 422);
  end if;

  -- Repeated buys of the same mint in quick succession are the leader adding to a position,
  -- not a new signal. Without this a subscriber mirrors one accumulation several times.
  if exists (
    select 1 from app_private.copy_executions e
    where e.subscription_id = p_subscription_id
      and e.mint = p_mint
      and e.status in ('claimed', 'submitted', 'succeeded')
      and e.created_at > now() - make_interval(secs => greatest(coalesce(p_cooldown_seconds, 300), 0))
  ) then
    return jsonb_build_object('ok', false, 'error', 'mint on cooldown', 'status', 409);
  end if;

  -- The daily figure is reset on the UTC-day boundary rather than by a background job, so a
  -- worker that was down over midnight still starts the new day at zero.
  v_spent := case when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_spent, 0) else 0 end;
  if v_spent + v_sub.size_sol > v_sub.daily_cap_sol then
    return jsonb_build_object('ok', false, 'error', 'daily cap reached', 'status', 429);
  end if;

  -- Reserved BEFORE the swap is built, inside the same transaction as the claim. A cap
  -- enforced after execution is not a cap.
  update public.copy_subscriptions
  set daily_spent = v_spent + v_sub.size_sol,
      daily_spent_on = v_day
  where id = v_sub.id;

  insert into app_private.copy_executions (
    subscription_id, leader_wallet, mint, dedupe_key, claim_token, status, amount_sol
  ) values (
    p_subscription_id, p_leader_wallet, p_mint, p_dedupe_key, v_claim, 'claimed', v_sub.size_sol
  );

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'subscription_id', v_sub.id,
    'privy_user_id', v_sub.privy_user_id,
    'user_pubkey', v_sub.user_pubkey,
    'wallet_id', v_sub.wallet_id,
    'size_sol', v_sub.size_sol,
    'slippage_bps', greatest(1, least(coalesce(v_sub.slippage_bps, 300), 5000))
  );
exception
  when unique_violation then
    -- Another instance claimed this exact detected buy first. Losing the race is the
    -- correct outcome; the cap reservation above is rolled back with this transaction.
    return jsonb_build_object('ok', false, 'error', 'execution already claimed', 'status', 409);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Submit and settle
-- ---------------------------------------------------------------------------

create or replace function public.worker_submit_copy_execution(
  p_subscription_id uuid,
  p_dedupe_key text,
  p_claim_token uuid,
  p_sig text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_sig), '') is null then
    return jsonb_build_object('ok', false, 'error', 'signature required', 'status', 400);
  end if;

  update app_private.copy_executions
  set status = 'submitted', tx_signature = trim(p_sig),
      submitted_at = now(), updated_at = now()
  where subscription_id = p_subscription_id
    and dedupe_key = p_dedupe_key
    and claim_token = p_claim_token
    and status = 'claimed';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.worker_settle_copy_execution(
  p_subscription_id uuid,
  p_dedupe_key text,
  p_claim_token uuid,
  p_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid status', 'status', 400);
  end if;

  update app_private.copy_executions
  set status = p_status,
      error = case when p_status = 'failed' then left(coalesce(p_error, 'execution failed'), 300) else null end,
      updated_at = now(), finished_at = now()
  where subscription_id = p_subscription_id
    and dedupe_key = p_dedupe_key
    and claim_token = p_claim_token
    and status = 'submitted'
  returning amount_sol into v_amount;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;

  -- A trade that never landed must return its cap reservation, or a run of failures
  -- consumes the user's daily budget and stops their bot for the rest of the day.
  if p_status = 'failed' and coalesce(v_amount, 0) > 0 then
    update public.copy_subscriptions
    set daily_spent = greatest(coalesce(daily_spent, 0) - v_amount, 0)
    where id = p_subscription_id
      and daily_spent_on = (now() at time zone 'utc')::date;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. One reconciler queue for both execution sources
-- ---------------------------------------------------------------------------

-- Replaces the call-only version. `source` tells the worker which settle function to call,
-- and copy rows carry the same position fields so a copy buy opens a monitored position
-- with a stop-loss exactly like a Discord call does.
create or replace function public.worker_load_submitted_executions(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
  from (
    select 'call'::text as source,
           e.call_id, e.subscription_id, null::text as dedupe_key,
           e.claim_token, e.tx_signature, e.submitted_at, e.amount_sol,
           c.mint, c.group_id,
           s.privy_user_id, s.user_pubkey, s.wallet_id, s.user_id,
           s.tp1, s.tp1_sell, s.tp2, s.tp2_sell, s.stop_loss, s.slippage_bps
    from app_private.call_executions e
    join public.calls c on c.id = e.call_id
    join public.subscriptions s on s.id = e.subscription_id
    where e.status = 'submitted'

    union all

    select 'copy'::text as source,
           null::uuid as call_id, e.subscription_id, e.dedupe_key,
           e.claim_token, e.tx_signature, e.submitted_at, e.amount_sol,
           e.mint, null::uuid as group_id,
           s.privy_user_id, s.user_pubkey, s.wallet_id, s.user_id,
           s.tp1, s.tp1_sell, s.tp2, s.tp2_sell, s.stop_loss, s.slippage_bps
    from app_private.copy_executions e
    join public.copy_subscriptions s on s.id = e.subscription_id
    where e.status = 'submitted'

    order by submitted_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return jsonb_build_object('ok', true, 'executions', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges — worker only
-- ---------------------------------------------------------------------------

revoke execute on function public.worker_claim_copy_execution(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.worker_claim_copy_execution(uuid, text, text, text, integer) to service_role;

revoke execute on function public.worker_submit_copy_execution(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.worker_submit_copy_execution(uuid, text, uuid, text) to service_role;

revoke execute on function public.worker_settle_copy_execution(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.worker_settle_copy_execution(uuid, text, uuid, text, text) to service_role;

revoke execute on function public.worker_load_submitted_executions(integer) from public, anon, authenticated;
grant execute on function public.worker_load_submitted_executions(integer) to service_role;
