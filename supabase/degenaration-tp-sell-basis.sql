-- Take-profit legs sell a share of the ORIGINAL position, which is what the client was told.
--
-- THE BUG THIS FIXES: worker_claim_position_exit computed each take-profit as a percentage
-- of positions.amount_raw, but worker_finish_position_exit decrements amount_raw on every
-- successful exit. So the second leg took its cut of what was LEFT, not of the position.
--
-- With the shipped defaults (TP1 sells 50% at 2x, TP2 sells 25% at 5x) on 1000 tokens:
--
--            promised            actual (before this fix)
--   TP1        500                 500      (amount_raw -> 500)
--   TP2        250                 125      (25% of 500)
--   riding     250                 375
--
-- The subscriber keeps 50% more of the bag than they asked to keep, at the exact price
-- they said they wanted out. The UI is unambiguous about the intended meaning — it says
-- "2x sells 50% of the position", and it refuses to save a ladder whose legs sum above
-- 100%, a rule that only makes sense against a fixed base (app/calls/CallsBody.tsx:31,197).
--
-- The fix keeps the original filled amount alongside the running balance and prices the
-- take-profit legs against it. A stop-loss still sells the whole remaining balance.

alter table public.positions
  add column if not exists opened_amount_raw numeric;

comment on column public.positions.opened_amount_raw is
  'The confirmed on-chain fill this position opened with. amount_raw is what is still held; take-profit legs are a share of THIS.';

-- Existing rows: the best available reading of their original size is what they hold now.
-- A partially exited position will under-sell its next leg rather than over-sell it, which
-- is the safe direction to be wrong in.
update public.positions
set opened_amount_raw = amount_raw
where opened_amount_raw is null;

-- ============================================================
-- Record the opening fill
-- ============================================================
create or replace function public.worker_open_position(
  p_call_id uuid,
  p_subscription_id uuid,
  p_mint text,
  p_entry_price_usd numeric,
  p_amount_raw numeric,
  p_entry_sig text default null
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
  if p_entry_price_usd is null or p_entry_price_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'entry price required', 'status', 400);
  end if;
  if p_amount_raw is null or p_amount_raw <= 0 then
    return jsonb_build_object('ok', false, 'error', 'filled amount required', 'status', 400);
  end if;

  select * into v_sub from public.subscriptions s where s.id = p_subscription_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription unavailable', 'status', 409);
  end if;

  insert into public.positions (
    user_id, privy_user_id, user_pubkey, wallet_id, mint,
    entry_price_usd, amount_raw, opened_amount_raw,
    tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps,
    status, entry_sig, group_id, call_id, subscription_id, opened_by
  ) values (
    v_sub.user_id, v_sub.privy_user_id, v_sub.user_pubkey, v_sub.wallet_id, p_mint,
    p_entry_price_usd, p_amount_raw, p_amount_raw,
    v_sub.tp1, v_sub.tp1_sell, v_sub.tp2, v_sub.tp2_sell, v_sub.stop_loss,
    greatest(1, least(coalesce(v_sub.slippage_bps, 300), 5000)),
    'open', nullif(trim(coalesce(p_entry_sig, '')), ''),
    v_sub.group_id, p_call_id, p_subscription_id, 'call'
  )
  on conflict (call_id, subscription_id) where call_id is not null and subscription_id is not null
  do nothing
  returning id into v_id;

  if v_id is null then
    select p.id into v_id from public.positions p
    where p.call_id = p_call_id and p.subscription_id = p_subscription_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'already_open', true);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ============================================================
-- Claim one exit leg, sized against the opening fill
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
  v_base numeric;
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
  -- share of the ORIGINAL fill, capped at what is still held so a ladder can never try to
  -- sell tokens the wallet no longer has.
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
    v_base := coalesce(nullif(v_pos.opened_amount_raw, 0), v_pos.amount_raw);
    v_amount := least(floor(v_base * least(v_pct, 100) / 100.0), v_pos.amount_raw);
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

revoke execute on function public.worker_open_position(uuid, uuid, text, numeric, numeric, text) from public, anon, authenticated;
revoke execute on function public.worker_claim_position_exit(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.worker_open_position(uuid, uuid, text, numeric, numeric, text) to service_role;
grant execute on function public.worker_claim_position_exit(uuid, text, numeric) to service_role;
