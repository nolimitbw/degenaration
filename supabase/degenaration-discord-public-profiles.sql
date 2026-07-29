-- Public Discord source profiles and rate-limit-safe bot metadata synchronization.
-- Existing approved sources receive a fresh grace window and remain public while
-- their first metadata refresh is pending.

alter table public.approved_groups
  add column if not exists banner_url text,
  add column if not exists discord_description text,
  add column if not exists owner_display_name text,
  add column if not exists marketplace_visible boolean not null default true,
  add column if not exists integration_health text not null default 'pending',
  add column if not exists profile_synced_at timestamptz,
  add column if not exists profile_sync_failed_at timestamptz,
  add column if not exists profile_sync_error text,
  add column if not exists profile_sync_grace_started_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'approved_groups_integration_health_check'
      and conrelid = 'public.approved_groups'::regclass
  ) then
    alter table public.approved_groups
      add constraint approved_groups_integration_health_check
      check (integration_health in ('pending', 'healthy', 'degraded', 'unavailable'));
  end if;
end;
$$;

create index if not exists approved_groups_marketplace_visibility_idx
  on public.approved_groups (marketplace_visible, verification_status, integration_health)
  where active = true and removed_at is null;

create or replace function app_private.refresh_discord_profile_grace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verification_status = 'approved'
    and old.verification_status is distinct from 'approved' then
    new.profile_sync_grace_started_at := now();
    if new.integration_health = 'unavailable' then
      new.integration_health := 'pending';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists approved_groups_refresh_profile_grace
  on public.approved_groups;
create trigger approved_groups_refresh_profile_grace
  before update of verification_status on public.approved_groups
  for each row execute function app_private.refresh_discord_profile_grace();

revoke execute on function app_private.refresh_discord_profile_grace()
  from public, anon, authenticated;

create or replace function public.bot_sync_source_profile(
  p_secret text,
  p_guild_id text,
  p_guild_name text,
  p_guild_member_count integer,
  p_avatar_url text,
  p_banner_url text,
  p_description text,
  p_owner_display_name text,
  p_bot_present boolean,
  p_sync_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_success boolean;
  v_error text;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_guild_id is null or p_guild_id !~ '^\d{17,20}$' then
    raise exception 'invalid Discord guild' using errcode = '22023';
  end if;

  v_error := nullif(left(trim(coalesce(p_sync_error, '')), 300), '');
  v_success := coalesce(p_bot_present, false) and v_error is null;

  update public.call_channels
  set guild_name = coalesce(nullif(left(trim(coalesce(p_guild_name, '')), 120), ''), guild_name),
      guild_member_count = case
        when p_guild_member_count is not null and p_guild_member_count >= 0
          then p_guild_member_count
        else guild_member_count
      end,
      last_verified_at = case when v_success then now() else last_verified_at end,
      permissions_checked_at = case when v_success then now() else permissions_checked_at end
  where guild_id = p_guild_id;

  select g.id
  into v_group_id
  from public.approved_groups g
  where g.discord_guild_id = p_guild_id
  order by g.created_at
  limit 1;

  if v_group_id is null then
    return jsonb_build_object('ok', true, 'profileUpdated', false);
  end if;

  if v_success then
    update public.approved_groups
    set name = coalesce(nullif(left(trim(coalesce(p_guild_name, '')), 120), ''), name),
        members = case
          when p_guild_member_count is not null and p_guild_member_count >= 0
            then p_guild_member_count::text
          else members
        end,
        avatar_url = nullif(left(trim(coalesce(p_avatar_url, '')), 500), ''),
        banner_url = nullif(left(trim(coalesce(p_banner_url, '')), 500), ''),
        discord_description = nullif(left(trim(coalesce(p_description, '')), 300), ''),
        owner_display_name = coalesce(
          nullif(left(trim(coalesce(p_owner_display_name, '')), 100), ''),
          owner_display_name
        ),
        integration_health = 'healthy',
        profile_synced_at = now(),
        profile_sync_failed_at = null,
        profile_sync_error = null,
        last_verified_at = now()
    where id = v_group_id;
  else
    update public.approved_groups
    set integration_health = case
          when coalesce(profile_synced_at, profile_sync_grace_started_at) >= now() - interval '7 days'
            then 'degraded'
          else 'unavailable'
        end,
        profile_sync_failed_at = now(),
        profile_sync_error = coalesce(v_error, 'Discord bot is not present in the server')
    where id = v_group_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'profileUpdated', true,
    'groupId', v_group_id,
    'health', case when v_success then 'healthy' else 'degraded' end
  );
