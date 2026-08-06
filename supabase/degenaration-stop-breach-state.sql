-- The stop-loss delay had nowhere to remember that the stop had been breached.
--
-- THE SWITCH
--
-- The builder offers "Stop delay" — hold the stop for N seconds before selling, so a single
-- noisy print does not liquidate a position that recovers on the next tick. It has been
-- persisted, validated, versioned and reloaded since the builder shipped, and enforced by
-- nothing. `decideExit` fires the stop on the FIRST tick past the threshold.
--
-- It could not be otherwise: a debounce needs to know WHEN the breach started, and the monitor
-- is a stateless polling loop. Holding that in process memory would lose it on every restart —
-- and losing it means the stop fires immediately on the next tick after a deploy, which is
-- precisely the noise the setting exists to absorb.
--
-- WHY A COLUMN AND NOT A CACHE
--
-- The breach clock has to survive a restart or the control is a lie under exactly the
-- conditions it matters: a worker redeploy during a volatile minute. `stop_breached_at` is
-- durable, monotonic in the sense that only a genuine recovery clears it, and readable by an
-- operator asking why a position is sitting past its stop.
--
-- `worker_record_stop_breach` is idempotent on the start side: re-recording a breach that is
-- already open does NOT restart the clock, or a monitor ticking every few seconds would keep
-- pushing the deadline away and the stop would never fire. That is the defect this function's
-- shape exists to prevent, and it is asserted.
--
-- Forward safety: one nullable column and one new function. No existing function is replaced,
-- no constraint narrowed, no grant changed, no row rewritten.
-- Rollback: supabase/rollback/17-stop-breach-state.sql.

alter table public.positions
  add column if not exists stop_breached_at timestamptz;

create or replace function public.worker_record_stop_breach(
  p_id uuid,
  p_breached boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if p_breached then
    -- `coalesce(stop_breached_at, now())` is the whole idempotency guarantee: an open breach
    -- keeps its original timestamp however many ticks observe it. Assigning now() here would
    -- reset the clock on every poll and the delay would never elapse.
    update public.positions
    set stop_breached_at = coalesce(stop_breached_at, now())
    where id = p_id and status in ('open', 'exiting')
    returning stop_breached_at into v_at;
  else
    -- Cleared only by a genuine recovery above the threshold. The monitor decides that; this
    -- function does not second-guess it.
    update public.positions
    set stop_breached_at = null
    where id = p_id
    returning stop_breached_at into v_at;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'position not available', 'status', 404);
  end if;
  return jsonb_build_object('ok', true, 'stopBreachedAt', v_at);
end;
$$;

revoke execute on function public.worker_record_stop_breach(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.worker_record_stop_breach(uuid, boolean) to service_role;
