-- ============================================================
-- DEGENARATION — Discord call tracking + copy execution
-- Apply this whole file once in the Supabase SQL editor.
--
-- Bundles, in dependency order:
--   1. degenaration-multi-mint-calls.sql        every mint in a message becomes a call
--   2. degenaration-call-enrichment.sql         journal-first price enrichment
--   3. degenaration-call-milestones.sql         -50% / +50% / 2x / 5x outcomes + source stats
--   4. degenaration-subscription-filters.sql    per-client copy filters, enforced in the claim
--   5. degenaration-position-exits.sql          durable take-profit / stop-loss exits
--
-- Every statement is idempotent (create or replace / if not exists), so re-running is safe.
--
-- NOT INCLUDED: supabase/degenaration-bot-secret-gate.sql. That one carries a placeholder
-- hash and must be edited with your own BOT_SHARED_SECRET digest first — apply it
-- separately, and only if app_private.bot_secret_ok is missing from your project.
--
-- AFTER APPLYING: redeploy the bot-bridge edge function so the new `enrich_call`
-- operation is available (supabase/functions/bot-bridge/index.ts).
--
-- Verified end to end against PostgreSQL 16 before shipping: two mints in one Discord
-- message produce two calls, event replays dedupe, a wrong bot secret is rejected,
-- enrichment never overwrites a recorded entry price, a filtered call is skipped with
-- its reason, the same call claimed twice claims once, and source_call_stats scores
-- calls that have no subscriber at all. The exit lifecycle is likewise verified: an
-- unconfirmed fill never opens a position, a leg cannot be claimed twice, a failed exit
-- releases its claim to retry, and a stop-loss closes the position for good.
-- ============================================================


-- ============================================================
-- degenaration-multi-mint-calls.sql
-- ============================================================

-- Multi-mint Discord ingestion.
--
-- Product rule: ANY Solana mint posted in an approved channel is a call, so a single
-- Discord message naming three mints must produce three journal rows. This replaces
-- bot_ingest_discord_signal_v2 in place (same name and signature, so no caller changes)
-- with a per-mint `calls.message_id`, and widens the edit/delete lookups to match the
-- new row shape. Apply after degenaration-discord-signal-ingestion.sql.


