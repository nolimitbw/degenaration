-- A failed entry consumed the day's budget it never spent.
--
-- worker_claim_call_execution reserves against subscriptions.daily_spent and daily_trades in
-- the same transaction as the claim, which is correct: ten calls arriving in one tick must not
-- each read "0 spent" and each claim. But nothing ever gave the reservation back.
--
-- Observed in production 2026-08-19. Three real executions on subscription 6944eef9 failed
-- before submission — tx_signature null, submitted_at null, zero lamports moved — and
-- permanently consumed 0.15 SOL of a 1.00 SOL daily cap and 3 of 10 daily trades. Twenty such
-- failures lock a bot out for the rest of the day having bought nothing. The daily cap is
-- precisely the control a user sets to bound a bad day, so spending it on nothing is the one
-- way this counter must never be wrong.
--
-- The copy/buy path already refunds this (degenaration-buy-settlement.sql — "failed buy refunds
-- the reserved daily cap with no double refund"). The Discord call path never did. Same
-- reservation, same failure mode, one implementation short.
--
-- WHAT MAY NEVER BE RELEASED: a leg carrying a signature. Once signAndSend returns, the
-- transaction may already be on its way to the chain, so the SOL is committed however this row
-- is labelled. The guard is therefore on the EVIDENCE — tx_signature and submitted_at — not on
-- the status word, which is exactly the distinction engine/calls.js draws when it refuses to
-- retry after a signature exists.
--
-- No double refund: the UPDATE matches only status='claimed' and leaves the row 'failed', so a
-- second call finds nothing, returns "claim mismatch" and reaches the release at all.
-- greatest(0, ...) is a floor for the case where a counter is reset under an in-flight claim.
--
-- Verified against PostgreSQL before shipping: claim reserves 0.05/1; failure without a
-- signature returns to 0/0 with released=true; a repeat finish returns claim mismatch and
-- changes nothing; a leg with a signature stays at 0.05/1 with released=false.
--
-- Rollback: supabase/rollback/34-call-daily-cap-release.sql

create or replace function public.worker_finish_call_execution(
  p_call_id uuid,
  p_subscription_id uuid,
  p_claim_token uuid,
  p_status text,
  p_sig text default null::text,
  p_error text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_amount numeric;
  v_release boolean := false;
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
    and status = 'claimed'
  returning amount_sol,
            (p_status = 'failed' and tx_signature is null and submitted_at is null)
  into v_amount, v_release;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;

  if coalesce(v_release, false) then
    update public.subscriptions
    set daily_spent  = greatest(0, coalesce(daily_spent, 0) - coalesce(v_amount, 0)),
        daily_trades = greatest(0, coalesce(daily_trades, 0) - 1)
    where id = p_subscription_id;
  end if;

  return jsonb_build_object('ok', true, 'released', coalesce(v_release, false));
end;
$function$;

revoke execute on function public.worker_finish_call_execution(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.worker_finish_call_execution(uuid, uuid, uuid, text, text, text)
  to service_role;
