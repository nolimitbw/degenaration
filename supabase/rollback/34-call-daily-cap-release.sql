-- Rollback for supabase/degenaration-call-daily-cap-release.sql
--
-- WHAT ROLLING BACK RESTORES, stated plainly because it is a defect and not merely an older
-- shape: a call execution that fails BEFORE submission will again keep the daily-cap
-- reservation it never spent. A bot whose entries keep failing then exhausts daily_spent and
-- daily_trades having bought nothing, and stops trading for the rest of the day with a full
-- wallet. Prefer rolling forward.
--
-- Safe to run at any time: this only restores the previous function body at the same arity, so
-- there is no overload risk and no data is touched. Counters already released stay released,
-- which is correct — those reservations were never spent.

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
$function$;

revoke execute on function public.worker_finish_call_execution(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.worker_finish_call_execution(uuid, uuid, uuid, text, text, text)
  to service_role;
