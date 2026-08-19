-- Durable take-profit / stop-loss exits.
--
-- WHY: entries were being executed and recorded, but nothing ever sold. The TP/SL engine
-- (server/engine/monitor.js) was never started by the worker, held positions in an
-- in-memory array, and no code path ever wrote a public.positions row. A subscriber's
-- configured exits were collected, saved and displayed, then silently ignored — a token
-- that went to zero rode to zero. This closes that.
--
-- Each exit leg (tp1 / tp2 / sl) is claimed exactly once per position, using the same
-- protocol that already keeps two workers from double-buying a call: a unique claim row
-- taken under lock, redeemed with a claim token. A crashed worker leaves a stale claim
-- rather than an unrecorded sell, which is the safe direction to fail.

-- ============================================================
-- Positions: link back to what caused them, and carry a Privy owner
-- ============================================================
alter table public.positions
  add column if not exists privy_user_id text,
  add column if not exists group_id uuid references public.approved_groups(id) on delete set null,
  add column if not exists call_id uuid references public.calls(id) on delete set null,
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null,
  add column if not exists opened_by text,
  add column if not exists last_price_usd numeric,
  add column if not exists last_checked_at timestamptz;

comment on column public.positions.opened_by is
  'Which engine opened this position: call | copy | limit | manual.';

-- One position per (call, subscription): re-running an entry cannot fork a second
-- position that would then be sold twice.
create unique index if not exists positions_call_subscription_unique
  on public.positions (call_id, subscription_id)
  where call_id is not null and subscription_id is not null;

create index if not exists positions_open_idx
  on public.positions (status, last_checked_at nulls first)
  where status = 'open';

-- ============================================================
-- Exit claims
-- ============================================================
create table if not exists app_private.position_exits (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  leg text not null check (leg in ('tp1', 'tp2', 'sl')),
  claim_token uuid not null default gen_random_uuid(),
  status text not null check (status in ('claimed', 'succeeded', 'failed')),
  amount_raw numeric not null check (amount_raw > 0),
  trigger_multiple numeric,
  tx_signature text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (position_id, leg)
);

create unique index if not exists position_exits_signature_unique
  on app_private.position_exits (tx_signature)
  where tx_signature is not null;

revoke all on table app_private.position_exits from public, anon, authenticated;

-- ============================================================
-- Open a position when an entry actually fills
-- ============================================================
-- p_amount_raw must be the CONFIRMED filled amount derived from the swap transaction,
-- not the quoted amount — selling a quantity the wallet does not hold fails on-chain.
create or replace function public.worker_open_position(
  p_call_id uuid,
  p_subscription_id uuid,
  p_mint text,
  p_entry_price_usd numeric,
  p_amount_raw numeric,
  p_entry_sig text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_id uuid;
begin
  if p_amount_raw is null or p_amount_raw <= 0 then
    return jsonb_build_object('ok', false, 'error', 'filled amount required', 'status', 400);
  end if;
  if p_entry_price_usd is null or p_entry_price_usd <= 0 then
    -- Without an entry price there is no multiple to measure exits against, so the
    -- position would never legitimately trigger. Refuse rather than open a blind one.
    return jsonb_build_object('ok', false, 'error', 'entry price required', 'status', 400);
  end if;

  select * into v_sub from public.subscriptions s where s.id = p_subscription_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription unavailable', 'status', 409);
  end if;

  insert into public.positions (
    user_id, privy_user_id, user_pubkey, wallet_id, mint,
    entry_price_usd, amount_raw,
    tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps,
    status, entry_sig, group_id, call_id, subscription_id, opened_by
  ) values (
    v_sub.user_id, v_sub.privy_user_id, v_sub.user_pubkey, v_sub.wallet_id, p_mint,
    p_entry_price_usd, p_amount_raw,
    v_sub.tp1, v_sub.tp1_sell, v_sub.tp2, v_sub.tp2_sell, v_sub.stop_loss,
    greatest(1, least(coalesce(v_sub.slippage_bps, 300), 5000)),
    'open', nullif(trim(coalesce(p_entry_sig, '')), ''),
    v_sub.group_id, p_call_id, p_subscription_id, 'call'
  )
  on conflict (call_id, subscription_id) where call_id is not null and subscription_id is not null
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.positions
    where call_id = p_call_id and subscription_id = p_subscription_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'already_open', true);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ============================================================
