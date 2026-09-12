-- Global automation facts used by the public capability status and RUN. This exposes
-- booleans and counts only; no worker identity, secret, wallet or user record leaves the DB.
-- Rollback: supabase/rollback/29-automation-runtime-readiness.sql

create or replace function public.app_automation_runtime_facts(p_secret text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_worker app_private.worker_leases%rowtype;
  v_worker_found boolean := false;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_worker from app_private.worker_leases
  order by heartbeat_at desc nulls last limit 1;
  v_worker_found := found;

  return jsonb_build_object(
    'mainnetEnabled', coalesce((select (value #>> '{}')::boolean from app_private.system_flags where flag_key = 'mainnet_execution_enabled'), false),
    'discordEntriesEnabled', coalesce((select (value #>> '{}')::boolean from app_private.system_flags where flag_key = 'discord_entries_enabled'), false),
    'automatedExitsEnabled', coalesce((select (value #>> '{}')::boolean from app_private.system_flags where flag_key = 'automated_exits_enabled'), false),
    'workerLive', v_worker_found and v_worker.lease_expires_at > now(),
    'workerMode', case when v_worker_found then v_worker.execution_mode else null end,
    'signerReady', case when v_worker_found then coalesce((v_worker.metadata->>'signingEnabled')::boolean, false) else false end,
    'workerFeeConfigured', case when v_worker_found then coalesce((v_worker.metadata->>'feeConfigured')::boolean, false) else false end,
    'heartbeatAt', case when v_worker_found then v_worker.heartbeat_at else null end,
    'reconciliationWarnings', (
      select count(*) from app_private.trade_executions e
      where e.status = 'confirmed' and e.reconciled_at is null
        and coalesce(e.confirmed_at, e.created_at) < now() - interval '5 minutes'
    )
  );
end;
$$;

revoke all on function public.app_automation_runtime_facts(text) from public, anon, authenticated;
grant execute on function public.app_automation_runtime_facts(text) to service_role;
