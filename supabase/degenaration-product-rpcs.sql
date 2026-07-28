-- Allowlisted product RPCs called through app-bridge and service-role workers.
-- Every public SECURITY DEFINER function revokes PUBLIC execution below.

create or replace function app_private.ensure_app_user(p_privy_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_privy_user_id), '') is null or char_length(p_privy_user_id) > 200 then
    raise exception 'invalid user' using errcode = '22023';
  end if;

  insert into app_private.app_users (privy_user_id)
  values (trim(p_privy_user_id))
  on conflict (privy_user_id) do nothing;

  insert into app_private.user_roles (privy_user_id, role, reason)
  values (trim(p_privy_user_id), 'USER', 'Automatic base role')
  on conflict (privy_user_id, role) where revoked_at is null do nothing;
end;
$$;

create or replace function app_private.is_app_admin(p_privy_user_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.user_roles r
    join app_private.app_users u on u.privy_user_id = r.privy_user_id
    where r.privy_user_id = p_privy_user_id
      and r.role = 'ADMIN'
      and r.revoked_at is null
      and u.status = 'active'
  );
$$;

create or replace function public.app_sync_verified_identity(
  p_secret text,
  p_privy_user_id text,
  p_provider text,
  p_provider_subject text,
  p_email text,
  p_email_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_existing_user text;
  v_is_admin boolean := false;
  v_roles jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_provider not in ('google_oauth', 'discord_oauth', 'wallet') then
    raise exception 'invalid provider' using errcode = '22023';
  end if;
  if nullif(trim(p_provider_subject), '') is null then
    raise exception 'provider subject required' using errcode = '22023';
  end if;
  if v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  perform app_private.ensure_app_user(p_privy_user_id);

  select i.privy_user_id into v_existing_user
  from app_private.auth_identities i
  where i.provider = p_provider
    and i.provider_subject = trim(p_provider_subject)
    and i.revoked_at is null;

  if v_existing_user is not null and v_existing_user <> p_privy_user_id then
    raise exception 'identity already linked' using errcode = '23505';
  end if;

  insert into app_private.auth_identities (
    privy_user_id, provider, provider_subject, normalized_email,
    email_verified, last_verified_at, revoked_at
  ) values (
    p_privy_user_id, p_provider, trim(p_provider_subject),
    nullif(v_email, ''), coalesce(p_email_verified, false), now(), null
  )
  on conflict (provider, provider_subject) do update
  set normalized_email = excluded.normalized_email,
      email_verified = excluded.email_verified,
      last_verified_at = now(),
      revoked_at = null
  where app_private.auth_identities.privy_user_id = excluded.privy_user_id;

  if p_provider = 'google_oauth'
    and p_email_verified = true
    and exists (
      select 1 from app_private.admin_email_allowlist a
      where a.normalized_email = v_email and a.active = true
    ) then
    insert into app_private.user_roles (privy_user_id, role, granted_by, reason)
    values (p_privy_user_id, 'ADMIN', 'verified-google-sync', 'Verified allowlisted Google identity')
    on conflict (privy_user_id, role) where revoked_at is null do nothing;
  end if;

  v_is_admin := app_private.is_app_admin(p_privy_user_id);
  select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb)
  into v_roles
  from app_private.user_roles r
  where r.privy_user_id = p_privy_user_id and r.revoked_at is null;

  return jsonb_build_object(
    'ok', true,
    'privyUserId', p_privy_user_id,
    'roles', v_roles,
    'isAdmin', v_is_admin
  );
end;
$$;

create or replace function public.app_user_get_access(
  p_secret text,
  p_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles jsonb;
  v_status text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);

  select u.status into v_status
  from app_private.app_users u
  where u.privy_user_id = p_privy_user_id;

  select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb)
  into v_roles
  from app_private.user_roles r
  where r.privy_user_id = p_privy_user_id and r.revoked_at is null;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'roles', v_roles,
    'isAdmin', app_private.is_app_admin(p_privy_user_id)
  );
end;
$$;

create or replace function public.app_user_upsert_wallet(
  p_secret text,
  p_privy_user_id text,
  p_wallet_address text,
  p_privy_wallet_id text,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet app_private.trading_wallets%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(p_wallet_address), '') is null
    or char_length(trim(p_wallet_address)) not between 32 and 64 then
    raise exception 'invalid wallet' using errcode = '22023';
  end if;

  perform app_private.ensure_app_user(p_privy_user_id);

  insert into app_private.trading_wallets (
    privy_user_id, privy_wallet_id, address, label, verified_at
  ) values (
    p_privy_user_id, nullif(trim(p_privy_wallet_id), ''), trim(p_wallet_address),
    nullif(left(trim(coalesce(p_label, '')), 80), ''), now()
  )
  on conflict (privy_user_id, address) do update
  set privy_wallet_id = coalesce(excluded.privy_wallet_id, app_private.trading_wallets.privy_wallet_id),
      label = coalesce(excluded.label, app_private.trading_wallets.label),
      verified_at = now(),
      status = 'active'
  returning * into v_wallet;

  return jsonb_build_object(
    'id', v_wallet.id,
    'address', v_wallet.address,
    'label', v_wallet.label,
    'status', v_wallet.status
  );
end;
$$;