create or replace function public.bot_ingest_discord_signal_v2(
  p_secret text,
  p_channel_id text,
  p_channel_name text,
  p_mint text,
  p_symbol text,
  p_called_mcap numeric,
  p_called_price_usd numeric,
  p_called_liquidity_usd numeric,
  p_message_id text,
  p_caller text,
  p_confidence text,
  p_event_type text,
  p_event_version text,
  p_edited_at timestamptz,
  p_parser_version text,
  p_confidence_bps integer,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_group_name text;
  v_guild_id text;
  v_source_ref text;
  v_external_event_id text;
  v_raw_id uuid;
  v_parsed_id uuid;
  v_call_id uuid;
  v_existing_call_id uuid;
  v_previous_mint text;
  v_parse_status text := 'accepted';
  v_rejection_reason text;
  v_legacy_message_id text;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_channel_id is null or p_channel_id !~ '^\d{17,20}$'
    or p_message_id is null or p_message_id !~ '^\d{17,20}$' then
    raise exception 'invalid Discord event identifiers' using errcode = '22023';
  end if;
  if p_event_type not in ('create', 'edit', 'delete')
    or nullif(trim(coalesce(p_event_version, '')), '') is null then
    raise exception 'invalid event version' using errcode = '22023';
  end if;
  if p_event_type <> 'delete'
    and (p_mint is null or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') then
    raise exception 'invalid mint' using errcode = '22023';
  end if;
  if p_confidence_bps is null or p_confidence_bps not between 0 and 10000
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid parser evidence' using errcode = '22023';
  end if;

  select ch.group_id, coalesce(g.name, ch.guild_name), ch.guild_id
  into v_group_id, v_group_name, v_guild_id
  from public.call_channels ch
  left join public.approved_groups g on g.id = ch.group_id
  where ch.channel_id = p_channel_id
    and ch.status = 'approved'
    and ch.removed_at is null
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'channel not approved', 'status', 403);
  end if;

  v_source_ref := 'discord:' || v_guild_id || ':' || p_channel_id;
  v_external_event_id := p_message_id || ':' || left(trim(p_event_version), 64);

  insert into app_private.raw_signals (
    source_type,
    source_ref,
    external_event_id,
    event_version,
    immutable_payload,
    content_hash,
    edited_at,
    deleted_at
  ) values (
    'discord',
    v_source_ref,
    v_external_event_id,
    left(trim(p_event_version), 64),
    jsonb_build_object(
      'guildId', v_guild_id,
      'channelId', p_channel_id,
      'channelName', nullif(left(trim(coalesce(p_channel_name, '')), 120), ''),
      'messageId', p_message_id,
      'eventType', p_event_type,
      'caller', nullif(left(trim(coalesce(p_caller, '')), 120), ''),
      'confidence', nullif(left(trim(coalesce(p_confidence, '')), 32), ''),
      'mint', nullif(left(trim(coalesce(p_mint, '')), 64), '')
    ),
    p_content_hash,
    case when p_event_type = 'edit' then coalesce(p_edited_at, now()) end,
    case when p_event_type = 'delete' then coalesce(p_edited_at, now()) end
  )
  on conflict (source_type, source_ref, external_event_id) do nothing
  returning id into v_raw_id;

  if v_raw_id is null then
    select id into v_raw_id
    from app_private.raw_signals
    where source_type = 'discord'
      and source_ref = v_source_ref
      and external_event_id = v_external_event_id;

    select ps.id into v_parsed_id
    from app_private.parsed_signals ps
    where ps.raw_signal_id = v_raw_id
      and ps.parser_version = left(trim(p_parser_version), 64);

    select c.id into v_existing_call_id
    from public.calls c
    where c.raw_event_id = v_raw_id
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'rawSignalId', v_raw_id,
      'parsedSignalId', v_parsed_id,
      'id', v_existing_call_id
    );
  end if;

  if p_event_type = 'delete' then
    v_parse_status := 'rejected';
    v_rejection_reason := 'source message deleted';
    update public.calls
    set deleted_at = coalesce(p_edited_at, now()),
        parse_status = 'rejected',
        rejection_reason = v_rejection_reason
    where channel_id = p_channel_id
      and (message_id = p_message_id or message_id like p_message_id || ':e:%' or message_id like p_message_id || ':m:%')
      and deleted_at is null;
  elsif p_event_type = 'edit' then
    select c.mint into v_previous_mint
    from public.calls c
    where c.channel_id = p_channel_id
      and (c.message_id = p_message_id or c.message_id like p_message_id || ':e:%' or c.message_id like p_message_id || ':m:%')
      and c.deleted_at is null
    order by c.called_at desc
    limit 1;

    if v_previous_mint = p_mint then
      v_parse_status := 'duplicate';
      v_rejection_reason := 'message edit did not change the mint';
    else
      update public.calls
      set deleted_at = coalesce(p_edited_at, now()),
          parse_status = 'rejected',
          rejection_reason = 'superseded by message edit'
      where channel_id = p_channel_id
        and (message_id = p_message_id or message_id like p_message_id || ':e:%' or message_id like p_message_id || ':m:%')
        and deleted_at is null;
    end if;
  end if;

  if v_parse_status = 'accepted' and exists (
    select 1
    from app_private.parsed_signals ps
    join app_private.raw_signals rs on rs.id = ps.raw_signal_id
    where ps.status = 'accepted'
      and ps.mint = p_mint
      and rs.source_ref = v_source_ref
      and rs.id <> v_raw_id
      and rs.received_at >= now() - interval '60 seconds'
  ) then
    v_parse_status := 'duplicate';
    v_rejection_reason := 'same token repeated inside the source cooldown';
  end if;

  insert into app_private.parsed_signals (
    raw_signal_id,
    parser_version,
    status,
    mint,
    confidence_bps,
    rejection_reason,
    normalized_payload
  ) values (
    v_raw_id,
    left(trim(p_parser_version), 64),
    v_parse_status,
    case when p_event_type = 'delete' then null else left(trim(p_mint), 64) end,
    p_confidence_bps,
    v_rejection_reason,
    jsonb_build_object(
      'symbol', nullif(left(trim(coalesce(p_symbol, '')), 32), ''),
      'calledMcapUsd', p_called_mcap,
      'calledPriceUsd', p_called_price_usd,
      'calledLiquidityUsd', p_called_liquidity_usd,
      'eventType', p_event_type
    )
  )
  on conflict (raw_signal_id, parser_version) do update
  set status = excluded.status
  returning id into v_parsed_id;

  if v_parse_status <> 'accepted' then
    return jsonb_build_object(
      'ok', true,
      'accepted', false,
      'status', v_parse_status,
      'reason', v_rejection_reason,
      'rawSignalId', v_raw_id,
      'parsedSignalId', v_parsed_id
    );
  end if;

  -- One Discord message can name several mints, and each one is its own call. The
  -- legacy `calls.message_id` column is unique, so it carries the per-mint event
  -- version too. 'original' (the /alpha slash path) keeps the bare id for back-compat.
  v_legacy_message_id := case
    when p_event_type = 'edit'
      then left(p_message_id || ':e:' || left(trim(p_event_version), 32), 64)
    when trim(coalesce(p_event_version, '')) in ('', 'original')
      then p_message_id
    else left(p_message_id || ':m:' || left(trim(p_event_version), 32), 64)
  end;

  insert into public.calls (
    group_id,
    group_name,
    mint,
    symbol,
    called_mcap,
    called_price_usd,
    peak_price_usd,
    latest_price_usd,
    peak_mcap,
    latest_mcap,
    called_liquidity_usd,
    latest_liquidity_usd,
    channel_id,
    channel_name,
    caller,
    confidence,
    message_id,
    parser_version,
    parser_confidence,
    parse_status,
    raw_event_id,
    parsed_signal_id,
    edited_at
  ) values (
    v_group_id,
    v_group_name,
    left(trim(p_mint), 64),
    nullif(left(trim(coalesce(p_symbol, '')), 32), ''),
    p_called_mcap,
    p_called_price_usd,
    p_called_price_usd,
    p_called_price_usd,
    p_called_mcap,
    p_called_mcap,
    p_called_liquidity_usd,
    p_called_liquidity_usd,
    p_channel_id,
    nullif(left(trim(coalesce(p_channel_name, '')), 120), ''),
    nullif(left(trim(coalesce(p_caller, '')), 120), ''),
    nullif(left(trim(coalesce(p_confidence, '')), 32), ''),
    v_legacy_message_id,
    left(trim(p_parser_version), 64),
    p_confidence_bps::numeric / 10000,
    'accepted',
    v_raw_id,
    v_parsed_id,
    case when p_event_type = 'edit' then coalesce(p_edited_at, now()) end
  )
  on conflict (message_id) where message_id is not null do nothing
  returning id into v_call_id;

  if v_call_id is null then
    select id into v_call_id
    from public.calls
    where message_id = v_legacy_message_id
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'id', v_call_id,
    'rawSignalId', v_raw_id,
    'parsedSignalId', v_parsed_id,
    'group', v_group_name,
    'mint', p_mint,
    'symbol', p_symbol,
    'entryPriceUsd', p_called_price_usd
  );
