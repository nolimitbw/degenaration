-- "Is the worker healthy?" had no answerable form, and one document had already drawn the
-- wrong conclusion from that.
--
-- THE DEFECT, WHICH IS THE SAME ONE AGAIN
--
-- `app_private.worker_leases` is read by `admin_product_overview` and cited by
-- `IMPLEMENTATION_STATUS.md` as evidence. `public.worker_heartbeat` — the writer — has existed
-- and been deployed since degenaration-product-rpcs.sql. **Nothing has ever called it.**
-- A grep of server/ finds no reference to `worker_heartbeat` or `worker_leases` outside
-- node_modules.
--
-- So `worker_leases` is the fifth table in this project that several surfaces read and nothing
-- writes, after trade_intents, trade_executions/positions/position_lots, signal_deliveries and
-- performance_snapshots. It fails the same way all of them did: it never raises, and a left
-- join renders a dash.
--
-- AND IT PRODUCED A FALSE INFERENCE, NOT JUST A BLANK
--
-- `docs/coordination/IMPLEMENTATION_STATUS.md` reads `worker_leases`=0 as proof that "the
-- worker has never run". That inference was sound when it was written and is now wrong: the
-- worker IS deployed and live, with signing enabled. Zero rows never meant the worker was
-- absent — it meant nobody was writing. An empty table that is treated as a measurement is
-- worse than an empty table, because it answers a question it was never connected to.
--
-- WHY A NEW READER RATHER THAN REUSING THE ADMIN ONE
--
-- `admin_product_overview` requires the admin secret AND an owner identity. The bot readiness
-- check runs for an ordinary signed-in user deciding whether RUN can activate their bot, and
-- it needs exactly three facts: is a worker heartbeating, how stale is it, and in which
-- execution mode. Handing that path an admin function would either widen the admin surface or
-- force the readiness route to lie about what it could not see.
--
-- This returns liveness ONLY. No instance id, no host, no metadata, no counts — an instance
-- identifier is operational detail that belongs in the Admin Console, and the readiness answer
-- does not improve by leaking it.
--
-- STALENESS IS DECIDED HERE, NOT BY THE CALLER. `lease_expires_at` is what the worker itself
-- committed to; a worker past its own lease is not live however recently it spoke. Callers get
-- a boolean they cannot get subtly wrong, plus the age in seconds for display.
--
-- Forward safety: one new read-only function. No table, column, constraint, grant or row is
-- touched. Nothing writes.
-- Rollback: supabase/rollback/20-worker-liveness.sql.

create or replace function public.app_worker_liveness(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease app_private.worker_leases%rowtype;
begin
  if not app_private.bot_secret_ok(p_secret) and not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- The most recently heard-from worker of any key. There is one trading worker today; taking
  -- the freshest rather than a named key means adding a second one does not silently report
  -- the first one's staleness.
  select * into v_lease
  from app_private.worker_leases
  order by heartbeat_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'live', false,
      -- Distinguished deliberately from "stale". A worker that has never reported and a worker
      -- that reported ten minutes ago are different faults with different fixes, and one
      -- message for both is how a deployment problem gets diagnosed as an outage.
      'reason', 'no worker has ever reported',
      'executionMode', null,
      'heartbeatAt', null,
      'heartbeatAgeSeconds', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    -- The worker's OWN lease decides this. It committed to reporting again before
    -- lease_expires_at; past that it is not live regardless of how recent the last beat looks.
    'live', v_lease.lease_expires_at > now(),
    'reason', case
      when v_lease.lease_expires_at > now() then null
      else 'the worker stopped reporting'
    end,
    'executionMode', v_lease.execution_mode,
    'heartbeatAt', v_lease.heartbeat_at,
    'heartbeatAgeSeconds', floor(extract(epoch from (now() - v_lease.heartbeat_at)))::integer
  );
end;
$$;

revoke execute on function public.app_worker_liveness(text) from public, anon, authenticated;
grant execute on function public.app_worker_liveness(text) to service_role;
