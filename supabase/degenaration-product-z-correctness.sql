-- Product correctness patch.
-- Prerequisites: degenaration product identity, ledger, and RPC migrations.

create unique index if not exists referral_links_profile_owner_unique
  on app_private.referral_links (owner_privy_user_id)
  where subject_type = 'profile';

create or replace function app_private.sync_profile_referral_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.referral_links (
    owner_privy_user_id, code, subject_type, subject_id, active, disabled_at
  ) values (
    new.privy_user_id,
    new.referral_code,
    'profile',
    new.privy_user_id,
    new.status = 'active',
    case when new.status = 'active' then null else now() end
  )
  on conflict (owner_privy_user_id) where subject_type = 'profile' do update
  set code = excluded.code,
      active = excluded.active,
      disabled_at = excluded.disabled_at;

  return new;
end;
$$;

drop trigger if exists affiliate_profiles_sync_referral_link
  on app_private.affiliate_profiles;
create trigger affiliate_profiles_sync_referral_link
after insert or update of referral_code, status
on app_private.affiliate_profiles
for each row execute function app_private.sync_profile_referral_link();

insert into app_private.referral_links (
  owner_privy_user_id, code, subject_type, subject_id, active, disabled_at
)
select
  p.privy_user_id,
  p.referral_code,
  'profile',
  p.privy_user_id,
  p.status = 'active',
  case when p.status = 'active' then null else now() end
from app_private.affiliate_profiles p
on conflict do nothing;

create or replace function public.app_public_resolve_referral(
  p_secret text,
  p_code text,
  p_visitor_hash text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link app_private.referral_links%rowtype;
  v_destination text;
  v_slug text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_code is null
    or p_code !~* '^[a-z0-9_-]{6,48}$'
    or p_visitor_hash !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_idempotency_key, '')) not between 20 and 200 then
    raise exception 'invalid referral request' using errcode = '22023';
  end if;

  select l.* into v_link
  from app_private.referral_links l
  join app_private.app_users u on u.privy_user_id = l.owner_privy_user_id
  where lower(l.code) = lower(p_code)
    and l.active = true
    and l.disabled_at is null
    and u.status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
  end if;

  if v_link.subject_type = 'profile' then
    v_destination := '/bots';
  elsif v_link.subject_type = 'kol' then
    if not exists (
      select 1
      from app_private.kol_strategies ks
      join app_private.bot_profiles b on b.id = ks.bot_id
      where ks.id::text = v_link.subject_id
        and ks.moderation_status = 'approved'
        and b.visibility = 'public'
        and b.status in ('active', 'paused')
    ) then
      return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
    end if;
    v_destination := '/bots/kol/' || v_link.subject_id;
  else
    select g.public_slug into v_slug
    from public.approved_groups g
    where g.id::text = v_link.subject_id
      and g.active = true
      and g.verification_status = 'approved'
      and g.removed_at is null;
    if v_slug is null then
      return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
    end if;
    v_destination := '/source/' || v_slug;
  end if;

  insert into app_private.referral_events (
    referral_link_id, event_type, visitor_hash, idempotency_key, metadata
  ) values (
    v_link.id,
    'click',
    p_visitor_hash,
    p_idempotency_key,
    jsonb_build_object('code', v_link.code)
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'code', v_link.code,
    'subjectType', v_link.subject_type,
    'destination', v_destination
  );
end;
$$;

