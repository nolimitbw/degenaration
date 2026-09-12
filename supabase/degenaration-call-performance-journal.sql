-- Authoritative live call-performance journal.
-- No historical values are fabricated: existing calls start with their immutable call-time
-- price and accumulate observations only after this writer runs.
-- Rollback: supabase/rollback/25-call-performance-journal.sql.

alter table public.calls
  add column if not exists minimum_price_usd numeric,
  add column if not exists current_return_bps bigint,
  add column if not exists maximum_return_bps bigint,
  add column if not exists performance_provider text,
  add column if not exists performance_freshness text,
  add column if not exists performance_status text,
  add column if not exists tracking_started_at timestamptz;

update public.calls
set minimum_price_usd = coalesce(minimum_price_usd, called_price_usd),
    tracking_started_at = coalesce(tracking_started_at, last_scanned_at),
    performance_status = coalesce(
      performance_status,
      case when last_scanned_at is not null and called_price_usd > 0 and latest_price_usd > 0
           then 'measured' else 'insufficient_history' end
    )
where parse_status = 'accepted';

-- A pre-journal last_scanned_at proves a legacy scanner ran, but it cannot prove when any
-- milestone was first hit. Once the first immutable observation exists, that is the honest
-- start of milestone coverage for a call that predates this journal.
with first_scans as (
  select c.id, min(ms.observed_at) as observed_at
  from public.calls c
  join app_private.market_snapshots ms
    on ms.mint=c.mint and ms.payload->>'source'='discord-call-performance'
  group by c.id
)
update public.calls c
set tracking_started_at = first_scan.observed_at
from first_scans first_scan
where first_scan.observed_at is not null
  and first_scan.id=c.id
  and c.called_at < first_scan.observed_at - interval '10 minutes'
  and c.tracking_started_at is distinct from first_scan.observed_at;

