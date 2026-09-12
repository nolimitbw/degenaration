-- Reconcile abandoned trade intents so a dead worker cannot freeze a user's funds.
--
-- WHY
--
-- degenaration-trade-intent-fanout.sql reserves capital the moment the worker claims a call,
-- and releases it by trigger when the intent reaches a terminal or settled state. That is
-- correct while the worker is alive. It has no answer for the worker DYING between the two.
--
-- An intent left in capital_reserved or submitted holds reserved_lamports forever.
-- app_user_withdrawable_state subtracts it, so the user's own SOL becomes permanently
-- unwithdrawable and nothing reports why. That is the same failure the funds incident was
-- about -- a balance that exists and cannot be used -- reached by a different route.
--
-- WHAT IT REFUSES TO DO
--
-- It never expires an intent that carries a transaction signature. A signature means lamports
-- may already have moved; releasing that reservation would let the user withdraw SOL the
-- chain has taken, and the second transfer would simply fail with a confusing error. Signed
-- intents are surfaced for operator reconciliation instead, exactly as
-- degenaration-admin-product-rpcs.sql refuses to fail a payout that has been sent.
--
-- Forward safety: new functions only. The release path itself is the existing trigger, so an
-- expiry here cannot bypass the accounting.
-- Rollback: drop both functions.

create or replace function public.worker_reconcile_stale_intents(
  p_secret text,
  p_reserved_timeout_minutes integer,
  p_submitted_timeout_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserved interval := make_interval(mins => greatest(5, coalesce(p_reserved_timeout_minutes, 30)));
  v_submitted interval := make_interval(mins => greatest(5, coalesce(p_submitted_timeout_minutes, 60)));
  v_expired integer := 0;
  v_needs_review integer := 0;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Never claimed by a live execution and never signed: the buy provably did not happen, so
  -- the reservation is stale and the capital belongs back with the user. Setting state to
  -- 'expired' fires the existing release trigger rather than zeroing reserved_lamports here,
  -- so there is exactly one place capital is ever released.
  with stale as (
    select i.id
    from app_private.trade_intents i
    where i.reserved_lamports > 0
      and i.state in ('created', 'validated', 'capital_reserved', 'quoted', 'simulated',
                      'validating', 'ready', 'claimed')
      and i.updated_at < now() - v_reserved
      and not exists (
        select 1 from app_private.call_executions e
        where e.intent_id = i.id and e.tx_signature is not null
      )
      and not exists (
        select 1 from app_private.copy_executions c
        where c.intent_id = i.id and c.tx_signature is not null
      )
    for update
  )
  update app_private.trade_intents t
  set state = 'expired'
  from stale
  where t.id = stale.id;
  get diagnostics v_expired = row_count;

  -- Submitted and long overdue. These may or may not have landed, so they are NOT expired --
  -- they are counted for the operator. Releasing a reservation whose transaction later
  -- confirms would let the user spend the same SOL twice from the product's point of view.
  select count(*) into v_needs_review
  from app_private.trade_intents i
  where i.reserved_lamports > 0
    and i.state = 'submitted'
    and i.updated_at < now() - v_submitted;

  return jsonb_build_object(
    'ok', true,
    'expiredIntents', v_expired,
    'awaitingReconciliation', v_needs_review,
    'note', 'Intents carrying a transaction signature are never auto-expired; lamports may '
         || 'already have moved and must be reconciled against the network.'
  );
end;
$$;

-- What the operator needs to resolve the awaiting-reconciliation set by hand.
create or replace function public.admin_stuck_intents(
  p_secret text,
  p_actor_privy_user_id text,
  p_limit integer
)
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
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at), '[]'::jsonb)
  into v_rows
  from (
    select
      i.id,
      i.owner_privy_user_id as "owner",
      i.state,
      i.mint,
      i.reserved_lamports::text as "reservedLamports",
      i.wallet_address as "walletAddress",
      i.correlation_id as "correlationId",
      i.created_at, i.updated_at,
      (select e.tx_signature from app_private.call_executions e
        where e.intent_id = i.id and e.tx_signature is not null limit 1) as "txSignature"
    from app_private.trade_intents i
    where i.reserved_lamports > 0
      and i.updated_at < now() - interval '30 minutes'
    order by i.updated_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x;

  return jsonb_build_object('ok', true, 'stuckIntents', v_rows);
end;
$$;

revoke execute on function public.worker_reconcile_stale_intents(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_stuck_intents(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.worker_reconcile_stale_intents(text, integer, integer) to service_role;
grant execute on function public.admin_stuck_intents(text, text, integer) to service_role;
