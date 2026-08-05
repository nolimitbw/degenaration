-- Every return figure the marketplace showed was a PEAK. Nothing said so, and nothing said
-- where the call is now.
--
-- THE DEFECT
--
-- `period_calls` computes two multiples per call: `peak_x` (best it ever traded) and
-- `current_x` (where it is now). Every aggregate built from them used peak_x alone —
-- average_return_x, median_return_x, win_rate, two_x_rate and all five distribution buckets.
-- current_x was computed and then used for exactly one thing, max_drawdown_bps.
--
-- So a source whose ten calls each touched 2x and then went to zero reported:
--
--     Win rate 100%   Average return 2.00x   Median return 2.00x   Reached 2x: 10
--
-- while every one of those calls is currently down ~100%. Nothing in the payload contradicts
-- it, and nothing in the labels says "peak". Spec section 6 forbids ranking by cherry-picked
-- successful calls; an average of best-case outcomes is that, computed rather than curated.
--
-- Max drawdown does encode the round trip, so the information was derivable by a reader who
-- knew what the numbers meant. That is not the same as reporting it.
--
-- WHAT THIS ADDS
--
--     averageCurrentX     mean of current_x over measured accepted calls
--     medianCurrentX      median of the same — the robust one, and what the card shows
--     currentWinRate      share of measured calls trading above entry RIGHT NOW
--     measuredCurrent     how many calls have a current multiple at all
--
-- `winRate` keeps its meaning — the share that traded above entry at any point — because
-- three surfaces already read it under that definition and it is a real statistic. It is now
-- one of a pair rather than the only answer, and the UI labels both.
--
-- measuredCurrent is separate from measuredCalls on purpose: a call can have a peak and no
-- current price when the pair stops resolving, and averaging over a shrinking denominator
-- without saying so is how a dead token quietly stops counting against a source.
--
-- Unknown stays unknown. A source with no measured calls returns null for every one of
-- these, exactly as it already did for the peak figures.
--
-- Apply after degenaration-discord-call-performance.sql, which this replaces in full at the
-- same arity (4). No table DDL, no DML.
-- Rollback: supabase/rollback/10-discord-current-return.sql.