-- Claim one exit leg
-- ============================================================
create or replace function public.worker_claim_position_exit(
  p_position_id uuid,
  p_leg text,
  p_multiple numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos public.positions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_amount numeric;
  v_pct numeric;
begin
  if p_leg not in ('tp1', 'tp2', 'sl') then
    return jsonb_build_object('ok', false, 'error', 'invalid exit leg', 'status', 400);
  end if;

  select * into v_pos from public.positions p
  where p.id = p_position_id and p.status = 'open'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'position unavailable', 'status', 409);
  end if;
  if nullif(v_pos.wallet_id, '') is null or nullif(v_pos.user_pubkey, '') is null then
    return jsonb_build_object('ok', false, 'error', 'delegated wallet unavailable', 'status', 422);
  end if;

  -- A stop-loss exits the whole remaining position; take-profits sell their configured
  -- share of what is still held.
  if p_leg = 'sl' then
    v_amount := v_pos.amount_raw;
  else
    if p_leg = 'tp1' and v_pos.filled_tp1 then
      return jsonb_build_object('ok', false, 'error', 'leg already filled', 'status', 409);
    end if;
    if p_leg = 'tp2' and v_pos.filled_tp2 then
      return jsonb_build_object('ok', false, 'error', 'leg already filled', 'status', 409);
    end if;
    v_pct := case when p_leg = 'tp1' then v_pos.tp1_sell else v_pos.tp2_sell end;
    if coalesce(v_pct, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'leg sells nothing', 'status', 422);
    end if;
    v_amount := floor(v_pos.amount_raw * least(v_pct, 100) / 100.0);
  end if;

  if coalesce(v_amount, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'nothing left to sell', 'status', 409);
  end if;

  insert into app_private.position_exits (position_id, leg, claim_token, status, amount_raw, trigger_multiple)
  values (p_position_id, p_leg, v_claim, 'claimed', v_amount, p_multiple);

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'position_id', v_pos.id,
    'leg', p_leg,
    'mint', v_pos.mint,
    'amount_raw', v_amount,
    'user_pubkey', v_pos.user_pubkey,
    'wallet_id', v_pos.wallet_id,
    'privy_user_id', v_pos.privy_user_id,
    'slippage_bps', greatest(1, least(coalesce(v_pos.slippage_bps, 300), 5000))
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'exit already claimed', 'status', 409);
end;
$$;

-- ============================================================
-- Redeem an exit claim
-- ============================================================
create or replace function public.worker_finish_position_exit(
  p_position_id uuid,
  p_leg text,
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
declare
  v_amount numeric;
  v_remaining numeric;
begin
  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid status', 'status', 400);
  end if;
  if p_status = 'succeeded' and nullif(trim(coalesce(p_sig, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'signature required', 'status', 400);
  end if;

  update app_private.position_exits
  set status = p_status,
      tx_signature = case when p_status = 'succeeded' then trim(p_sig) else tx_signature end,
      error = case when p_status = 'failed' then left(coalesce(p_error, 'exit failed'), 300) else null end,
      updated_at = now(),
      finished_at = now()
  where position_id = p_position_id
    and leg = p_leg
    and claim_token = p_claim_token
    and status = 'claimed'
  returning amount_raw into v_amount;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;

  -- A failed exit releases its claim so the next tick can retry the same leg.
  if p_status = 'failed' then
    delete from app_private.position_exits
    where position_id = p_position_id and leg = p_leg and claim_token = p_claim_token;
    return jsonb_build_object('ok', true, 'retryable', true);
  end if;

  update public.positions
  set amount_raw = greatest(amount_raw - v_amount, 0),
      filled_tp1 = filled_tp1 or p_leg = 'tp1',
      filled_tp2 = filled_tp2 or p_leg = 'tp2',
      status = case when p_leg = 'sl' or amount_raw - v_amount <= 0 then 'closed' else status end,
      closed_at = case when p_leg = 'sl' or amount_raw - v_amount <= 0 then now() else closed_at end
  where id = p_position_id
  returning amount_raw into v_remaining;

  return jsonb_build_object('ok', true, 'remaining_raw', v_remaining);
end;
$$;

-- ============================================================
-- What the monitor polls
-- ============================================================
create or replace function public.worker_open_positions(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  into v_rows
  from (
    select id, mint, user_pubkey, wallet_id, privy_user_id, entry_price_usd, amount_raw,
      tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps, filled_tp1, filled_tp2
    from public.positions
    where status = 'open'
      and amount_raw > 0
      and entry_price_usd > 0
    order by last_checked_at nulls first, created_at
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  ) p;
  return v_rows;
end;
$$;

create or replace function public.worker_touch_position(p_position_id uuid, p_price_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.positions
  set last_price_usd = coalesce(p_price_usd, last_price_usd),
      last_checked_at = now()
  where id = p_position_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.worker_open_position(uuid, uuid, text, numeric, numeric, text) from public, anon, authenticated;
revoke execute on function public.worker_claim_position_exit(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.worker_finish_position_exit(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.worker_open_positions(integer) from public, anon, authenticated;
revoke execute on function public.worker_touch_position(uuid, numeric) from public, anon, authenticated;

grant execute on function public.worker_open_position(uuid, uuid, text, numeric, numeric, text) to service_role;
grant execute on function public.worker_claim_position_exit(uuid, text, numeric) to service_role;
grant execute on function public.worker_finish_position_exit(uuid, text, uuid, text, text, text) to service_role;
grant execute on function public.worker_open_positions(integer) to service_role;
grant execute on function public.worker_touch_position(uuid, numeric) to service_role;