end;
$$;

revoke execute on function public.bot_sync_source_profile(
  text, text, text, integer, text, text, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.bot_sync_source_profile(
  text, text, text, integer, text, text, text, text, boolean, text
) to service_role;

create or replace function public.bot_approved_call_channels(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channels jsonb;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel_id', ch.channel_id,
    'group_id', ch.group_id,
    'guild_id', ch.guild_id,
    'guild_name', ch.guild_name
  ) order by ch.created_at desc), '[]'::jsonb)
  into v_channels
  from public.call_channels ch
  join public.approved_groups g on g.id = ch.group_id
  where ch.status = 'approved'
    and ch.removed_at is null
    and g.active = true
    and g.verification_status = 'approved'
    and g.removed_at is null;

  return v_channels;
end;
$$;

revoke execute on function public.bot_approved_call_channels(text)
  from public, anon, authenticated;
grant execute on function public.bot_approved_call_channels(text)
  to service_role;

create or replace function public.admin_list_call_channels(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(cc) || jsonb_build_object(
        'marketplace_visible', g.marketplace_visible,
        'integration_health', g.integration_health,
        'profile_synced_at', g.profile_synced_at,
        'profile_sync_failed_at', g.profile_sync_failed_at,
        'profile_sync_error', g.profile_sync_error
      )
      order by coalesce(cc.last_submitted_at, cc.created_at) desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.call_channels cc
  left join public.approved_groups g on g.id = cc.group_id;

  return v_rows;
end;
$$;

revoke execute on function public.admin_list_call_channels(text)
  from public, anon, authenticated;
grant execute on function public.admin_list_call_channels(text)
  to service_role;

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

  with call_returns as (
    select
      c.id,
      c.group_id,
      c.called_at,
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
      and c.parse_status = 'accepted'
      and c.deleted_at is null
  ),
  metrics as (
    select
      r.group_id,
      count(*)::integer as eligible_calls,
      count(r.peak_x)::integer as measured_calls,
      count(*) filter (where r.peak_x < 1.5)::integer as under_50,
      count(*) filter (where r.peak_x >= 1.5 and r.peak_x < 2)::integer as plus_50,
      count(*) filter (where r.peak_x >= 2 and r.peak_x < 5)::integer as two_x,
      count(*) filter (where r.peak_x >= 5)::integer as five_x,
      round(avg(r.peak_x)::numeric, 4) as average_return_x,
      round(percentile_cont(0.5) within group (order by r.peak_x)::numeric, 4) as median_return_x,
      round((100 * count(*) filter (where r.peak_x >= 2) / nullif(count(r.peak_x), 0))::numeric, 2) as win_rate,
      round(max(
        case
          when r.peak_x > 0 and r.current_x is not null
            then greatest(0, (1 - (r.current_x / r.peak_x)) * 10000)
        end
      )::numeric, 0) as max_drawdown_bps,
      max(r.called_at) as latest_call_at
    from call_returns r
    group by r.group_id
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
      coalesce(m.eligible_calls, 0) as "eligibleCalls",
      coalesce(m.measured_calls, 0) as "measuredCalls",
      coalesce(m.under_50, 0) as "under50",
      coalesce(m.plus_50, 0) as "plus50",
      coalesce(m.two_x, 0) as "twoX",
      coalesce(m.five_x, 0) as "fiveX",
      m.average_return_x as "averageReturnX",
      m.median_return_x as "medianReturnX",
      m.win_rate as "winRate",
      m.max_drawdown_bps as "maxDrawdownBps",
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
      m.latest_call_at as "dataFreshnessAt",
      m.latest_call_at as "lastSignalAt",
      g.profile_synced_at as "profileSyncedAt",
      g.last_verified_at as "lastVerifiedAt",
      g.created_at as "approvedAt"
    from public.approved_groups g
    left join metrics m on m.group_id = g.id
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
      case when p_sort = 'calls' then coalesce(m.eligible_calls, 0) end desc nulls last,
      case when p_sort = 'fee' then g.creator_fee_bps end asc nulls last,
      case when p_sort = 'drawdown' then coalesce(m.max_drawdown_bps, 2147483647) end asc nulls last,
      case when p_sort not in ('newest', 'followers', 'calls', 'fee', 'drawdown')
        then coalesce(m.win_rate, 0) end desc,
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

grant select (
  banner_url,
  discord_description,
  owner_display_name,
  marketplace_visible,
  verification_status,
  suspended_at,
  removed_at,
  integration_health,
  profile_synced_at
) on public.approved_groups to anon, authenticated;
