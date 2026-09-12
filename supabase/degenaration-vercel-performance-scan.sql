-- Migration 30 — run the call-performance scanner without a worker host.
--
-- WHY
--
-- 1,780 of 1,781 journalled calls have no price. Only one has ever been scanned. The
-- marketplace therefore shows no performance for either approved source, which is the single
-- fact a user needs before copying one.
--
-- The scanner itself is not missing. `public.worker_record_call_market_scan` is deployed and
-- correct, and `server/engine/performance.js` drives it — but only from inside the worker,
-- and the worker has no host: the Railway trial expired and every deployment was torn down.
-- So a working scanner and a full journal are separated by a hosting bill.
--
-- Vercel already runs the Discord history backfill on a cron through the bot bridge. This
-- opens the same door for pricing, so the journal fills from the deployment that IS running.
--
-- WHY A WRAPPER AND NOT THE RPC DIRECTLY
--
-- `worker_record_call_market_scan` takes no `p_secret`. It is safe today because EXECUTE is
-- granted to `service_role` alone and nothing but the worker holds that key.
--
-- The bot bridge does NOT authenticate callers. It dispatches by operation name and runs the
-- RPC as `service_role`; every operation it exposes is safe only because the function behind
-- it validates `p_secret` itself. Adding the raw scanner to that map would therefore let any
-- caller who can reach the bridge URL write arbitrary prices into `public.calls` — inventing
-- a source's entire track record, which is exactly the number a user risks money on.
--
-- So the bridge gets a guarded wrapper with the same shape as every other `bot_*` function,
-- and the unguarded worker RPC stays reachable only by `service_role`.

create or replace function public.bot_record_call_market_scan(
  p_secret text,
  p_call_id uuid,
  p_provider text,
  p_observed_at timestamptz,
  p_price_usd numeric,
  p_market_cap_usd numeric,
  p_liquidity_usd numeric,
  p_freshness text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  return public.worker_record_call_market_scan(
    p_call_id, p_provider, p_observed_at,
    p_price_usd, p_market_cap_usd, p_liquidity_usd, p_freshness
  );
end;
$$;

revoke all on function public.bot_record_call_market_scan(text, uuid, text, timestamptz, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.bot_record_call_market_scan(text, uuid, text, timestamptz, numeric, numeric, numeric, text) to service_role;

-- The work list. Mirrors `loadPerformanceCalls` in server/engine/store.js exactly — accepted
-- parses, not deleted, called within 30 days — but ordered so the LEAST recently scanned call
-- goes first rather than the newest.
--
-- That ordering is the difference between filling a backlog and never touching it. A cron with
-- a bounded page that always takes the newest calls would rescan the same head of the list on
-- every run and leave the 1,780 unscanned rows unscanned forever. `nulls first` puts the calls
-- that have never been priced at the front of the queue.
create or replace function public.bot_calls_awaiting_scan(p_secret text, p_limit integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'mint', c.mint)), '[]'::jsonb)
  into v_rows
  from (
    select id, mint
    from public.calls
    where deleted_at is null
      and parse_status = 'accepted'
      and nullif(trim(coalesce(mint, '')), '') is not null
      and called_at >= now() - interval '30 days'
    order by last_scanned_at asc nulls first, called_at desc
    limit greatest(1, least(coalesce(p_limit, 60), 200))
  ) c;

  return v_rows;
end;
$$;

revoke all on function public.bot_calls_awaiting_scan(text, integer) from public, anon, authenticated;
grant execute on function public.bot_calls_awaiting_scan(text, integer) to service_role;