create or replace function public.app_user_save_bot(
  p_secret text,
  p_privy_user_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bot app_private.bot_profiles%rowtype;
  v_version app_private.bot_config_versions%rowtype;
  v_kind text := lower(coalesce(p_payload->>'kind', ''));
  v_name text := trim(coalesce(p_payload->>'name', ''));
  v_description text := trim(coalesce(p_payload->>'description', ''));
  v_status text := lower(coalesce(p_payload->>'status', 'draft'));
  v_visibility text := lower(coalesce(p_payload->>'visibility', 'private'));
  v_mode text := lower(coalesce(p_payload->>'executionMode', 'paper'));
  v_config jsonb := coalesce(p_payload->'config', '{}'::jsonb);
  v_bot_id uuid;
  v_source_group_id uuid;
  v_wallet_id uuid;
  v_wallet_address text := nullif(trim(coalesce(v_config->>'walletAddress', '')), '');
  v_privy_wallet_id text := nullif(trim(coalesce(v_config->>'walletId', '')), '');
  v_next_version integer;
  v_strategy_id uuid;
  v_slug text;
  v_mainnet_enabled boolean := false;
  v_open_positions integer := 0;
  v_buy_lamports numeric;
  v_daily_cap_lamports numeric;
  v_tp1_bps numeric;
  v_tp2_bps numeric;
  v_tp1_sell numeric;
  v_tp2_sell numeric;
  v_stop_bps numeric;
  v_slippage_bps numeric;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(v_config) <> 'object' then
    raise exception 'invalid bot payload' using errcode = '22023';
  end if;
  if v_kind not in ('discord', 'kol') then
    raise exception 'invalid bot kind' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 or char_length(v_description) > 600 then
    raise exception 'invalid bot identity' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'active', 'paused', 'stopping', 'archived', 'error') then
    raise exception 'invalid bot status' using errcode = '22023';
  end if;
  if v_visibility not in ('private', 'public') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if v_mode not in ('paper', 'solana-devnet', 'solana-mainnet') then
    raise exception 'invalid execution mode' using errcode = '22023';
  end if;
  if v_status = 'active' and coalesce((p_payload->>'confirmed')::boolean, false) is not true then
    raise exception 'activation confirmation required' using errcode = '22023';
  end if;

  select coalesce((f.value #>> '{}')::boolean, false) into v_mainnet_enabled
  from app_private.system_flags f
  where f.flag_key = 'mainnet_execution_enabled';

  if v_mode = 'solana-mainnet' and v_mainnet_enabled is not true then
    raise exception 'mainnet execution is disabled' using errcode = '42501';
  end if;

  perform app_private.ensure_app_user(p_privy_user_id);

  if nullif(p_payload->>'id', '') is not null then
    begin
      v_bot_id := (p_payload->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid bot id' using errcode = '22023';
    end;
  end if;

  if nullif(p_payload->>'sourceGroupId', '') is not null then
    begin
      v_source_group_id := (p_payload->>'sourceGroupId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid source' using errcode = '22023';
    end;
  end if;

  if v_kind = 'discord' then
    if v_source_group_id is null or not exists (
      select 1 from public.approved_groups g
      where g.id = v_source_group_id
        and g.active = true
        and g.verification_status = 'approved'
    ) then
      raise exception 'approved Discord source required' using errcode = '22023';
    end if;
  else
    v_source_group_id := null;
  end if;

  if v_wallet_address is not null then
    if char_length(v_wallet_address) not between 32 and 64 then
      raise exception 'invalid wallet address' using errcode = '22023';
    end if;
    insert into app_private.trading_wallets (
      privy_user_id, privy_wallet_id, address, verified_at
    ) values (
      p_privy_user_id, v_privy_wallet_id, v_wallet_address, now()
    )
    on conflict (privy_user_id, address) do update
    set privy_wallet_id = coalesce(excluded.privy_wallet_id, app_private.trading_wallets.privy_wallet_id),
        verified_at = now(),
        status = 'active'
    returning id into v_wallet_id;
  end if;

  if v_bot_id is null then
    if v_kind = 'discord' and exists (
      select 1 from app_private.bot_profiles b
      where b.owner_privy_user_id = p_privy_user_id
        and b.kind = 'discord'
        and b.source_group_id = v_source_group_id
        and b.status <> 'archived'
    ) then
      raise exception 'a Discord bot already exists for this source' using errcode = '23505';
    end if;

    insert into app_private.bot_profiles (
      owner_privy_user_id, kind, name, description, status, visibility,
      execution_mode, wallet_id, source_group_id,
      published_at, archived_at
    ) values (
      p_privy_user_id, v_kind, v_name, v_description, v_status, v_visibility,
      v_mode, v_wallet_id, v_source_group_id,
      case when v_visibility = 'public' and v_status in ('active', 'paused') then now() else null end,
      case when v_status = 'archived' then now() else null end
    )
    returning * into v_bot;

    v_next_version := 1;
  else
    select * into v_bot
    from app_private.bot_profiles b
    where b.id = v_bot_id and b.owner_privy_user_id = p_privy_user_id
    for update;

    if not found then
      raise exception 'bot not found' using errcode = 'P0002';
    end if;
    if v_bot.kind <> v_kind then
      raise exception 'bot kind cannot change' using errcode = '22023';
    end if;

    if v_status = 'archived' then
      select count(*) into v_open_positions
      from app_private.positions p
      where p.bot_id = v_bot.id and p.status in ('opening', 'open', 'closing');
      if v_open_positions > 0 then
        raise exception 'bot has open positions' using errcode = '23514';
      end if;
    end if;

    select coalesce(max(c.version), 0) + 1 into v_next_version
    from app_private.bot_config_versions c
    where c.bot_id = v_bot.id;

    update app_private.bot_profiles
    set name = v_name,
        description = v_description,
        status = v_status,
        visibility = v_visibility,
        execution_mode = v_mode,
        wallet_id = coalesce(v_wallet_id, wallet_id),
        source_group_id = v_source_group_id,
        published_at = case
          when v_visibility = 'public' and v_status in ('active', 'paused')
            then coalesce(published_at, now())
          else published_at
        end,
        archived_at = case when v_status = 'archived' then coalesce(archived_at, now()) else null end
    where id = v_bot.id
    returning * into v_bot;
  end if;

  insert into app_private.bot_config_versions (
    bot_id, version, schema_version, config, created_by, change_note
  ) values (
    v_bot.id, v_next_version,
    greatest(1, coalesce((p_payload->>'schemaVersion')::integer, 1)),
    v_config, p_privy_user_id, nullif(left(trim(coalesce(p_payload->>'changeNote', '')), 240), '')
  )
  returning * into v_version;

  update app_private.bot_profiles
  set current_version_id = v_version.id,
      last_activity_at = now()
  where id = v_bot.id
  returning * into v_bot;

  if v_kind = 'discord' then
    v_buy_lamports := coalesce(nullif(v_config->>'buyAmountLamports', '')::numeric, 500000000);
    v_daily_cap_lamports := coalesce(nullif(v_config->>'dailyLossLimitLamports', '')::numeric, v_buy_lamports * 4);
    v_tp1_bps := coalesce((v_config #>> '{takeProfit,levels,0,targetBps}')::numeric, 10000);
    v_tp2_bps := coalesce((v_config #>> '{takeProfit,levels,1,targetBps}')::numeric, 40000);
    v_tp1_sell := coalesce((v_config #>> '{takeProfit,levels,0,sellBps}')::numeric, 5000);
    v_tp2_sell := coalesce((v_config #>> '{takeProfit,levels,1,sellBps}')::numeric, 2500);
    v_stop_bps := abs(coalesce((v_config #>> '{stopLoss,stopBps}')::numeric, 4000));
    v_slippage_bps := coalesce(nullif(v_config->>'slippageBps', '')::numeric, 300);

    insert into public.subscriptions (
      privy_user_id, group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell,
      stop_loss, slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id,
      bot_profile_id, config_version_id, channel_id, status, extended_config, updated_at
    ) values (
      p_privy_user_id, v_source_group_id, v_buy_lamports / 1000000000,
      1 + (v_tp1_bps / 10000), round(v_tp1_sell / 100),
      1 + (v_tp2_bps / 10000), round(v_tp2_sell / 100),
      round(v_stop_bps / 100), round(v_slippage_bps), v_daily_cap_lamports / 1000000000,
      v_status = 'active', v_wallet_address, v_privy_wallet_id,
      v_bot.id, v_version.id, nullif(v_config->>'channelId', ''),
      v_status, v_config, now()
    )
    on conflict (privy_user_id, group_id) where privy_user_id is not null do update
    set size_sol = excluded.size_sol,
        tp1 = excluded.tp1,
        tp1_sell = excluded.tp1_sell,
        tp2 = excluded.tp2,
        tp2_sell = excluded.tp2_sell,
        stop_loss = excluded.stop_loss,
        slippage_bps = excluded.slippage_bps,
        daily_cap_sol = excluded.daily_cap_sol,
        enabled = excluded.enabled,
        user_pubkey = excluded.user_pubkey,
        wallet_id = excluded.wallet_id,
        bot_profile_id = excluded.bot_profile_id,
        config_version_id = excluded.config_version_id,
        channel_id = excluded.channel_id,
        status = excluded.status,
        extended_config = excluded.extended_config,
        updated_at = now();
  else
    v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    v_slug := left(coalesce(nullif(v_slug, ''), 'strategy'), 48) || '-' || left(replace(v_bot.id::text, '-', ''), 8);

    insert into app_private.kol_strategies (
      bot_id, owner_privy_user_id, slug, moderation_status, creator_fee_bps, risk_tier
    ) values (
      v_bot.id, p_privy_user_id, v_slug,
      case when v_visibility = 'public' then 'pending' else 'unreviewed' end,
      20, coalesce(nullif(v_config->>'riskTier', ''), 'high')
    )
    on conflict (bot_id) do update
    set moderation_status = case
          when excluded.moderation_status = 'pending'
            and app_private.kol_strategies.moderation_status <> 'suspended'
          then 'pending'
          else app_private.kol_strategies.moderation_status
        end,
        risk_tier = excluded.risk_tier
    returning id into v_strategy_id;
  end if;

  insert into app_private.bot_events (
    bot_id, actor_privy_user_id, event_type, previous_status, next_status, reason, metadata
  ) values (
    v_bot.id, p_privy_user_id,
    case when v_next_version = 1 then 'created' else 'configuration-versioned' end,
    null, v_status, nullif(p_payload->>'changeNote', ''),
    jsonb_build_object('version', v_next_version, 'kind', v_kind)
  );

  insert into app_private.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    'bot', v_bot.id::text, 'bot.configuration.saved',
    jsonb_build_object('botId', v_bot.id, 'versionId', v_version.id, 'status', v_status),
    'bot:' || v_bot.id::text || ':version:' || v_next_version::text
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'bot', jsonb_build_object(
      'id', v_bot.id,
      'kind', v_bot.kind,
      'name', v_bot.name,
      'description', v_bot.description,
      'status', v_bot.status,
      'visibility', v_bot.visibility,
      'executionMode', v_bot.execution_mode,
      'sourceGroupId', v_bot.source_group_id,
      'currentVersionId', v_version.id,
      'version', v_version.version,
      'strategyId', v_strategy_id,
      'createdAt', v_bot.created_at,
      'updatedAt', v_bot.updated_at
    )
  );
end;
$$;

create or replace function public.app_user_list_bots(
  p_secret text,
  p_privy_user_id text,
  p_kind text default null
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
  perform app_private.ensure_app_user(p_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      b.id,
      b.kind,
      b.name,
      b.description,
      b.status,
      b.visibility,
      b.execution_mode as "executionMode",
      b.source_group_id as "sourceGroupId",
      g.name as "sourceName",
      b.current_version_id as "currentVersionId",
      cv.version,
      cv.config,
      ks.id as "strategyId",
      ks.slug as "strategySlug",
      ks.moderation_status as "moderationStatus",
      ks.creator_fee_bps as "creatorFeeBps",
      coalesce(s.enabled, false) as enabled,
      coalesce(s.channel_id, cv.config->>'channelId') as "channelId",
      coalesce(ps.sample_size, 0) as "sampleSize",
      ps.net_pnl_lamports as "netPnlLamports",
      ps.volume_lamports as "volumeLamports",
      ps.network_fees_lamports as "networkFeesLamports",
      ps.platform_fees_lamports as "platformFeesLamports",
      ps.creator_fees_lamports as "creatorFeesLamports",
      coalesce((
        select count(*) from app_private.positions p
        where p.bot_id = b.id and p.status in ('opening', 'open', 'closing')
      ), 0)::integer as "openTrades",
      coalesce((
        select count(*) from app_private.kol_subscriptions ksub
        where ksub.strategy_id = ks.id and ksub.status = 'active'
      ), 0)::integer as followers,
      b.created_at,
      b.updated_at,
      b.last_activity_at as "lastActivityAt"
    from app_private.bot_profiles b
    left join app_private.bot_config_versions cv on cv.id = b.current_version_id
    left join app_private.kol_strategies ks on ks.bot_id = b.id
    left join public.approved_groups g on g.id = b.source_group_id
    left join public.subscriptions s on s.bot_profile_id = b.id
    left join lateral (
      select p.*
      from app_private.performance_snapshots p
      where p.subject_type = 'bot' and p.subject_id = b.id::text and p.period = '30d'
      order by p.as_of desc
      limit 1
    ) ps on true
    where b.owner_privy_user_id = p_privy_user_id
      and (p_kind is null or p_kind = '' or b.kind = lower(p_kind))
  ) x;

  return jsonb_build_object('ok', true, 'bots', v_rows);
end;
$$;

create or replace function public.app_user_get_bot(
  p_secret text,
  p_privy_user_id text,
  p_bot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', b.id,
    'kind', b.kind,
    'name', b.name,
    'description', b.description,
    'status', b.status,
    'visibility', b.visibility,
    'executionMode', b.execution_mode,
    'sourceGroupId', b.source_group_id,
    'sourceName', g.name,
    'currentVersionId', cv.id,
    'version', cv.version,
    'config', cv.config,
    'strategyId', ks.id,
    'strategySlug', ks.slug,
    'moderationStatus', ks.moderation_status,
    'creatorFeeBps', coalesce(ks.creator_fee_bps, g.creator_fee_bps),
    'createdAt', b.created_at,
    'updatedAt', b.updated_at
  )
  into v_result
  from app_private.bot_profiles b
  left join app_private.bot_config_versions cv on cv.id = b.current_version_id
  left join app_private.kol_strategies ks on ks.bot_id = b.id
  left join public.approved_groups g on g.id = b.source_group_id
  where b.id = p_bot_id and b.owner_privy_user_id = p_privy_user_id;

  if v_result is null then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'bot not found');
  end if;
  return jsonb_build_object('ok', true, 'bot', v_result);
end;
$$;

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
          else null
        end,
        case
          when c.called_mcap > 0 and c.peak_mcap is not null
            then c.peak_mcap / c.called_mcap
          else null
        end
      ) as peak_x
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
      max(r.called_at) as latest_call_at
    from call_returns r
    group by r.group_id
  ),
  sources as (
    select
      g.id,
      g.name,
      g.members,
      g.avatar_url as "avatarUrl",
      g.discord_invite_url as "joinUrl",
      g.public_slug as "publicSlug",
      g.referral_code as "referralCode",
      g.creator_fee_bps as "creatorFeeBps",
      g.verification_status as "verificationStatus",
      coalesce(m.eligible_calls, 0) as "eligibleCalls",
      coalesce(m.measured_calls, 0) as "measuredCalls",
      coalesce(m.under_50, 0) as "under50",
      coalesce(m.plus_50, 0) as "plus50",
      coalesce(m.two_x, 0) as "twoX",
      coalesce(m.five_x, 0) as "fiveX",
      m.average_return_x as "averageReturnX",
      m.median_return_x as "medianReturnX",
      m.win_rate as "winRate",
      null::numeric as "maxDrawdownBps",
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
        where ch.group_id = g.id and ch.status = 'approved'
      ), '[]'::jsonb) as channels,
      m.latest_call_at as "dataFreshnessAt",
      g.created_at as "approvedAt"
    from public.approved_groups g
    left join metrics m on m.group_id = g.id
    where g.active = true
      and g.verification_status = 'approved'
      and g.removed_at is null
    order by
      case when p_sort = 'newest' then extract(epoch from g.created_at) end desc nulls last,
      case when p_sort = 'followers' then coalesce((
        select count(*) from public.subscriptions s2
        where s2.group_id = g.id and s2.enabled = true
      ), 0) end desc nulls last,
      case when p_sort = 'calls' then coalesce(m.eligible_calls, 0) end desc nulls last,
      case when p_sort = 'fee' then g.creator_fee_bps end asc nulls last,
      case when p_sort not in ('newest', 'followers', 'calls', 'fee')
        then coalesce(m.win_rate, 0) end desc,
      coalesce(m.measured_calls, 0) desc,
      g.name asc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(to_jsonb(sources)), '[]'::jsonb)
  into v_rows
  from sources;

  return jsonb_build_object(
    'ok', true,
    'period', case when lower(p_period) in ('1d', '7d', '30d') then lower(p_period) else '7d' end,
    'minimumSampleSize', 5,
    'sources', v_rows
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

create or replace function public.app_user_upsert_kol_subscription(
  p_secret text,
  p_privy_user_id text,
  p_strategy_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_strategy app_private.kol_strategies%rowtype;
  v_bot app_private.bot_profiles%rowtype;
  v_wallet_id uuid;
  v_wallet_address text := nullif(trim(coalesce(p_payload->>'walletAddress', '')), '');
  v_privy_wallet_id text := nullif(trim(coalesce(p_payload->>'walletId', '')), '');
  v_status text := lower(coalesce(p_payload->>'status', 'draft'));
  v_sub app_private.kol_subscriptions%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or v_status not in ('draft', 'active', 'paused', 'stopping', 'archived', 'error') then
    raise exception 'invalid subscription payload' using errcode = '22023';
  end if;

  perform app_private.ensure_app_user(p_privy_user_id);

  select * into v_strategy
  from app_private.kol_strategies ks
  where ks.id = p_strategy_id
    and ks.moderation_status = 'approved';
  if not found then
    raise exception 'strategy unavailable' using errcode = 'P0002';
  end if;

  select * into v_bot
  from app_private.bot_profiles b
  where b.id = v_strategy.bot_id
    and b.visibility = 'public'
    and b.status in ('active', 'paused');
  if not found then
    raise exception 'strategy unavailable' using errcode = 'P0002';
  end if;
  if v_strategy.owner_privy_user_id = p_privy_user_id then
    raise exception 'self-copying is not eligible' using errcode = '23514';
  end if;

  if v_wallet_address is not null then
    if char_length(v_wallet_address) not between 32 and 64 then
      raise exception 'invalid wallet' using errcode = '22023';
    end if;
    insert into app_private.trading_wallets (
      privy_user_id, privy_wallet_id, address, verified_at
    ) values (
      p_privy_user_id, v_privy_wallet_id, v_wallet_address, now()
    )
    on conflict (privy_user_id, address) do update
    set privy_wallet_id = coalesce(excluded.privy_wallet_id, app_private.trading_wallets.privy_wallet_id),
        verified_at = now(),
        status = 'active'
    returning id into v_wallet_id;
  end if;

  insert into app_private.kol_subscriptions (
    strategy_id, subscriber_privy_user_id, wallet_id, strategy_version_id,
    status, config, creator_fee_bps_snapshot
  ) values (
    p_strategy_id, p_privy_user_id, v_wallet_id, v_bot.current_version_id,
    v_status, p_payload, v_strategy.creator_fee_bps
  )
  on conflict (strategy_id, subscriber_privy_user_id) do update
  set wallet_id = coalesce(excluded.wallet_id, app_private.kol_subscriptions.wallet_id),
      strategy_version_id = excluded.strategy_version_id,
      status = excluded.status,
      config = excluded.config,
      creator_fee_bps_snapshot = excluded.creator_fee_bps_snapshot,
      archived_at = case when excluded.status = 'archived' then now() else null end
  returning * into v_sub;

  insert into app_private.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    'kol-subscription', v_sub.id::text, 'kol.subscription.saved',
    jsonb_build_object('subscriptionId', v_sub.id, 'status', v_sub.status),
    'kol-subscription:' || v_sub.id::text || ':' || extract(epoch from v_sub.updated_at)::bigint::text
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'subscription', jsonb_build_object(
      'id', v_sub.id,
      'strategyId', v_sub.strategy_id,
      'strategyVersionId', v_sub.strategy_version_id,
      'status', v_sub.status,
      'config', v_sub.config,
      'creatorFeeBps', v_sub.creator_fee_bps_snapshot,
      'createdAt', v_sub.created_at,
      'updatedAt', v_sub.updated_at
    )
  );
end;
$$;

create or replace function public.app_user_list_kol_subscriptions(
  p_secret text,
  p_privy_user_id text
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

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      s.id,
      s.strategy_id as "strategyId",
      b.name as "strategyName",
      ks.slug,
      s.strategy_version_id as "strategyVersionId",
      s.status,
      s.config,
      s.creator_fee_bps_snapshot as "creatorFeeBps",
      w.address as "walletAddress",
      s.created_at,
      s.updated_at
    from app_private.kol_subscriptions s
    join app_private.kol_strategies ks on ks.id = s.strategy_id
    join app_private.bot_profiles b on b.id = ks.bot_id
    left join app_private.trading_wallets w on w.id = s.wallet_id
    where s.subscriber_privy_user_id = p_privy_user_id
  ) x;

  return jsonb_build_object('ok', true, 'subscriptions', v_rows);
end;
$$;

create or replace function public.app_user_affiliate_summary(
  p_secret text,
  p_privy_user_id text,
  p_scope text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_available bigint;
  v_pending bigint;
  v_lifetime bigint;
  v_30d bigint;
  v_followers integer;
  v_volume bigint;
  v_chart jsonb;
  v_events jsonb;
  v_payouts jsonb;
  v_links jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);

  v_code := upper(substr(encode(extensions.digest(p_privy_user_id, 'sha256'), 'hex'), 1, 12));
  insert into app_private.affiliate_profiles (privy_user_id, referral_code)
  values (p_privy_user_id, v_code)
  on conflict (privy_user_id) do nothing;

  select
    coalesce(sum(l.amount_lamports) filter (where l.available_at <= now()), 0)::bigint,
    coalesce(sum(l.amount_lamports) filter (where l.available_at > now()), 0)::bigint,
    coalesce(sum(greatest(l.amount_lamports, 0)), 0)::bigint,
    coalesce(sum(greatest(l.amount_lamports, 0))
      filter (where l.created_at >= now() - interval '30 days'), 0)::bigint
  into v_available, v_pending, v_lifetime, v_30d
  from app_private.commission_ledger_entries l
  where l.account_owner_privy_user_id = p_privy_user_id
    and l.account_type = 'creator'
    and (
      lower(coalesce(p_scope, 'all')) = 'all'
      or l.source_type = lower(p_scope)
    );

  select
    count(distinct e.referred_privy_user_id)
      filter (where e.event_type = 'follow' and e.referred_privy_user_id is not null)::integer,
    coalesce(sum(e.notional_lamports)
      filter (where e.event_type = 'trade'), 0)::bigint
  into v_followers, v_volume
  from app_private.referral_events e
  join app_private.referral_links l on l.id = e.referral_link_id
  where l.owner_privy_user_id = p_privy_user_id
    and (
      lower(coalesce(p_scope, 'all')) = 'all'
      or l.subject_type = lower(p_scope)
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
  into v_chart
  from (
    select
      date_trunc('day', l.created_at)::date as day,
      sum(l.amount_lamports)::bigint as "amountLamports"
    from app_private.commission_ledger_entries l
    where l.account_owner_privy_user_id = p_privy_user_id
      and l.created_at >= now() - interval '30 days'
      and (
        lower(coalesce(p_scope, 'all')) = 'all'
        or l.source_type = lower(p_scope)
      )
    group by date_trunc('day', l.created_at)::date
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      l.id,
      l.source_type as "sourceType",
      l.source_id as "sourceId",
      l.amount_lamports as "amountLamports",
      l.rate_bps as "rateBps",
      l.gross_notional_lamports as "grossNotionalLamports",
      l.available_at as "availableAt",
      l.created_at
    from app_private.commission_ledger_entries l
    where l.account_owner_privy_user_id = p_privy_user_id
      and (
        lower(coalesce(p_scope, 'all')) = 'all'
        or l.source_type = lower(p_scope)
      )
    order by l.created_at desc
    limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc), '[]'::jsonb)
  into v_payouts
  from (
    select
      p.id,
      p.asset,
      p.chain,
      p.destination_wallet as "destinationWallet",
      p.gross_lamports as "grossLamports",
      p.processing_fee_lamports as "processingFeeLamports",
      p.net_lamports as "netLamports",
      p.status,
      p.requested_at,
      p.processed_at,
      p.tx_signature as "txSignature",
      p.decision_reason as "decisionReason"
    from app_private.payout_requests p
    where p.owner_privy_user_id = p_privy_user_id
    order by p.requested_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_links
  from (
    select
      l.id,
      l.code,
      l.subject_type as "subjectType",
      l.subject_id as "subjectId",
      l.active,
      l.created_at
    from app_private.referral_links l
    where l.owner_privy_user_id = p_privy_user_id
    order by l.created_at desc
  ) x;

  return jsonb_build_object(
    'ok', true,
    'scope', lower(coalesce(p_scope, 'all')),
    'referralCode', v_code,
    'availableLamports', greatest(v_available, 0),
    'pendingLamports', greatest(v_pending, 0),
    'lifetimeLamports', greatest(v_lifetime, 0),
    'earnings30dLamports', greatest(v_30d, 0),
    'followers', coalesce(v_followers, 0),
    'volumeLamports', coalesce(v_volume, 0),
    'defaultRateBps', case when lower(p_scope) = 'kol' then 20 else 70 end,
    'minimumPayoutLamports', 100000000,
    'processingFeeLamports', 43000000,
    'chart', v_chart,
    'events', v_events,
    'payouts', v_payouts,
    'links', v_links
  );
end;
$$;

create or replace function public.app_user_request_payout(
  p_secret text,
  p_privy_user_id text,
  p_destination_wallet text,
  p_gross_lamports bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available bigint;
  v_request app_private.payout_requests%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_destination_wallet, ''))) not between 32 and 64 then
    raise exception 'invalid payout wallet' using errcode = '22023';
  end if;
  if p_gross_lamports < 100000000 then
    raise exception 'minimum payout is 0.1 SOL' using errcode = '23514';
  end if;
  if p_gross_lamports <= 43000000 then
    raise exception 'payout does not cover processing fee' using errcode = '23514';
  end if;

  perform app_private.ensure_app_user(p_privy_user_id);
  perform pg_advisory_xact_lock(hashtext('payout:' || p_privy_user_id));

  select coalesce(sum(l.amount_lamports), 0)::bigint into v_available
  from app_private.commission_ledger_entries l
  where l.account_owner_privy_user_id = p_privy_user_id
    and l.account_type = 'creator'
    and l.available_at <= now();

  if v_available < p_gross_lamports then
    raise exception 'insufficient available commission' using errcode = '23514';
  end if;

  insert into app_private.payout_requests (
    owner_privy_user_id, destination_wallet, gross_lamports
  ) values (
    p_privy_user_id, trim(p_destination_wallet), p_gross_lamports
  )
  returning * into v_request;

  insert into app_private.commission_ledger_entries (
    account_owner_privy_user_id, account_type, source_type, source_id,
    payout_request_id, amount_lamports, idempotency_key, correlation_id, metadata
  ) values (
    p_privy_user_id, 'creator', 'payout', v_request.id::text,
    v_request.id, -p_gross_lamports,
    'payout:' || v_request.id::text || ':reserve',
    v_request.correlation_id,
    jsonb_build_object('kind', 'payout-reservation')
  );

  insert into app_private.commission_ledger_entries (
    account_owner_privy_user_id, account_type, source_type, source_id,
    payout_request_id, amount_lamports, idempotency_key, correlation_id, metadata
  ) values (
    null, 'platform', 'payout', v_request.id::text,
    v_request.id, v_request.processing_fee_lamports,
    'payout:' || v_request.id::text || ':processing-fee',
    v_request.correlation_id,
    jsonb_build_object('kind', 'processing-fee-withheld')
  );

  insert into app_private.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    'payout', v_request.id::text, 'payout.requested',
    jsonb_build_object(
      'payoutId', v_request.id,
      'grossLamports', v_request.gross_lamports,
      'netLamports', v_request.net_lamports
    ),
    'payout:' || v_request.id::text || ':requested'
  );

  return jsonb_build_object(
    'ok', true,
    'payout', jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'grossLamports', v_request.gross_lamports,
      'processingFeeLamports', v_request.processing_fee_lamports,
      'netLamports', v_request.net_lamports,
      'destinationWallet', v_request.destination_wallet,
      'requestedAt', v_request.requested_at
    )
  );
end;
$$;

create or replace function public.app_user_portfolio_summary(
  p_secret text,
  p_privy_user_id text,
  p_period text default '30d'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_positions jsonb;
  v_executions jsonb;
  v_movements jsonb;
  v_legacy_trades jsonb;
  v_snapshot jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc), '[]'::jsonb)
  into v_positions
  from (
    select
      p.id,
      p.bot_id as "botId",
      b.name as "botName",
      p.mint,
      p.status,
      p.quantity_base_units::text as "quantityBaseUnits",
      p.cost_lamports::text as "costLamports",
      p.realized_pnl_lamports::text as "realizedPnlLamports",
      p.fees_lamports::text as "feesLamports",
      p.opened_at,
      p.updated_at,
      p.closed_at
    from app_private.positions p
    left join app_private.bot_profiles b on b.id = p.bot_id
    where p.owner_privy_user_id = p_privy_user_id
    order by p.opened_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_executions
  from (
    select
      e.id,
      e.intent_id as "intentId",
      i.bot_id as "botId",
      b.name as "botName",
      i.mint,
      i.side,
      i.intent_kind as "kind",
      e.execution_mode as "executionMode",
      e.status,
      e.tx_signature as "txSignature",
      e.gross_notional_lamports::text as "grossNotionalLamports",
      e.network_fee_lamports::text as "networkFeeLamports",
      e.priority_fee_lamports::text as "priorityFeeLamports",
      e.platform_fee_lamports::text as "platformFeeLamports",
      e.creator_fee_lamports::text as "creatorFeeLamports",
      e.submitted_at,
      e.confirmed_at,
      e.reconciled_at,
      e.error_code as "errorCode",
      e.created_at
    from app_private.trade_executions e
    join app_private.trade_intents i on i.id = e.intent_id
    left join app_private.bot_profiles b on b.id = i.bot_id
    where e.owner_privy_user_id = p_privy_user_id
    order by e.created_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.observed_at desc), '[]'::jsonb)
  into v_movements
  from (
    select
      m.id,
      m.movement_type as "type",
      m.status,
      m.amount_lamports::text as "amountLamports",
      m.network_fee_lamports::text as "networkFeeLamports",
      m.tx_signature as "txSignature",
      m.observed_at,
      m.created_at
    from app_private.cash_movements m
    where m.owner_privy_user_id = p_privy_user_id
    order by m.observed_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_legacy_trades
  from (
    select
      t.id,
      t.mint,
      t.side,
      t.sol_amount as "solAmount",
      t.token_amount as "tokenAmount",
      t.price_usd as "priceUsd",
      t.fee_sol as "feeSol",
      t.kind,
      t.tx_signature as "txSignature",
      t.reconciliation_status as "reconciliationStatus",
      t.created_at
    from public.trades t
    where t.privy_user_id = p_privy_user_id
    order by t.created_at desc
    limit 200
  ) x;

  select jsonb_build_object(
    'period', ps.period,
    'asOf', ps.as_of,
    'sampleSize', ps.sample_size,
    'netPnlLamports', ps.net_pnl_lamports,
    'realizedPnlLamports', ps.realized_pnl_lamports,
    'volumeLamports', ps.volume_lamports,
    'networkFeesLamports', ps.network_fees_lamports,
    'platformFeesLamports', ps.platform_fees_lamports,
    'creatorFeesLamports', ps.creator_fees_lamports,
    'maxDrawdownBps', ps.max_drawdown_bps,
    'winRateBps', ps.win_rate_bps,
    'metrics', ps.metrics
  )
  into v_snapshot
  from app_private.performance_snapshots ps
  where ps.subject_type = 'portfolio'
    and ps.subject_id = p_privy_user_id
    and ps.period = case
      when lower(p_period) in ('7d', '30d', '3m') then lower(p_period)
      else '30d'
    end
  order by ps.as_of desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'period', case when lower(p_period) in ('7d', '30d', '3m') then lower(p_period) else '30d' end,
    'performance', v_snapshot,
    'positions', v_positions,
    'executions', v_executions,
    'cashMovements', v_movements,
    'legacyTrades', v_legacy_trades
  );
end;
$$;

create or replace function public.app_scanner_status(
  p_secret text
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

  select coalesce(jsonb_agg(to_jsonb(x) order by x.display_name), '[]'::jsonb)
  into v_rows
  from (
    select
      a.adapter_key as "key",
      a.display_name as "displayName",
      a.adapter_version as "version",
      a.status,
      a.program_ids as "programIds",
      a.capabilities,
      a.limitation,
      a.last_success_at as "lastSuccessAt",
      a.last_failure_at as "lastFailureAt",
      a.slot_lag as "slotLag",
      a.updated_at as "updatedAt"
    from app_private.scanner_adapters a
  ) x;

  return jsonb_build_object('ok', true, 'adapters', v_rows);
end;
$$;

create or replace function public.app_consume_rate_limit(
  p_secret text,
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_cost integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
  v_reset timestamptz;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(p_scope), '') is null
    or nullif(trim(p_subject_hash), '') is null
    or p_limit not between 1 and 100000
    or p_window_seconds not between 1 and 86400
    or p_cost not between 1 and p_limit then
    raise exception 'invalid rate limit request' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_reset := v_window_start + make_interval(secs => p_window_seconds);

  insert into app_private.rate_limit_buckets (
    scope, subject_hash, window_started_at, request_count, expires_at
  ) values (
    left(trim(p_scope), 120), left(trim(p_subject_hash), 128),
    v_window_start, p_cost, v_reset + interval '5 minutes'
  )
  on conflict (scope, subject_hash, window_started_at) do update
  set request_count = app_private.rate_limit_buckets.request_count + excluded.request_count
  returning request_count into v_count;

  if random() < 0.01 then
    delete from app_private.rate_limit_buckets where expires_at < v_now;
  end if;

  return jsonb_build_object(
    'ok', true,
    'allowed', v_count <= p_limit,
    'limit', p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'resetAt', v_reset,
    'retryAfterSeconds', greatest(ceil(extract(epoch from (v_reset - v_now)))::integer, 1)
  );
end;
$$;

create or replace function public.worker_claim_jobs(
  p_queue_name text,
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs jsonb;
begin
  if nullif(trim(p_queue_name), '') is null
    or nullif(trim(p_worker_id), '') is null
    or p_limit not between 1 and 100
    or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid worker claim' using errcode = '22023';
  end if;

  with candidates as (
    select j.id
    from app_private.durable_jobs j
    where j.queue_name = p_queue_name
      and j.available_at <= now()
      and (
        j.status in ('queued', 'failed')
        or (j.status = 'leased' and j.lease_expires_at < now())
      )
      and j.attempt_count < j.max_attempts
    order by j.priority asc, j.created_at asc
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update app_private.durable_jobs j
    set status = 'leased',
        lease_owner = left(trim(p_worker_id), 160),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = j.attempt_count + 1,
        last_error = null
    from candidates c
    where j.id = c.id
    returning
      j.id, j.queue_name, j.job_type, j.payload, j.idempotency_key,
      j.priority, j.attempt_count, j.max_attempts, j.correlation_id,
      j.lease_expires_at, j.created_at
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
  into v_jobs
  from claimed;

  update app_private.durable_jobs j
  set status = 'dead-letter',
      finished_at = now(),
      last_error = coalesce(j.last_error, 'maximum attempts exceeded')
  where j.queue_name = p_queue_name
    and j.status in ('queued', 'failed', 'leased')
    and j.attempt_count >= j.max_attempts
    and (j.lease_expires_at is null or j.lease_expires_at < now());

  return jsonb_build_object('ok', true, 'jobs', v_jobs);
end;
$$;

create or replace function public.worker_finish_job(
  p_job_id uuid,
  p_worker_id text,
  p_status text,
  p_error text default null,
  p_retry_delay_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job app_private.durable_jobs%rowtype;
begin
  if p_status not in ('succeeded', 'failed', 'dead-letter', 'cancelled')
    or p_retry_delay_seconds not between 0 and 86400 then
    raise exception 'invalid job completion' using errcode = '22023';
  end if;

  update app_private.durable_jobs j
  set status = case
        when p_status = 'failed' and j.attempt_count >= j.max_attempts then 'dead-letter'
        else p_status
      end,
      available_at = case
        when p_status = 'failed' and j.attempt_count < j.max_attempts
          then now() + make_interval(secs => p_retry_delay_seconds)
        else j.available_at
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error = case when p_status in ('failed', 'dead-letter')
        then left(coalesce(p_error, 'job failed'), 500) else null end,
      finished_at = case when p_status in ('succeeded', 'dead-letter', 'cancelled')
        or (p_status = 'failed' and j.attempt_count >= j.max_attempts)
        then now() else null end
  where j.id = p_job_id
    and j.status = 'leased'
    and j.lease_owner = p_worker_id
    and j.lease_expires_at >= now()
  returning * into v_job;

  if not found then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'job lease mismatch');
  end if;
  return jsonb_build_object('ok', true, 'jobId', v_job.id, 'status', v_job.status);
end;
$$;

create or replace function public.worker_heartbeat(
  p_worker_key text,
  p_instance_id text,
  p_execution_mode text,
  p_lease_seconds integer default 90,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_execution_mode not in ('paper', 'solana-devnet', 'solana-mainnet')
    or p_lease_seconds not between 30 and 3600
    or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'invalid heartbeat' using errcode = '22023';
  end if;

  insert into app_private.worker_leases (
    worker_key, instance_id, execution_mode, heartbeat_at, lease_expires_at, metadata
  ) values (
    left(trim(p_worker_key), 120), left(trim(p_instance_id), 160),
    p_execution_mode, now(), now() + make_interval(secs => p_lease_seconds), p_metadata
  )
  on conflict (worker_key) do update
  set instance_id = excluded.instance_id,
      execution_mode = excluded.execution_mode,
      heartbeat_at = excluded.heartbeat_at,
      lease_expires_at = excluded.lease_expires_at,
      metadata = excluded.metadata;

  return jsonb_build_object('ok', true, 'leaseExpiresAt', now() + make_interval(secs => p_lease_seconds));
end;
$$;

revoke execute on function app_private.ensure_app_user(text) from public, anon, authenticated;
revoke execute on function app_private.is_app_admin(text) from public, anon, authenticated;

revoke execute on function public.app_sync_verified_identity(text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.app_sync_verified_identity(text, text, text, text, text, boolean) to service_role;
revoke execute on function public.app_user_get_access(text, text) from public, anon, authenticated;
grant execute on function public.app_user_get_access(text, text) to service_role;
revoke execute on function public.app_user_upsert_wallet(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.app_user_upsert_wallet(text, text, text, text, text) to service_role;
revoke execute on function public.app_user_save_bot(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.app_user_save_bot(text, text, jsonb) to service_role;
revoke execute on function public.app_user_list_bots(text, text, text) from public, anon, authenticated;
grant execute on function public.app_user_list_bots(text, text, text) to service_role;
revoke execute on function public.app_user_get_bot(text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_user_get_bot(text, text, uuid) to service_role;
revoke execute on function public.app_public_list_discord_marketplace(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.app_public_list_discord_marketplace(text, text, text, integer) to service_role;
revoke execute on function public.app_public_list_kol_marketplace(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.app_public_list_kol_marketplace(text, text, text, integer) to service_role;
revoke execute on function public.app_user_upsert_kol_subscription(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_user_upsert_kol_subscription(text, text, uuid, jsonb) to service_role;
revoke execute on function public.app_user_list_kol_subscriptions(text, text) from public, anon, authenticated;
grant execute on function public.app_user_list_kol_subscriptions(text, text) to service_role;
revoke execute on function public.app_user_affiliate_summary(text, text, text) from public, anon, authenticated;
grant execute on function public.app_user_affiliate_summary(text, text, text) to service_role;
revoke execute on function public.app_user_request_payout(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.app_user_request_payout(text, text, text, bigint) to service_role;
revoke execute on function public.app_user_portfolio_summary(text, text, text) from public, anon, authenticated;
grant execute on function public.app_user_portfolio_summary(text, text, text) to service_role;
revoke execute on function public.app_scanner_status(text) from public, anon, authenticated;
grant execute on function public.app_scanner_status(text) to service_role;
revoke execute on function public.app_consume_rate_limit(text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.app_consume_rate_limit(text, text, text, integer, integer, integer) to service_role;

revoke execute on function public.worker_claim_jobs(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.worker_claim_jobs(text, text, integer, integer) to service_role;
revoke execute on function public.worker_finish_job(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.worker_finish_job(uuid, text, text, text, integer) to service_role;
revoke execute on function public.worker_heartbeat(text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.worker_heartbeat(text, text, text, integer, jsonb) to service_role;