create or replace function public.app_public_list_kol_marketplace(
  p_secret text,
  p_period text default '30d',
  p_sort text default 'performance',
  p_limit integer default 50
)
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

  with strategies as (
    select
      ks.id,
      ks.slug,
      b.name,
      b.description,
      b.status,
      b.execution_mode as "executionMode",
      cv.version,
      cv.schema_version as "schemaVersion",
      cv.config - 'walletAddress' - 'walletId' - 'channelId' as config,
      coalesce(
        nullif(trim(u.display_name), ''),
        'Creator ' || upper(substr(encode(extensions.digest(ks.owner_privy_user_id, 'sha256'), 'hex'), 1, 6))
      ) as "creatorName",
      ks.creator_fee_bps as "creatorFeeBps",
      ks.risk_tier as "riskTier",
      coalesce(ps.sample_size, 0) as "sampleSize",
      ps.net_pnl_lamports as "netPnlLamports",
      ps.realized_pnl_lamports as "realizedPnlLamports",
      ps.volume_lamports as "volumeLamports",
      ps.network_fees_lamports as "networkFeesLamports",
      ps.platform_fees_lamports as "platformFeesLamports",
      ps.creator_fees_lamports as "creatorFeesLamports",
      ps.max_drawdown_bps as "maxDrawdownBps",
      ps.win_rate_bps as "winRateBps",
      ps.metrics,
      coalesce((
        select count(*) from app_private.kol_subscriptions sub
        where sub.strategy_id = ks.id and sub.status = 'active'
      ), 0)::integer as followers,
      coalesce((
        select count(*) from app_private.positions p
        where p.bot_id = b.id and p.status in ('opening', 'open', 'closing')
      ), 0)::integer as "openTrades",
      b.published_at as "activeSince",
      b.created_at as "createdAt",
      b.updated_at as "updatedAt",
      case when coalesce(ps.sample_size, 0) < 5 then true else false end as "insufficientHistory"
    from app_private.kol_strategies ks
    join app_private.bot_profiles b on b.id = ks.bot_id
    join app_private.bot_config_versions cv on cv.id = b.current_version_id
    join app_private.app_users u on u.privy_user_id = ks.owner_privy_user_id
    left join lateral (
      select p.*
      from app_private.performance_snapshots p
      where p.subject_type = 'kol-strategy'
        and p.subject_id = ks.id::text
        and p.period = case
          when lower(p_period) in ('1d', '7d', '30d', '3m') then lower(p_period)
          else '30d'
        end
      order by p.as_of desc
      limit 1
    ) ps on true
    where ks.moderation_status = 'approved'
      and b.visibility = 'public'
      and b.status in ('active', 'paused')
      and u.status = 'active'
    order by
      case when p_sort = 'newest' then extract(epoch from b.published_at) end desc nulls last,
      case when p_sort = 'followers' then coalesce((
        select count(*) from app_private.kol_subscriptions sub2
        where sub2.strategy_id = ks.id and sub2.status = 'active'
      ), 0) end desc nulls last,
      case when p_sort = 'drawdown' then ps.max_drawdown_bps end asc nulls last,
      case when p_sort = 'fee' then ks.creator_fee_bps end asc nulls last,
      case when p_sort not in ('newest', 'followers', 'drawdown', 'fee')
        then ps.net_pnl_lamports end desc nulls last,
      b.published_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(to_jsonb(strategies)), '[]'::jsonb)
  into v_rows
  from strategies;

  return jsonb_build_object(
    'ok', true,
    'period', case when lower(p_period) in ('1d', '7d', '30d', '3m') then lower(p_period) else '30d' end,
    'minimumSampleSize', 5,
    'strategies', v_rows
  );
end;
$$;

create or replace function public.app_user_record_pnl_card(
  p_secret text,
  p_privy_user_id text,
  p_card_type text,
  p_subject_type text,
  p_subject_id text,
  p_snapshot jsonb,
  p_referral_code text,
  p_render_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record app_private.pnl_card_records%rowtype;
  v_referral_id uuid;
  v_hash text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_card_type not in ('winner', 'loser', 'portfolio')
    or p_subject_type not in ('position', 'portfolio-snapshot')
    or jsonb_typeof(p_snapshot) <> 'object'
    or p_render_version not between 1 and 1000 then
    raise exception 'invalid PnL card record' using errcode = '22023';
  end if;
  if p_subject_type = 'position' and not exists (
    select 1 from app_private.positions p
    where p.id::text = p_subject_id and p.owner_privy_user_id = p_privy_user_id
  ) then
    raise exception 'position not found' using errcode = 'P0002';
  end if;
  if p_subject_type = 'portfolio-snapshot' and p_subject_id <> p_privy_user_id then
    raise exception 'portfolio ownership mismatch' using errcode = '42501';
  end if;

  select l.id into v_referral_id
  from app_private.referral_links l
  where l.owner_privy_user_id = p_privy_user_id
    and lower(l.code) = lower(coalesce(p_referral_code, ''))
    and l.active = true
  limit 1;

  v_hash := encode(extensions.digest(p_snapshot::text, 'sha256'), 'hex');

  insert into app_private.pnl_card_records (
    owner_privy_user_id, card_type, subject_type, subject_id,
    authoritative_snapshot, referral_link_id, render_version, content_hash
  ) values (
    p_privy_user_id, p_card_type, p_subject_type, p_subject_id,
    p_snapshot, v_referral_id, p_render_version, v_hash
  )
  on conflict (
    owner_privy_user_id, card_type, subject_type, subject_id, content_hash
  ) do update
  set render_version = greatest(
        app_private.pnl_card_records.render_version,
        excluded.render_version
      )
  returning * into v_record;

  return jsonb_build_object(
    'ok', true,
    'recordId', v_record.id,
    'contentHash', v_record.content_hash
  );
end;
$$;

revoke execute on function public.app_public_resolve_referral(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.app_public_resolve_referral(text, text, text, text)
  to service_role;
revoke execute on function public.app_public_list_kol_marketplace(text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.app_public_list_kol_marketplace(text, text, text, integer)
  to service_role;
revoke execute on function public.app_user_record_pnl_card(
  text, text, text, text, text, jsonb, text, integer
) from public, anon, authenticated;
grant execute on function public.app_user_record_pnl_card(
  text, text, text, text, text, jsonb, text, integer
) to service_role;