end;
$$;

revoke execute on function public.bot_ingest_discord_signal_v2(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text,
  text, text, timestamptz, text, integer, text
) from public, anon, authenticated;

grant execute on function public.bot_ingest_discord_signal_v2(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text,
  text, text, timestamptz, text, integer, text
) to service_role;

-- ============================================================
-- degenaration-call-enrichment.sql
-- ============================================================

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

-- ============================================================
-- degenaration-call-milestones.sql
-- ============================================================

-- Honest per-call outcomes, recorded whether or not anyone copied the call.
--
-- Every Discord source accrues a public record from the same live data: how many of its
-- calls ran +50%, 2x, 5x, and how many bled -50%. Nothing here depends on a subscriber
-- existing — the performance scanner prices every journaled call.
--
-- Milestones are write-once timestamps against the call's PEAK (for the up legs) and
-- TROUGH (for the down leg). A call that ran 3x and round-tripped keeps its 2x badge:
-- that is what actually happened, and pretending otherwise would flatter nobody.

alter table public.calls
  add column if not exists trough_price_usd numeric,
  add column if not exists hit_down_50_at timestamptz,
  add column if not exists hit_up_50_at timestamptz,
  add column if not exists hit_2x_at timestamptz,
  add column if not exists hit_5x_at timestamptz,
  add column if not exists outcome text;

comment on column public.calls.outcome is
  'open | win | loss — win once the call ran +50% from entry, loss once it fell -50%, whichever came first.';

-- The scanner sweeps by age, and the journal reads by source.
create index if not exists calls_scan_idx on public.calls (called_at desc, last_scanned_at nulls first);
create index if not exists calls_group_called_idx on public.calls (group_id, called_at desc);

