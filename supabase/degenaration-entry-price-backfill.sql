-- Migration 31: recover the entry price for calls that arrived through the history scanner.
--
-- 2,292 of 2,293 calls have no `called_price_usd`, so nothing can be measured and every
-- marketplace figure reads "Collecting data". The cause is documented and was correct at the
-- time: DexScreener answers with the price NOW, so stamping today's price on an old call would
-- invent the source's entire track record, and `isHistorical` refuses to do it.
--
-- What changed is the available evidence, not the rule. GeckoTerminal serves minute-level
-- OHLCV history per pool, free and without a key, so the price AT THE CALL MINUTE is a fact we
-- can look up rather than a number we would be guessing. Recording that is not fabrication;
-- it is the same measurement taken late.
--
-- The guard that matters is the one below: this writes ONLY where `called_price_usd is null`.
-- It can never overwrite a baseline captured live, which is the higher-quality observation.
--
-- Rerun-safe. Additive: one new column and two new functions, no existing object replaced.

alter table public.calls
  add column if not exists called_price_source text;

comment on column public.calls.called_price_source is
  'Where the entry price came from: null for a live capture at ingest, ''ohlcv-backfill'' for a historical lookup. Kept so a measured return can always be traced to how its baseline was obtained.';

-- ── The claim: calls still missing an entry price, oldest first ────────────────────────────
--
-- Oldest first deliberately. A call that has been unmeasurable for months is the one holding a
-- source's record hostage, and the newest calls are the ones the live path will capture anyway.
create or replace function public.bot_calls_awaiting_entry_price(p_secret text, p_limit integer default 40)
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

  select coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) into v_rows
  from (
    select id, mint, called_at
    from public.calls
    where called_price_usd is null
      and mint is not null
      -- GeckoTerminal's minute history does not reach back indefinitely; beyond this the
      -- lookup returns nothing and the row would be retried forever for no reason.
      and called_at > now() - interval '180 days'
    -- FRESH CALLS FIRST, absolutely.
    --
    -- Detection is 2-6 seconds, measured. But the price at ingest is null: DexScreener has
    -- not indexed a pair for a token that is seconds old, so the live enrichment finds
    -- nothing. The GeckoTerminal candle DOES exist, which is why this backfill prices those
    -- same calls successfully later — "later" was the entire problem.
    --
    -- Two earlier orderings were both wrong, in opposite directions. Oldest-first was written
    -- on the reasoning that long-unmeasured calls hold a source's record hostage; five rows
    -- landed and the measurable count moved by zero, because those tokens are dead and have no
    -- current price either. Then current-price-first, which is right for the backlog and puts
    -- a brand-new call — which has no current price yet — behind 543 older ones.
    --
    -- A source's newest call is the one someone is actually watching, so it goes first.
    -- Second, calls that already have a current price, since those become measurable the
    -- instant the entry lands. Everything else last: mostly dead tokens with no pool left to
    -- query, which is where 24 of every 34 attempts were being spent.
    order by
      (called_at > now() - interval '2 hours') desc,
      (latest_price_usd is not null) desc,
      called_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 100))
  ) c;

  return v_rows;
end;
$$;

revoke all on function public.bot_calls_awaiting_entry_price(text, integer) from public, anon, authenticated;
grant execute on function public.bot_calls_awaiting_entry_price(text, integer) to service_role;

-- ── The write ──────────────────────────────────────────────────────────────────────────────
create or replace function public.bot_record_call_entry_price(
  p_secret text,
  p_call_id uuid,
  p_price_usd numeric,
  p_market_cap_usd numeric default null,
  p_liquidity_usd numeric default null
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

  -- A non-positive price is not a price. Writing 0 would make every return infinite.
  if p_price_usd is null or p_price_usd <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'non-positive price');
  end if;

  update public.calls
     set called_price_usd = p_price_usd,
         called_mcap = coalesce(called_mcap, p_market_cap_usd),
         called_liquidity_usd = coalesce(called_liquidity_usd, p_liquidity_usd),
         called_price_source = 'ohlcv-backfill'
   where id = p_call_id
     -- The load-bearing guard. A baseline captured live at ingest is the better observation
     -- and must never be replaced by a looked-up one.
     and called_price_usd is null;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', v_updated > 0, 'updated', v_updated);
end;
$$;

revoke all on function public.bot_record_call_entry_price(text, uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.bot_record_call_entry_price(text, uuid, numeric, numeric, numeric) to service_role;
