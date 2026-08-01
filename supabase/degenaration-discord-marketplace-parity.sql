-- Extend the public Discord marketplace response with authoritative activity and PnL.
-- Apply after the product ledger, execution integrity, and Discord public profile scripts.
-- Rollback only this RPC by reapplying the app_public_list_discord_marketplace function
-- and its revoke/grant block from degenaration-discord-public-profiles.sql. This script
-- has no table DDL or DML, so rollback does not require restoring marketplace data.

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
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x < 1.5)::integer as under_50,
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 1.5 and c.peak_x < 2)::integer as plus_50,
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 2 and c.peak_x < 5)::integer as two_x,
      count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 5)::integer as five_x,
      round((avg(c.peak_x) filter (where c.parse_status = 'accepted'))::numeric, 4) as average_return_x,
      round((
        percentile_cont(0.5) within group (order by c.peak_x)
          filter (where c.parse_status = 'accepted')
      )::numeric, 4) as median_return_x,
      round((
        100.0 * count(*) filter (where c.parse_status = 'accepted' and c.peak_x >= 2)
          / nullif(count(c.peak_x) filter (where c.parse_status = 'accepted'), 0)
      )::numeric, 2) as win_rate,
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
      coalesce(m.under_50, 0) as "under50",
      coalesce(m.plus_50, 0) as "plus50",
      coalesce(m.two_x, 0) as "twoX",
      coalesce(m.five_x, 0) as "fiveX",
      m.average_return_x as "averageReturnX",
      m.median_return_x as "medianReturnX",
      m.win_rate as "winRate",
      m.max_drawdown_bps as "maxDrawdownBps",
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
      case when p_sort = 'fee' then g.creator_fee_bps end asc nulls last,
      case when p_sort = 'drawdown' then coalesce(m.max_drawdown_bps, 2147483647) end asc nulls last,
      case when p_sort = 'performance' and lower(p_period) = '1d' then perf_1d.net_pnl_lamports end desc nulls last,
      case when p_sort = 'performance' and lower(p_period) = '30d' then perf_30d.net_pnl_lamports end desc nulls last,
      case when p_sort = 'performance' and lower(p_period) not in ('1d', '30d') then perf_7d.net_pnl_lamports end desc nulls last,
      case when p_sort = 'performance' then m.win_rate end desc nulls last,
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