-- ============================================================
-- Per-source public record
-- ============================================================
drop view if exists public.source_call_stats;
create view public.source_call_stats
with (security_invoker = true)
as
select
  c.group_id,
  count(*)::int                                                as calls,
  count(*) filter (where c.hit_up_50_at is not null)::int      as calls_up_50,
  count(*) filter (where c.hit_2x_at is not null)::int         as calls_2x,
  count(*) filter (where c.hit_5x_at is not null)::int         as calls_5x,
  count(*) filter (where c.hit_down_50_at is not null)::int    as calls_down_50,
  count(*) filter (where c.outcome = 'win')::int               as wins,
  count(*) filter (where c.outcome = 'loss')::int              as losses,
  count(*) filter (where c.outcome = 'open' or c.outcome is null)::int as open_calls,
  -- Win rate over SETTLED calls only; an open call has not proved anything yet.
  case
    when count(*) filter (where c.outcome in ('win', 'loss')) = 0 then null
    else round(
      100.0 * count(*) filter (where c.outcome = 'win')
      / count(*) filter (where c.outcome in ('win', 'loss'))
    )::int
  end                                                          as win_rate,
  max(c.peak_price_usd / nullif(c.called_price_usd, 0))         as best_multiple,
  percentile_cont(0.5) within group (
    order by c.peak_price_usd / nullif(c.called_price_usd, 0)
  )                                                            as median_peak_multiple,
  max(c.called_at)                                             as last_call_at
from public.calls c
where c.group_id is not null
  and c.deleted_at is null
  and coalesce(c.parse_status, 'accepted') = 'accepted'
group by c.group_id;

grant select on public.source_call_stats to anon, authenticated, service_role;

-- ============================================================
-- degenaration-subscription-filters.sql
-- ============================================================

-- Per-subscription copy filters.
--
-- These are the CLIENT's own preferences about which of a source's calls they want
-- mirrored — not a platform safety gate. Every one of them is null/0 by default, which
-- means "take every call this source makes". They are enforced inside
-- worker_claim_call_execution so the decision is atomic with the claim, in the same
-- place the daily cap already lives, and every skip is written to call_executions with
-- its reason so the client can see exactly why a call passed them by.

alter table public.subscriptions
  add column if not exists min_liquidity_usd numeric,
  add column if not exists max_mcap_usd numeric,
  add column if not exists cooldown_seconds int not null default 0,
  add column if not exists skip_duplicate_mints boolean not null default true,
  add column if not exists max_open_positions int,
  add column if not exists max_calls_per_day int;

comment on column public.subscriptions.skip_duplicate_mints is
  'Do not buy a mint this subscription already bought (guards against the same token being called repeatedly).';
comment on column public.subscriptions.cooldown_seconds is
  'Minimum gap between two executed buys on this subscription. 0 = no cooldown.';

create index if not exists call_executions_sub_created_idx
  on app_private.call_executions (subscription_id, created_at desc);

