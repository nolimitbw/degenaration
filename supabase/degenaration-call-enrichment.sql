-- Journal-first ingestion: price enrichment happens AFTER the call is recorded.
--
-- The product rule is that a call posted in an approved channel is journaled
-- immediately — a slow or unavailable price feed must never delay or drop it. So
-- /api/ingest-call records the call with null pricing and then calls this RPC with
-- whatever the price feed returned.
--
-- Writes are fill-only: a column already carrying a value is never overwritten, so a
-- late enrichment can't clobber the entry price the performance scanner is working from.

create or replace function public.bot_enrich_call_pricing(
  p_secret text,
  p_call_id uuid,
  p_symbol text,
  p_called_mcap numeric,
  p_called_price_usd numeric,
  p_called_liquidity_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_call_id is null then
    raise exception 'call id required' using errcode = '22023';
  end if;

  update public.calls
  set symbol = coalesce(symbol, nullif(left(trim(coalesce(p_symbol, '')), 32), '')),
      called_mcap = coalesce(called_mcap, p_called_mcap),
      called_price_usd = coalesce(called_price_usd, p_called_price_usd),
      called_liquidity_usd = coalesce(called_liquidity_usd, p_called_liquidity_usd),
      peak_mcap = coalesce(peak_mcap, p_called_mcap),
      latest_mcap = coalesce(latest_mcap, p_called_mcap),
      peak_price_usd = coalesce(peak_price_usd, p_called_price_usd),
      latest_price_usd = coalesce(latest_price_usd, p_called_price_usd),
      latest_liquidity_usd = coalesce(latest_liquidity_usd, p_called_liquidity_usd)
  where id = p_call_id;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', v_updated > 0, 'id', p_call_id);
end;
$$;

revoke execute on function public.bot_enrich_call_pricing(text, uuid, text, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.bot_enrich_call_pricing(text, uuid, text, numeric, numeric, numeric)
  to service_role;
