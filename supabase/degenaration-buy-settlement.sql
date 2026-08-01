-- Buy settlement: a submitted swap is not a completed trade.
--
-- WHY THIS EXISTS. `server/engine/signer.js` returns Privy's transaction hash the moment
-- the swap is SUBMITTED, and every caller treated that as done — `calls.js` marked the
-- execution `succeeded`, `limits.js` marked the order `filled`. A swap that fails on chain
-- (slippage exceeded, expired blockhash, insufficient balance) was recorded as a completed
-- trade, and the ledger row written for it described a trade that never happened.
--
-- It also blocks position capture: the amount a user ACTUALLY received can only be read
-- from a confirmed transaction, so without a settlement step there is no honest number to
-- open a position with, and take-profit / stop-loss have nothing to act on.
--
-- The fix is one intermediate state. `submitted` records the signature durably and hands
-- the row to a reconciler, which resolves it to `succeeded` or `failed` against the chain.
-- Confirmation is deliberately NOT awaited inline: a subscriber loop that blocks up to two
-- minutes per member does not scale past a handful of subscribers.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The intermediate state
-- ---------------------------------------------------------------------------

alter table app_private.call_executions
  drop constraint if exists call_executions_status_check;

alter table app_private.call_executions
  add constraint call_executions_status_check
  check (status in ('claimed', 'submitted', 'succeeded', 'failed', 'skipped'));

alter table app_private.call_executions
  add column if not exists submitted_at timestamptz;

-- The reconciler's queue.
create index if not exists call_executions_submitted_idx
  on app_private.call_executions (submitted_at)
  where status = 'submitted';

-- ---------------------------------------------------------------------------
-- 2. Record submission (claimed -> submitted)
-- ---------------------------------------------------------------------------

create or replace function public.worker_submit_call_execution(
  p_call_id uuid,
  p_subscription_id uuid,
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

  update app_private.call_executions
  set status = 'submitted',
      tx_signature = trim(p_sig),
      submitted_at = now(),
      updated_at = now()
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

-- ---------------------------------------------------------------------------
-- 3. The reconciler's queue
-- ---------------------------------------------------------------------------

-- Returns submitted executions with everything needed to confirm them and, on success,
-- open a position: the mint being bought and the risk settings the subscriber configured.
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
    select e.call_id, e.subscription_id, e.claim_token, e.tx_signature, e.submitted_at,
           e.amount_sol,
           c.mint, c.group_id,
           s.privy_user_id, s.user_pubkey, s.wallet_id, s.user_id,
           s.tp1, s.tp1_sell, s.tp2, s.tp2_sell, s.stop_loss, s.slippage_bps
    from app_private.call_executions e
    join public.calls c on c.id = e.call_id
    join public.subscriptions s on s.id = e.subscription_id
    where e.status = 'submitted'
    order by e.submitted_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return jsonb_build_object('ok', true, 'executions', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Settle (submitted -> succeeded | failed)
-- ---------------------------------------------------------------------------

create or replace function public.worker_settle_call_execution(
  p_call_id uuid,
  p_subscription_id uuid,
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
  v_sub_id uuid := p_subscription_id;
begin
  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid status', 'status', 400);
  end if;

  update app_private.call_executions
  set status = p_status,
      error = case when p_status = 'failed' then left(coalesce(p_error, 'execution failed'), 300) else null end,
      updated_at = now(),
      finished_at = now()
  where call_id = p_call_id
    and subscription_id = p_subscription_id
    and claim_token = p_claim_token
    and status = 'submitted'
  returning amount_sol into v_amount;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;

  -- The daily cap was reserved at claim time so a burst of calls could not overspend it.
  -- A trade that never landed must give that reservation back, or a user's cap is consumed
  -- by failures and their bot stops trading for the rest of the day.
  if p_status = 'failed' and coalesce(v_amount, 0) > 0 then
    update public.subscriptions
    set daily_spent = greatest(coalesce(daily_spent, 0) - v_amount, 0)
    where id = v_sub_id
      and daily_spent_on = (now() at time zone 'utc')::date;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges — worker only
-- ---------------------------------------------------------------------------

revoke execute on function public.worker_submit_call_execution(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.worker_submit_call_execution(uuid, uuid, uuid, text) to service_role;

revoke execute on function public.worker_load_submitted_executions(integer) from public, anon, authenticated;
grant execute on function public.worker_load_submitted_executions(integer) to service_role;

revoke execute on function public.worker_settle_call_execution(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.worker_settle_call_execution(uuid, uuid, uuid, text, text) to service_role;