-- ============================================================
-- Claim, now filter-aware
-- ============================================================
create or replace function public.worker_claim_call_execution(
  p_call_id uuid,
  p_subscription_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_sub public.subscriptions%rowtype;
  v_existing app_private.call_executions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_spent numeric;
  v_day date := (now() at time zone 'utc')::date;
  v_skip text;
  v_skip_status integer := 422;
  v_last_started timestamptz;
  v_count integer;
begin
  select * into v_call
  from public.calls c
  where c.id = p_call_id and c.executed_at is null;

  if not found or v_call.group_id is null then
    return jsonb_build_object('ok', false, 'error', 'call unavailable', 'status', 409);
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.id = p_subscription_id
    and s.group_id = v_call.group_id
    and s.enabled = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription unavailable', 'status', 409);
  end if;

  select * into v_existing
  from app_private.call_executions e
  where e.call_id = p_call_id and e.subscription_id = p_subscription_id;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error', 'execution already claimed',
      'status', 409,
      'execution_status', v_existing.status
    );
  end if;

  -- ---- hard preconditions ----
  if nullif(v_sub.wallet_id, '') is null or nullif(v_sub.user_pubkey, '') is null then
    v_skip := 'delegated wallet unavailable';
  elsif coalesce(v_sub.size_sol, 0) <= 0 or coalesce(v_sub.daily_cap_sol, 0) <= 0 then
    v_skip := 'invalid trade limits';
  end if;

  -- ---- the client's own filters ----
  if v_skip is null and v_sub.min_liquidity_usd is not null
    and coalesce(v_call.called_liquidity_usd, 0) < v_sub.min_liquidity_usd then
    v_skip := 'below your minimum liquidity';
  end if;

  if v_skip is null and v_sub.max_mcap_usd is not null
    and v_call.called_mcap is not null and v_call.called_mcap > v_sub.max_mcap_usd then
    v_skip := 'above your maximum market cap';
  end if;

  if v_skip is null and coalesce(v_sub.skip_duplicate_mints, true) then
    if exists (
      select 1
      from app_private.call_executions e
      join public.calls c2 on c2.id = e.call_id
      where e.subscription_id = v_sub.id
        and e.status in ('claimed', 'succeeded')
        and c2.mint = v_call.mint
    ) then
      v_skip := 'you already bought this token from this source';
    end if;
  end if;

  if v_skip is null and coalesce(v_sub.cooldown_seconds, 0) > 0 then
    select max(e.created_at) into v_last_started
    from app_private.call_executions e
    where e.subscription_id = v_sub.id
      and e.status in ('claimed', 'succeeded');
    if v_last_started is not null
      and v_last_started > now() - make_interval(secs => v_sub.cooldown_seconds) then
      v_skip := 'still inside your cooldown';
      v_skip_status := 429;
    end if;
  end if;

  if v_skip is null and v_sub.max_calls_per_day is not null then
    select count(*) into v_count
    from app_private.call_executions e
    where e.subscription_id = v_sub.id
      and e.status in ('claimed', 'succeeded')
      and e.created_at >= date_trunc('day', now() at time zone 'utc');
    if v_count >= v_sub.max_calls_per_day then
      v_skip := 'daily call limit reached';
      v_skip_status := 429;
    end if;
  end if;

  -- How many positions this wallet is currently holding, across every source.
  if v_skip is null and v_sub.max_open_positions is not null then
    select count(*) into v_count
    from public.positions p
    where p.user_pubkey = v_sub.user_pubkey
      and p.status = 'open';
    if v_count >= v_sub.max_open_positions then
      v_skip := 'at your open position limit';
      v_skip_status := 429;
    end if;
  end if;

  -- ---- daily SOL cap ----
  v_spent := case when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_spent, 0) else 0 end;
  if v_skip is null and v_spent + v_sub.size_sol > v_sub.daily_cap_sol then
    v_skip := 'daily cap reached';
    v_skip_status := 429;
  end if;

  if v_skip is not null then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped',
      greatest(coalesce(v_sub.size_sol, 0), 0), v_skip, now()
    );
    return jsonb_build_object('ok', false, 'error', v_skip, 'status', v_skip_status);
  end if;

  update public.subscriptions
  set daily_spent = v_spent + v_sub.size_sol,
      daily_spent_on = v_day
  where id = v_sub.id;

  insert into app_private.call_executions (
    call_id, subscription_id, claim_token, status, amount_sol
  ) values (
    p_call_id, p_subscription_id, v_claim, 'claimed', v_sub.size_sol
  );

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'subscription_id', v_sub.id,
    'privy_user_id', v_sub.privy_user_id,
    'user_pubkey', v_sub.user_pubkey,
    'wallet_id', v_sub.wallet_id,
    'size_sol', v_sub.size_sol,
    'slippage_bps', greatest(1, least(coalesce(v_sub.slippage_bps, 300), 5000)),
    'daily_spent', v_spent + v_sub.size_sol,
    'daily_cap_sol', v_sub.daily_cap_sol
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'execution already claimed', 'status', 409);
end;
$$;

revoke execute on function public.worker_claim_call_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_claim_call_execution(uuid, uuid) to service_role;