create table if not exists app_private.call_performance_milestones (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete restrict,
  milestone text not null check (milestone in ('down_50', 'plus_50', 'two_x', 'five_x')),
  first_hit_at timestamptz not null,
  first_hit_price_usd numeric not null check (first_hit_price_usd > 0),
  provider text not null,
  scan_id uuid not null references app_private.market_snapshots(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (call_id, milestone)
);

alter table app_private.call_performance_milestones enable row level security;
revoke all on table app_private.call_performance_milestones from public, anon, authenticated;
create index if not exists call_performance_milestones_call_idx
  on app_private.call_performance_milestones (call_id, first_hit_at);

create or replace function public.worker_record_call_market_scan(
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
declare
  v_call public.calls%rowtype;
  v_scan_id uuid;
  v_current_bps bigint;
  v_maximum_bps bigint;
  v_milestones integer := 0;
begin
  if p_call_id is null or nullif(trim(coalesce(p_provider, '')), '') is null
    or p_freshness not in ('fresh', 'stale', 'unavailable')
    or p_observed_at is null or p_observed_at > now() + interval '5 minutes'
    or p_price_usd is not null and p_price_usd <= 0
    or p_market_cap_usd is not null and p_market_cap_usd <= 0
    or p_liquidity_usd is not null and p_liquidity_usd <= 0 then
    raise exception 'invalid market scan' using errcode = '22023';
  end if;

  select * into v_call from public.calls where id = p_call_id for update;
  if not found then raise exception 'call not found' using errcode = '22023'; end if;
  if v_call.parse_status <> 'accepted' or v_call.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'call is not actively monitored');
  end if;

  if p_price_usd is null then
    update public.calls
    set last_scanned_at = greatest(coalesce(last_scanned_at, p_observed_at), p_observed_at),
        tracking_started_at = coalesce(tracking_started_at, p_observed_at),
        performance_provider = left(trim(p_provider), 64),
        performance_freshness = p_freshness,
        performance_status = case
          when current_return_bps is not null then 'measured'
          when called_price_usd > 0 then 'unavailable'
          else 'insufficient_history'
        end
    where id = p_call_id;
    return jsonb_build_object('ok', true, 'measured', false, 'reason', 'price unavailable');
  end if;

  insert into app_private.scanner_tokens (
    mint, symbol, first_seen_at, last_seen_at, validation_status, validation_reason, metadata
  ) values (
    v_call.mint, v_call.symbol, least(v_call.called_at, p_observed_at), p_observed_at,
    'valid', 'validated before Discord call acceptance',
    jsonb_build_object('source', 'discord-call-performance')
  )
  on conflict (mint) do update
  set last_seen_at = greatest(app_private.scanner_tokens.last_seen_at, excluded.last_seen_at),
      symbol = coalesce(app_private.scanner_tokens.symbol, excluded.symbol);

  insert into app_private.market_snapshots (
    mint, provider, observed_at, price_usd, market_cap_usd, liquidity_usd,
    payload, freshness_status
  ) values (
    v_call.mint, left(trim(p_provider), 64), p_observed_at, p_price_usd,
    p_market_cap_usd, p_liquidity_usd,
    jsonb_build_object('source', 'discord-call-performance'), p_freshness
  )
  on conflict (mint, provider, observed_at) do nothing
  returning id into v_scan_id;

  if v_scan_id is null then
    select id into v_scan_id from app_private.market_snapshots
    where mint = v_call.mint and provider = left(trim(p_provider), 64)
      and observed_at = p_observed_at;
  end if;

  if v_call.called_price_usd > 0 then
    v_current_bps := floor((p_price_usd - v_call.called_price_usd) * 10000 / v_call.called_price_usd)::bigint;
    v_maximum_bps := greatest(coalesce(v_call.maximum_return_bps, 0), v_current_bps);
  end if;

  update public.calls
  set latest_price_usd = p_price_usd,
      peak_price_usd = greatest(coalesce(peak_price_usd, called_price_usd, p_price_usd), p_price_usd),
      minimum_price_usd = least(coalesce(minimum_price_usd, called_price_usd, p_price_usd), p_price_usd),
      latest_mcap = coalesce(p_market_cap_usd, latest_mcap),
      peak_mcap = case when p_market_cap_usd is null then peak_mcap
                       else greatest(coalesce(peak_mcap, called_mcap, p_market_cap_usd), p_market_cap_usd) end,
      latest_liquidity_usd = coalesce(p_liquidity_usd, latest_liquidity_usd),
      current_return_bps = v_current_bps,
      maximum_return_bps = v_maximum_bps,
      last_scanned_at = greatest(coalesce(last_scanned_at, p_observed_at), p_observed_at),
      tracking_started_at = coalesce(tracking_started_at, p_observed_at),
      performance_provider = left(trim(p_provider), 64),
      performance_freshness = p_freshness,
      performance_status = case when v_current_bps is null then 'insufficient_history' else 'measured' end
  where id = p_call_id;

  if v_call.called_price_usd > 0 then
    insert into app_private.call_performance_milestones
      (call_id, milestone, first_hit_at, first_hit_price_usd, provider, scan_id)
    select p_call_id, hit.milestone, p_observed_at, p_price_usd,
           left(trim(p_provider), 64), v_scan_id
    from (values
      ('down_50'::text, p_price_usd <= v_call.called_price_usd * 0.50),
      ('plus_50'::text, p_price_usd >= v_call.called_price_usd * 1.50),
      ('two_x'::text, p_price_usd >= v_call.called_price_usd * 2.00),
      ('five_x'::text, p_price_usd >= v_call.called_price_usd * 5.00)
    ) as hit(milestone, reached)
    where hit.reached
    on conflict (call_id, milestone) do nothing;
    get diagnostics v_milestones = row_count;
  end if;

  return jsonb_build_object(
    'ok', true, 'measured', v_current_bps is not null, 'scanId', v_scan_id,
    'currentReturnBps', v_current_bps, 'maximumReturnBps', v_maximum_bps,
    'newMilestones', v_milestones
  );
end;
$$;

revoke execute on function public.worker_record_call_market_scan(
  uuid, text, timestamptz, numeric, numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.worker_record_call_market_scan(
  uuid, text, timestamptz, numeric, numeric, numeric, text
) to service_role;

create or replace function public.app_public_discord_journal_stats(
  p_secret text,
  p_period text default '7d'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  v_since := case lower(p_period)
    when '1d' then now() - interval '1 day'
    when '30d' then now() - interval '30 days'
    else now() - interval '7 days'
  end;

  with parsed as (
    select ch.group_id, ps.status
    from app_private.parsed_signals ps
    join app_private.raw_signals rs on rs.id = ps.raw_signal_id
    join public.call_channels ch
      on ch.channel_id = rs.immutable_payload->>'channelId'
     and ch.guild_id = rs.immutable_payload->>'guildId'
    where rs.source_type = 'discord' and rs.received_at >= v_since
  ), parsed_stats as (
    select group_id, count(*)::integer total,
      count(*) filter (where status='accepted')::integer accepted,
      count(*) filter (where status='rejected')::integer rejected,
      count(*) filter (where status='duplicate')::integer duplicates
    from parsed group by group_id
  ), call_stats as (
    select c.group_id,
      count(*)::integer accepted,
      count(*) filter (where c.deleted_at is not null)::integer retracted,
      count(*) filter (where c.parse_status='accepted' and c.deleted_at is null
        and c.called_at >= now() - interval '30 days')::integer active_monitoring,
      count(*) filter (where c.performance_status='measured')::integer measured,
      percentile_cont(0.5) within group (order by c.current_return_bps)
        filter (where c.performance_status='measured') as median_current_bps,
      percentile_cont(0.5) within group (order by c.maximum_return_bps)
        filter (where c.performance_status='measured') as median_peak_bps,
      avg(c.maximum_return_bps) filter (where c.performance_status='measured') as average_peak_bps,
      bool_and(c.tracking_started_at <= c.called_at + interval '10 minutes')
        filter (where c.performance_status='measured') as milestone_coverage_complete,
      max(c.last_scanned_at) as freshness_at,
      (array_agg(c.performance_provider order by c.last_scanned_at desc nulls last))[1] as provider
    from public.calls c where c.called_at >= v_since group by c.group_id
  ), milestone_stats as (
    select c.group_id,
      count(*) filter (where m.milestone='down_50')::integer down_50_hits,
      count(*) filter (where m.milestone='plus_50')::integer plus_50_hits,
      count(*) filter (where m.milestone='two_x')::integer two_x_hits,
      count(*) filter (where m.milestone='five_x')::integer five_x_hits
    from app_private.call_performance_milestones m
    join public.calls c on c.id=m.call_id
    where c.called_at >= v_since group by c.group_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    -- Canonical calls are the accepted record of fact, including legacy calls that predate
    -- raw_signals. Parsed rows supply rejection diagnostics; counting accepted parses again
    -- would double-count every modern canonical call.
    'totalCalls', coalesce(cs.accepted, 0) + coalesce(ps.rejected, 0) + coalesce(ps.duplicates, 0),
    'acceptedCalls', coalesce(cs.accepted, 0),
    'rejectedCalls', coalesce(ps.rejected, 0),
    'duplicateSignals', coalesce(ps.duplicates, 0),
    'retractedCalls', coalesce(cs.retracted, 0),
    'activeMonitoring', coalesce(cs.active_monitoring, 0),
    'measuredCalls', coalesce(cs.measured, 0),
    'milestoneHistoryComplete', coalesce(cs.milestone_coverage_complete, false),
    'down50Hits', case when cs.milestone_coverage_complete then coalesce(ms.down_50_hits, 0) end,
    'plus50Hits', case when cs.milestone_coverage_complete then coalesce(ms.plus_50_hits, 0) end,
    'twoXHits', case when cs.milestone_coverage_complete then coalesce(ms.two_x_hits, 0) end,
    'fiveXHits', case when cs.milestone_coverage_complete then coalesce(ms.five_x_hits, 0) end,
    'down50Rate', case when cs.milestone_coverage_complete then round(100.0 * coalesce(ms.down_50_hits,0) / nullif(cs.measured, 0), 2) end,
    'plus50Rate', case when cs.milestone_coverage_complete then round(100.0 * coalesce(ms.plus_50_hits,0) / nullif(cs.measured, 0), 2) end,
    'twoXHitRate', case when cs.milestone_coverage_complete then round(100.0 * coalesce(ms.two_x_hits,0) / nullif(cs.measured, 0), 2) end,
    'fiveXHitRate', case when cs.milestone_coverage_complete then round(100.0 * coalesce(ms.five_x_hits,0) / nullif(cs.measured, 0), 2) end,
    'medianCurrentReturnBps', round(cs.median_current_bps)::bigint,
    'medianPeakReturnBps', round(cs.median_peak_bps)::bigint,
    'averagePeakReturnBps', round(cs.average_peak_bps)::bigint,
    'dataFreshnessAt', cs.freshness_at,
    'performanceProvider', cs.provider
  ) order by g.name), '[]'::jsonb)
  into v_rows
  from public.approved_groups g
  left join parsed_stats ps on ps.group_id=g.id
  left join call_stats cs on cs.group_id=g.id
  left join milestone_stats ms on ms.group_id=g.id
  where g.active and g.verification_status='approved' and g.removed_at is null;

  return jsonb_build_object('ok', true, 'period', lower(p_period), 'sources', v_rows);
end;
$$;

revoke execute on function public.app_public_discord_journal_stats(text, text)
  from public, anon, authenticated;
grant execute on function public.app_public_discord_journal_stats(text, text) to service_role;