create or replace function public.app_public_list_discord_marketplace(
  p_secret text,
  p_period text default '7d',
  p_sort text default 'performance',
  p_limit integer default 50
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

  with period_calls as (
    select
      c.id,
      c.group_id,
      c.called_at,
      c.parse_status,
      c.mint,
      c.symbol,
      greatest(
        case
          when c.called_price_usd > 0 and c.peak_price_usd is not null
            then c.peak_price_usd / c.called_price_usd
        end,
        case
          when c.called_mcap > 0 and c.peak_mcap is not null
            then c.peak_mcap / c.called_mcap
        end
      ) as peak_x,
      greatest(
        case
          when c.called_price_usd > 0 and c.latest_price_usd is not null
            then c.latest_price_usd / c.called_price_usd
        end,
        case
          when c.called_mcap > 0 and c.latest_mcap is not null
            then c.latest_mcap / c.called_mcap
        end
      ) as current_x
    from public.calls c
    where c.called_at >= v_since
      and c.deleted_at is null
  ),
  metrics as (
    select
      c.group_id,
      count(*) filter (where c.parse_status = 'accepted')::integer as accepted_calls,
      count(*) filter (where c.parse_status in ('rejected', 'duplicate'))::integer as rejected_calls,
      count(c.peak_x) filter (where c.parse_status = 'accepted')::integer as measured_calls,
      -- Buckets are exclusive and ordered on peak multiple, lowest first.
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x < 0.5)::integer as down_50,
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 0.5 and c.peak_x < 1.5)::integer as under_50,
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 1.5 and c.peak_x < 2)::integer as plus_50,
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 2 and c.peak_x < 5)::integer as two_x,
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 5)::integer as five_x,
      round((avg(c.peak_x) filter (where c.parse_status = 'accepted'))::numeric, 4) as average_return_x,
      round((
        percentile_cont(0.5) within group (order by c.peak_x)
          filter (where c.parse_status = 'accepted')
      )::numeric, 4) as median_return_x,
      -- Where the calls are NOW, over the same population. Its own denominator: a call can
      -- have a peak and no current multiple once its pair stops resolving, and folding those
      -- into the peak count would quietly drop dead tokens out of the average.
      count(c.current_x) filter (where c.parse_status = 'accepted')::integer as measured_current,
      round((avg(c.current_x) filter (where c.parse_status = 'accepted'))::numeric, 4) as average_current_x,
      round((
        percentile_cont(0.5) within group (order by c.current_x)
          filter (where c.parse_status = 'accepted')
      )::numeric, 4) as median_current_x,
      round((
        100.0 * count(*) filter (where c.parse_status = 'accepted' and c.current_x > 1)
          / nullif(count(c.current_x) filter (where c.parse_status = 'accepted'), 0)
      )::numeric, 2) as current_win_rate,
      -- A win is a call that traded above entry at any point.
      round((
        100.0 * count(*) filter (where c.parse_status = 'accepted' and c.peak_x > 1)
          / nullif(count(c.peak_x) filter (where c.parse_status = 'accepted'), 0)
      )::numeric, 2) as win_rate,
      -- The share that doubled. Previously returned under the name "win_rate".
      round((
        100.0 * count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 2)
          / nullif(count(c.peak_x) filter (where c.parse_status = 'accepted'), 0)
      )::numeric, 2) as two_x_rate,
      round(max(
        case
          when c.parse_status = 'accepted' and c.peak_x > 0 and c.current_x is not null
            then greatest(0, (1 - (c.current_x / c.peak_x)) * 10000)
        end
      )::numeric, 0) as max_drawdown_bps
    from period_calls c
    group by c.group_id
  ),
  activity as (
    select
      c.group_id,
      max(c.called_at) filter (where c.parse_status = 'accepted') as last_signal_at,
      max(c.executed_at) as last_processed_call_at,
      max(c.last_scanned_at) filter (where c.parse_status = 'accepted') as data_freshness_at
    from public.calls c
    where c.deleted_at is null
    group by c.group_id
  ),
  execution_metrics as (
    select
      c.group_id,
      count(distinct e.call_id) filter (
        where c.called_at >= v_since and e.status = 'succeeded'
      )::integer as executed_calls,
      max(e.finished_at) filter (where e.status = 'succeeded') as last_successful_execution_at
    from public.calls c
    join app_private.call_executions e on e.call_id = c.id
    where c.deleted_at is null
    group by c.group_id
  ),
  -- Confirmed copied volume, from the authoritative ledger. source_group_id_snapshot is
  -- captured at settlement, so a later change of source ownership cannot rewrite history.
  copied as (
    select
      e.source_group_id_snapshot as group_id,
      count(*)::integer as copied_executions,
      coalesce(sum(e.gross_notional_lamports), 0) as copied_volume_lamports
    from app_private.trade_executions e
    where e.source_group_id_snapshot is not null
      and e.status in ('confirmed', 'reconciled')
      and coalesce(e.confirmed_at, e.created_at) >= v_since
    group by e.source_group_id_snapshot
  ),
  source_rows as (
    select
      g.id,
      g.name,
      g.members,
      g.avatar_url as "avatarUrl",
      g.banner_url as "bannerUrl",
      coalesce(
        nullif(trim(g.bio), ''),
        nullif(trim(g.discord_description), ''),
        'Approved Discord source building a measured call history on DegenAration.'
      ) as description,
      g.owner_display_name as "ownerDisplayName",
      g.discord_invite_url as "joinUrl",
      g.public_slug as "publicSlug",
      g.referral_code as "referralCode",
      g.creator_fee_bps as "creatorFeeBps",
      g.verification_status as "verificationStatus",
      g.marketplace_visible as "marketplaceVisible",
      case
        when g.integration_health = 'unavailable'
          and coalesce(g.profile_sync_failed_at, g.profile_sync_grace_started_at) >= now() - interval '7 days'
          then 'degraded'
        else g.integration_health
      end as "integrationHealth",
      coalesce(m.accepted_calls, 0) as "eligibleCalls",
      coalesce(m.accepted_calls, 0) as "acceptedCalls",
      coalesce(m.rejected_calls, 0) as "rejectedCalls",
      coalesce(em.executed_calls, 0) as "executedCalls",
      coalesce(m.measured_calls, 0) as "measuredCalls",
      coalesce(m.down_50, 0) as "down50",
      coalesce(m.under_50, 0) as "under50",
      coalesce(m.plus_50, 0) as "plus50",
      coalesce(m.two_x, 0) as "twoX",
      coalesce(m.five_x, 0) as "fiveX",
      m.average_return_x as "averageReturnX",
      m.median_return_x as "medianReturnX",
      -- A count, so it follows the count convention above: 0 is a fact a source with no
      -- calls can state. The three statistics below it stay null, because "the average call
      -- is at 0.00x" is a claim and no data supports it.
      coalesce(m.measured_current, 0) as "measuredCurrent",
      m.average_current_x as "averageCurrentX",
      m.median_current_x as "medianCurrentX",
      m.current_win_rate as "currentWinRate",
      m.win_rate as "winRate",
      m.two_x_rate as "twoXRate",
      m.max_drawdown_bps as "maxDrawdownBps",
      best.call as "bestCall",
      worst.call as "worstCall",
      coalesce(cp.copied_executions, 0) as "copiedExecutions",
      coalesce(cp.copied_volume_lamports, 0)::text as "copiedVolumeLamports",
      perf_1d.snapshot as "performance1d",
      perf_7d.snapshot as "performance7d",
      perf_30d.snapshot as "performance30d",
      coalesce((
        select count(distinct s.privy_user_id)
        from public.subscriptions s
        where s.group_id = g.id and s.enabled = true
      ), 0)::integer as "activeFollowers",
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', ch.channel_id, 'name', ch.channel_name)
          order by ch.channel_name
        )
        from public.call_channels ch
        where ch.group_id = g.id
          and ch.status = 'approved'
          and ch.removed_at is null
      ), '[]'::jsonb) as channels,
      a.data_freshness_at as "dataFreshnessAt",
      a.last_signal_at as "lastSignalAt",
      a.last_processed_call_at as "lastProcessedCallAt",
      em.last_successful_execution_at as "lastSuccessfulExecutionAt",
      g.profile_synced_at as "profileSyncedAt",
      g.last_verified_at as "lastVerifiedAt",
      g.created_at as "approvedAt"
    from public.approved_groups g
    left join metrics m on m.group_id = g.id
    left join activity a on a.group_id = g.id
    left join execution_metrics em on em.group_id = g.id
    left join copied cp on cp.group_id = g.id
    left join lateral (
      select jsonb_build_object(
        'mint', pc.mint,
        'symbol', pc.symbol,
        'peakX', round(pc.peak_x::numeric, 4),
        'calledAt', pc.called_at
      ) as call
      from period_calls pc
      where pc.group_id = g.id
        and pc.parse_status = 'accepted'
        and pc.peak_x is not null
      order by pc.peak_x desc, pc.called_at desc
      limit 1
    ) best on true
    left join lateral (
      select jsonb_build_object(
        'mint', pc.mint,
        'symbol', pc.symbol,
        'peakX', round(pc.peak_x::numeric, 4),
        'calledAt', pc.called_at
      ) as call
      from period_calls pc
      where pc.group_id = g.id
        and pc.parse_status = 'accepted'
        and pc.peak_x is not null
      order by pc.peak_x asc, pc.called_at desc
      limit 1
    ) worst on true
    left join lateral (
      select jsonb_build_object(
        'sampleSize', ps.sample_size,
        'netPnlLamports', ps.net_pnl_lamports::text,
        'asOf', ps.as_of
      ) as snapshot,
      ps.net_pnl_lamports
      from app_private.performance_snapshots ps
      where ps.subject_type = 'discord-source'
        and ps.subject_id = g.id::text
        and ps.period = '1d'
      order by ps.as_of desc
      limit 1
    ) perf_1d on true
    left join lateral (
      select jsonb_build_object(
        'sampleSize', ps.sample_size,
        'netPnlLamports', ps.net_pnl_lamports::text,
        'asOf', ps.as_of
      ) as snapshot,
      ps.net_pnl_lamports
      from app_private.performance_snapshots ps
      where ps.subject_type = 'discord-source'
        and ps.subject_id = g.id::text
        and ps.period = '7d'
      order by ps.as_of desc
      limit 1
    ) perf_7d on true
    left join lateral (
      select jsonb_build_object(
        'sampleSize', ps.sample_size,
        'netPnlLamports', ps.net_pnl_lamports::text,
        'asOf', ps.as_of
      ) as snapshot,
      ps.net_pnl_lamports
      from app_private.performance_snapshots ps
      where ps.subject_type = 'discord-source'
        and ps.subject_id = g.id::text
        and ps.period = '30d'
      order by ps.as_of desc
      limit 1
    ) perf_30d on true
    where g.active = true
      and g.verification_status = 'approved'
      and g.removed_at is null
      and g.suspended_at is null
      and g.marketplace_visible = true
      and exists (
        select 1
        from public.call_channels approved_channel
        where approved_channel.group_id = g.id
          and approved_channel.status = 'approved'
          and approved_channel.removed_at is null
      )
      and (
        g.integration_health <> 'unavailable'
        or coalesce(g.profile_sync_failed_at, g.profile_sync_grace_started_at) >= now() - interval '7 days'
      )
    order by
      case when p_sort = 'newest' then extract(epoch from g.created_at) end desc nulls last,
      case when p_sort = 'followers' then coalesce((
        select count(*) from public.subscriptions follower
        where follower.group_id = g.id and follower.enabled = true
      ), 0) end desc nulls last,
      case when p_sort = 'calls' then coalesce(m.accepted_calls, 0) end desc nulls last,
      case when p_sort = 'volume' then coalesce(cp.copied_volume_lamports, 0) end desc nulls last,
      case when p_sort = 'fee' then g.creator_fee_bps end asc nulls last,
      case when p_sort = 'drawdown' then coalesce(m.max_drawdown_bps, 2147483647) end asc nulls last,
      case when p_sort = 'performance' and lower(p_period) = '1d' then perf_1d.net_pnl_lamports end desc nulls last,
      case when p_sort = 'performance' and lower(p_period) = '30d' then perf_30d.net_pnl_lamports end desc nulls last,
      case when p_sort = 'performance' and lower(p_period) not in ('1d', '30d') then perf_7d.net_pnl_lamports end desc nulls last,
      case when p_sort = 'performance' then m.two_x_rate end desc nulls last,
      coalesce(m.measured_calls, 0) desc,
      g.name asc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(to_jsonb(source_rows)), '[]'::jsonb)
  into v_rows
  from source_rows;

  return jsonb_build_object(
    'ok', true,
    'period', case
      when lower(p_period) in ('1d', '7d', '30d') then lower(p_period)
      else '7d'
    end,
    'minimumSampleSize', 5,
    'sources', v_rows
  );
end;
$$;

revoke execute on function public.app_public_list_discord_marketplace(
  text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.app_public_list_discord_marketplace(
  text, text, text, integer
) to service_role;