-- ============================================================
-- Client-facing read/write of the new filter fields
-- ============================================================
create or replace function public.app_user_list_subscriptions(p_secret text, p_privy_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  into v_rows
  from (
    select group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell, stop_loss,
      slippage_bps, daily_cap_sol, enabled,
      min_liquidity_usd, max_mcap_usd, cooldown_seconds,
      skip_duplicate_mints, max_open_positions, max_calls_per_day
    from public.subscriptions
    where privy_user_id = p_privy_user_id
    order by created_at desc
  ) s;
  return v_rows;
end;
$$;

-- Filters are optional: a key absent from the payload leaves the stored value alone on
-- update, and falls back to "take every call" on insert.
create or replace function public.app_user_upsert_subscription(
  p_secret text,
  p_privy_user_id text,
  p_group_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_row jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select id into v_id
  from public.subscriptions
  where privy_user_id = p_privy_user_id and group_id = p_group_id
  limit 1;

  if v_id is null then
    insert into public.subscriptions (
      privy_user_id, group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell,
      stop_loss, slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id,
      min_liquidity_usd, max_mcap_usd, cooldown_seconds,
      skip_duplicate_mints, max_open_positions, max_calls_per_day
    ) values (
      p_privy_user_id, p_group_id,
      (p_payload->>'size_sol')::numeric,
      (p_payload->>'tp1')::numeric,
      (p_payload->>'tp1_sell')::integer,
      (p_payload->>'tp2')::numeric,
      (p_payload->>'tp2_sell')::integer,
      (p_payload->>'stop_loss')::integer,
      (p_payload->>'slippage_bps')::integer,
      (p_payload->>'daily_cap_sol')::numeric,
      coalesce((p_payload->>'enabled')::boolean, true),
      nullif(p_payload->>'user_pubkey', ''),
      nullif(p_payload->>'wallet_id', ''),
      (p_payload->>'min_liquidity_usd')::numeric,
      (p_payload->>'max_mcap_usd')::numeric,
      coalesce((p_payload->>'cooldown_seconds')::integer, 0),
      coalesce((p_payload->>'skip_duplicate_mints')::boolean, true),
      (p_payload->>'max_open_positions')::integer,
      (p_payload->>'max_calls_per_day')::integer
    )
    returning to_jsonb(subscriptions.*) into v_row;
  else
    update public.subscriptions
    set size_sol = (p_payload->>'size_sol')::numeric,
      tp1 = (p_payload->>'tp1')::numeric,
      tp1_sell = (p_payload->>'tp1_sell')::integer,
      tp2 = (p_payload->>'tp2')::numeric,
      tp2_sell = (p_payload->>'tp2_sell')::integer,
      stop_loss = (p_payload->>'stop_loss')::integer,
      slippage_bps = (p_payload->>'slippage_bps')::integer,
      daily_cap_sol = (p_payload->>'daily_cap_sol')::numeric,
      enabled = coalesce((p_payload->>'enabled')::boolean, true),
      user_pubkey = nullif(p_payload->>'user_pubkey', ''),
      wallet_id = nullif(p_payload->>'wallet_id', ''),
      min_liquidity_usd = case when p_payload ? 'min_liquidity_usd'
        then (p_payload->>'min_liquidity_usd')::numeric else min_liquidity_usd end,
      max_mcap_usd = case when p_payload ? 'max_mcap_usd'
        then (p_payload->>'max_mcap_usd')::numeric else max_mcap_usd end,
      cooldown_seconds = case when p_payload ? 'cooldown_seconds'
        then coalesce((p_payload->>'cooldown_seconds')::integer, 0) else cooldown_seconds end,
      skip_duplicate_mints = case when p_payload ? 'skip_duplicate_mints'
        then coalesce((p_payload->>'skip_duplicate_mints')::boolean, true) else skip_duplicate_mints end,
      max_open_positions = case when p_payload ? 'max_open_positions'
        then (p_payload->>'max_open_positions')::integer else max_open_positions end,
      max_calls_per_day = case when p_payload ? 'max_calls_per_day'
        then (p_payload->>'max_calls_per_day')::integer else max_calls_per_day end
    where id = v_id
    returning to_jsonb(subscriptions.*) into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.app_user_list_subscriptions(text, text) to anon, authenticated;
grant execute on function public.app_user_upsert_subscription(text, text, uuid, jsonb) to anon, authenticated;


-- ============================================================
-- degenaration-position-exits.sql
-- ============================================================

-- Durable take-profit / stop-loss exits.
--
-- WHY: entries were being executed and recorded, but nothing ever sold. The TP/SL engine
-- (server/engine/monitor.js) was never started by the worker, held positions in an
-- in-memory array, and no code path ever wrote a public.positions row. A subscriber's
-- configured exits were collected, saved and displayed, then silently ignored — a token
-- that went to zero rode to zero. This closes that.
--
-- Each exit leg (tp1 / tp2 / sl) is claimed exactly once per position, using the same
-- protocol that already keeps two workers from double-buying a call: a unique claim row
-- taken under lock, redeemed with a claim token. A crashed worker leaves a stale claim
-- rather than an unrecorded sell, which is the safe direction to fail.

-- ============================================================
-- Positions: link back to what caused them, and carry a Privy owner
-- ============================================================
alter table public.positions
  add column if not exists privy_user_id text,
  add column if not exists group_id uuid references public.approved_groups(id) on delete set null,
  add column if not exists call_id uuid references public.calls(id) on delete set null,
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null,
  add column if not exists opened_by text,
  add column if not exists last_price_usd numeric,
  add column if not exists last_checked_at timestamptz;

comment on column public.positions.opened_by is
  'Which engine opened this position: call | copy | limit | manual.';

-- One position per (call, subscription): re-running an entry cannot fork a second
-- position that would then be sold twice.
create unique index if not exists positions_call_subscription_unique
  on public.positions (call_id, subscription_id)
  where call_id is not null and subscription_id is not null;

create index if not exists positions_open_idx
  on public.positions (status, last_checked_at nulls first)
  where status = 'open';

-- ============================================================
-- Exit claims
-- ============================================================
create table if not exists app_private.position_exits (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  leg text not null check (leg in ('tp1', 'tp2', 'sl')),
  claim_token uuid not null default gen_random_uuid(),
  status text not null check (status in ('claimed', 'succeeded', 'failed')),
  amount_raw numeric not null check (amount_raw > 0),
  trigger_multiple numeric,
  tx_signature text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (position_id, leg)
);

create unique index if not exists position_exits_signature_unique
  on app_private.position_exits (tx_signature)
  where tx_signature is not null;

revoke all on table app_private.position_exits from public, anon, authenticated;

-- ============================================================
-- Open a position when an entry actually fills
-- ============================================================
-- p_amount_raw must be the CONFIRMED filled amount derived from the swap transaction,
-- not the quoted amount — selling a quantity the wallet does not hold fails on-chain.
create or replace function public.worker_open_position(
  p_call_id uuid,
  p_subscription_id uuid,
  p_mint text,
  p_entry_price_usd numeric,
  p_amount_raw numeric,
  p_entry_sig text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_id uuid;
begin
  if p_amount_raw is null or p_amount_raw <= 0 then
    return jsonb_build_object('ok', false, 'error', 'filled amount required', 'status', 400);
  end if;
  if p_entry_price_usd is null or p_entry_price_usd <= 0 then
    -- Without an entry price there is no multiple to measure exits against, so the
    -- position would never legitimately trigger. Refuse rather than open a blind one.
    return jsonb_build_object('ok', false, 'error', 'entry price required', 'status', 400);
  end if;

  select * into v_sub from public.subscriptions s where s.id = p_subscription_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription unavailable', 'status', 409);
  end if;

  insert into public.positions (
    user_id, privy_user_id, user_pubkey, wallet_id, mint,
    entry_price_usd, amount_raw,
    tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps,
    status, entry_sig, group_id, call_id, subscription_id, opened_by
  ) values (
    v_sub.user_id, v_sub.privy_user_id, v_sub.user_pubkey, v_sub.wallet_id, p_mint,
    p_entry_price_usd, p_amount_raw,
    v_sub.tp1, v_sub.tp1_sell, v_sub.tp2, v_sub.tp2_sell, v_sub.stop_loss,
    greatest(1, least(coalesce(v_sub.slippage_bps, 300), 5000)),
    'open', nullif(trim(coalesce(p_entry_sig, '')), ''),
    v_sub.group_id, p_call_id, p_subscription_id, 'call'
  )
  on conflict (call_id, subscription_id) where call_id is not null and subscription_id is not null
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.positions
    where call_id = p_call_id and subscription_id = p_subscription_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'already_open', true);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ============================================================
-- Claim one exit leg
-- ============================================================
create or replace function public.worker_claim_position_exit(
  p_position_id uuid,
  p_leg text,
  p_multiple numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos public.positions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_amount numeric;
  v_pct numeric;
begin
  if p_leg not in ('tp1', 'tp2', 'sl') then
    return jsonb_build_object('ok', false, 'error', 'invalid exit leg', 'status', 400);
  end if;

  select * into v_pos from public.positions p
  where p.id = p_position_id and p.status = 'open'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'position unavailable', 'status', 409);
  end if;
  if nullif(v_pos.wallet_id, '') is null or nullif(v_pos.user_pubkey, '') is null then
    return jsonb_build_object('ok', false, 'error', 'delegated wallet unavailable', 'status', 422);
  end if;

  -- A stop-loss exits the whole remaining position; take-profits sell their configured
  -- share of what is still held.
  if p_leg = 'sl' then
    v_amount := v_pos.amount_raw;
  else
    if p_leg = 'tp1' and v_pos.filled_tp1 then
      return jsonb_build_object('ok', false, 'error', 'leg already filled', 'status', 409);
    end if;
    if p_leg = 'tp2' and v_pos.filled_tp2 then
      return jsonb_build_object('ok', false, 'error', 'leg already filled', 'status', 409);
    end if;
    v_pct := case when p_leg = 'tp1' then v_pos.tp1_sell else v_pos.tp2_sell end;
    if coalesce(v_pct, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'leg sells nothing', 'status', 422);
    end if;
    v_amount := floor(v_pos.amount_raw * least(v_pct, 100) / 100.0);
  end if;

  if coalesce(v_amount, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'nothing left to sell', 'status', 409);
  end if;

  insert into app_private.position_exits (position_id, leg, claim_token, status, amount_raw, trigger_multiple)
  values (p_position_id, p_leg, v_claim, 'claimed', v_amount, p_multiple);

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'position_id', v_pos.id,
    'leg', p_leg,
    'mint', v_pos.mint,
    'amount_raw', v_amount,
    'user_pubkey', v_pos.user_pubkey,
    'wallet_id', v_pos.wallet_id,
    'privy_user_id', v_pos.privy_user_id,
    'slippage_bps', greatest(1, least(coalesce(v_pos.slippage_bps, 300), 5000))
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'exit already claimed', 'status', 409);
end;
$$;

-- ============================================================
-- Redeem an exit claim
-- ============================================================
create or replace function public.worker_finish_position_exit(
  p_position_id uuid,
  p_leg text,
  p_claim_token uuid,
  p_status text,
  p_sig text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric;
  v_remaining numeric;
begin
  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid status', 'status', 400);
  end if;
  if p_status = 'succeeded' and nullif(trim(coalesce(p_sig, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'signature required', 'status', 400);
  end if;

  update app_private.position_exits
  set status = p_status,
      tx_signature = case when p_status = 'succeeded' then trim(p_sig) else tx_signature end,
      error = case when p_status = 'failed' then left(coalesce(p_error, 'exit failed'), 300) else null end,
      updated_at = now(),
      finished_at = now()
  where position_id = p_position_id
    and leg = p_leg
    and claim_token = p_claim_token
    and status = 'claimed'
  returning amount_raw into v_amount;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;

  -- A failed exit releases its claim so the next tick can retry the same leg.
  if p_status = 'failed' then
    delete from app_private.position_exits
    where position_id = p_position_id and leg = p_leg and claim_token = p_claim_token;
    return jsonb_build_object('ok', true, 'retryable', true);
  end if;

  update public.positions
  set amount_raw = greatest(amount_raw - v_amount, 0),
      filled_tp1 = filled_tp1 or p_leg = 'tp1',
      filled_tp2 = filled_tp2 or p_leg = 'tp2',
      status = case when p_leg = 'sl' or amount_raw - v_amount <= 0 then 'closed' else status end,
      closed_at = case when p_leg = 'sl' or amount_raw - v_amount <= 0 then now() else closed_at end
  where id = p_position_id
  returning amount_raw into v_remaining;

  return jsonb_build_object('ok', true, 'remaining_raw', v_remaining);
end;
$$;

-- ============================================================
-- What the monitor polls
-- ============================================================
create or replace function public.worker_open_positions(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  into v_rows
  from (
    select id, mint, user_pubkey, wallet_id, privy_user_id, entry_price_usd, amount_raw,
      tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps, filled_tp1, filled_tp2
    from public.positions
    where status = 'open'
      and amount_raw > 0
      and entry_price_usd > 0
    order by last_checked_at nulls first, created_at
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  ) p;
  return v_rows;
end;
$$;

create or replace function public.worker_touch_position(p_position_id uuid, p_price_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.positions
  set last_price_usd = coalesce(p_price_usd, last_price_usd),
      last_checked_at = now()
  where id = p_position_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.worker_open_position(uuid, uuid, text, numeric, numeric, text) from public, anon, authenticated;
revoke execute on function public.worker_claim_position_exit(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.worker_finish_position_exit(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.worker_open_positions(integer) from public, anon, authenticated;
revoke execute on function public.worker_touch_position(uuid, numeric) from public, anon, authenticated;

grant execute on function public.worker_open_position(uuid, uuid, text, numeric, numeric, text) to service_role;
grant execute on function public.worker_claim_position_exit(uuid, text, numeric) to service_role;
grant execute on function public.worker_finish_position_exit(uuid, text, uuid, text, text, text) to service_role;
grant execute on function public.worker_open_positions(integer) to service_role;
grant execute on function public.worker_touch_position(uuid, numeric) to service_role;
