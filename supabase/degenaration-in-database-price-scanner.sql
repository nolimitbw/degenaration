-- Migration 31 — price the call journal from inside the database, on a real schedule.
--
-- WHY THIS EXISTS
--
-- The call journal needs a price per call or the marketplace has nothing to show. Three hosts
-- could do that job and all three were unavailable:
--
--   the worker      Railway's trial expired and removed every deployment
--   Vercel cron     Hobby allows 2 jobs at ONE RUN PER DAY, and both slots were already used
--   a new host      needs an account and a credential this environment does not have
--
-- Supabase is already paid for, already holds the data, and ships `pg_cron` and `http`. It was
-- the one scheduler nobody had switched on. At one run per day the 1,780-call backlog takes
-- nine days; at one run every few minutes it takes under an hour, and new calls get priced
-- while they still matter.
--
-- NO SHARED SECRET IS INVOLVED, and that is the point of doing it here rather than calling the
-- Vercel route. A cron job runs as the database owner, so it can call
-- `worker_record_call_market_scan` directly under the grant that function already has. Routing
-- through HTTP would have meant storing `CRON_SECRET` in `cron.job`, in plaintext, in a table,
-- to authenticate a request the database is making to itself.
--
-- ── THE DUPLICATION, STATED PLAINLY ─────────────────────────────────────────────────────────
--
-- `bestSolanaPair` in server/engine/performance.js and `pick_best_pair` below are the SAME RULE
-- written twice: filter to Solana pairs whose base token IS the mint, take the deepest by
-- liquidity, treat a non-positive number as absent, fall back from marketCap to fdv.
--
-- Two definitions of one rule is the defect class this codebase has spent its life removing,
-- and this is a deliberate exception rather than an oversight. The alternative was worse:
-- porting the whole engine into PL/pgSQL, or leaving the journal unpriced until someone pays
-- for a host. They are held together by `npm run verify:price-scanner-parity`, which drives one
-- fixture through both and fails if they disagree — so changing the rule in one place fails the
-- suite until it is changed in the other.
--
-- The SCANNER is the only thing duplicated. Everything that decides money — the return
-- arithmetic, the milestones, what counts as measured — stays in
-- `worker_record_call_market_scan`, which both callers go through.

create or replace function app_private.pick_best_pair(p_body jsonb, p_mint text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pair
  from jsonb_array_elements(coalesce(p_body -> 'pairs', '[]'::jsonb)) as pair
  where pair ->> 'chainId' = 'solana'
    and pair -> 'baseToken' ->> 'address' = p_mint
  order by coalesce((pair -> 'liquidity' ->> 'usd')::numeric, 0) desc
  limit 1;
$$;

-- Mirrors numberOrNull(): a price of 0, a negative, or an unparseable value is ABSENT, never 0.
-- Recording 0 as a price would make a live token look worthless and its return look total.
create or replace function app_private.positive_or_null(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  v := p_value::numeric;
  if v is null or v <= 0 then return null; end if;
  return v;
exception when others then
  return null;
end;
$$;

/**
 * Price one page of the journal.
 *
 * Ordered least-recently-scanned first with NULLS FIRST, so consecutive runs walk the backlog
 * instead of rescanning the newest page forever — the same ordering the Vercel route uses, for
 * the same reason.
 *
 * One HTTP call per DISTINCT mint, not per call row: 1,781 calls resolve to far fewer mints and
 * DexScreener is rate limited.
 *
 * Every failure records `unavailable` rather than raising. A provider timeout is a fact about
 * the provider, and a scanner that aborts a whole page because one token 404s never finishes
 * the backlog.
 */
create or replace function app_private.scan_call_prices(p_limit integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mint text;
  v_call record;
  v_status integer;
  v_content text;
  v_pair jsonb;
  v_quotes jsonb := '{}'::jsonb;
  v_quote jsonb;
  v_scanned integer := 0;
  v_unavailable integer := 0;
  v_observed timestamptz := now();
  v_page_mints integer := 0;
begin
  create temporary table if not exists _scan_page (id uuid, mint text) on commit drop;
  delete from _scan_page;

  insert into _scan_page (id, mint)
  select c.id, c.mint
  from public.calls c
  where c.deleted_at is null
    and c.parse_status = 'accepted'
    and nullif(trim(coalesce(c.mint, '')), '') is not null
    and c.called_at >= now() - interval '30 days'
  order by c.last_scanned_at asc nulls first, c.called_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 120));

  -- One request per distinct mint, cached into v_quotes for the row loop below.
  for v_mint in select distinct mint from _scan_page loop
    v_page_mints := v_page_mints + 1;
    begin
      select status, content into v_status, v_content
      from extensions.http_get('https://api.dexscreener.com/latest/dex/tokens/' || v_mint);

      if v_status = 200 then
        v_pair := app_private.pick_best_pair(v_content::jsonb, v_mint);
      else
        v_pair := null;
      end if;
    exception when others then
      v_pair := null;
    end;

    if v_pair is null then
      v_quote := jsonb_build_object('freshness', 'unavailable');
    else
      v_quote := jsonb_build_object(
        'freshness', 'fresh',
        'price', app_private.positive_or_null(v_pair ->> 'priceUsd'),
        'mcap', coalesce(
          app_private.positive_or_null(v_pair ->> 'marketCap'),
          app_private.positive_or_null(v_pair ->> 'fdv')
        ),
        'liq', app_private.positive_or_null(v_pair -> 'liquidity' ->> 'usd')
      );
    end if;

    v_quotes := v_quotes || jsonb_build_object(v_mint, v_quote);
  end loop;

  for v_call in select id, mint from _scan_page loop
    v_quote := v_quotes -> v_call.mint;
    perform public.worker_record_call_market_scan(
      v_call.id,
      'dexscreener',
      v_observed,
      (v_quote ->> 'price')::numeric,
      (v_quote ->> 'mcap')::numeric,
      (v_quote ->> 'liq')::numeric,
      coalesce(v_quote ->> 'freshness', 'unavailable')
    );
    if coalesce(v_quote ->> 'freshness', 'unavailable') = 'fresh' then
      v_scanned := v_scanned + 1;
    else
      v_unavailable := v_unavailable + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'unavailable', v_unavailable,
    'mints', v_page_mints,
    'observedAt', v_observed
  );
end;
$$;

revoke all on function app_private.scan_call_prices(integer) from public, anon, authenticated;
revoke all on function app_private.pick_best_pair(jsonb, text) from public, anon, authenticated;
revoke all on function app_private.positive_or_null(text) from public, anon, authenticated;
