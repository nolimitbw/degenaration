-- Owner-only bot signal and execution journal for post-creation inspection.
-- Forward-safe: read-only RPC; no existing rows are changed.
-- Rollback: revoke and drop public.app_user_get_bot_activity.

create or replace function public.app_user_get_bot_activity(
  p_secret text,
  p_privy_user_id text,
  p_bot_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bot app_private.bot_profiles%rowtype;
  v_signals jsonb;
  v_executions jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_bot
  from app_private.bot_profiles b
  where b.id = p_bot_id and b.owner_privy_user_id = p_privy_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'bot not found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt" desc), '[]'::jsonb)
  into v_signals
  from (
    select
      d.id,
      d.status,
      ps.status as "parseStatus",
      ps.mint,
      ps.confidence_bps as "confidenceBps",
      coalesce(d.evaluation->>'reason', ps.rejection_reason) as reason,
      rs.source_type as "sourceType",
      rs.source_ref as "sourceRef",
      rs.received_at as "receivedAt",
      d.created_at as "createdAt",
      d.finished_at as "finishedAt"
    from app_private.signal_deliveries d
    join app_private.parsed_signals ps on ps.id = d.parsed_signal_id
    join app_private.raw_signals rs on rs.id = ps.raw_signal_id
    where d.bot_id = v_bot.id
    order by d.created_at desc
    limit v_limit
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt" desc), '[]'::jsonb)
  into v_executions
  from (
    select
      i.id,
      i.intent_kind as "intentKind",
      i.side,
      i.mint,
      i.state,
      i.execution_mode as "executionMode",
      i.requested_input_base_units::text as "requestedInputBaseUnits",
      e.status as "executionStatus",
      e.attempt,
      e.tx_signature as "txSignature",
      e.gross_notional_lamports::text as "grossNotionalLamports",
      e.network_fee_lamports::text as "networkFeeLamports",
      e.priority_fee_lamports::text as "priorityFeeLamports",
      e.platform_fee_lamports::text as "platformFeeLamports",
      e.creator_fee_lamports::text as "creatorFeeLamports",
      e.error_code as "errorCode",
      e.error_message as "errorMessage",
      i.created_at as "createdAt",
      e.submitted_at as "submittedAt",
      e.confirmed_at as "confirmedAt",
      e.reconciled_at as "reconciledAt"
    from app_private.trade_intents i
    left join lateral (
      select execution.*
      from app_private.trade_executions execution
      where execution.intent_id = i.id
      order by execution.attempt desc
      limit 1
    ) e on true
    where i.bot_id = v_bot.id and i.owner_privy_user_id = p_privy_user_id
    order by i.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'bot', jsonb_build_object('id', v_bot.id, 'kind', v_bot.kind, 'name', v_bot.name),
    'signals', v_signals,
    'executions', v_executions
  );
end;
$$;

revoke execute on function public.app_user_get_bot_activity(text, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.app_user_get_bot_activity(text, text, uuid, integer)
  to service_role;
