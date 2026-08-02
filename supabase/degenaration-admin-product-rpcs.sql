-- Database-role protected administrative product RPCs.

create or replace function app_private.require_app_admin(p_actor_privy_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.is_app_admin(p_actor_privy_user_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_product_overview(
  p_secret text,
  p_actor_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  return jsonb_build_object(
    'ok', true,
    'users', (select count(*) from app_private.app_users),
    'activeBots', (select count(*) from app_private.bot_profiles where status = 'active'),
    'discordBots', (select count(*) from app_private.bot_profiles where kind = 'discord' and status <> 'archived'),
    'kolBots', (select count(*) from app_private.bot_profiles where kind = 'kol' and status <> 'archived'),
    'pendingKolStrategies', (select count(*) from app_private.kol_strategies where moderation_status = 'pending'),
    'pendingPayouts', (select count(*) from app_private.payout_requests where status in ('requested', 'reviewing', 'approved', 'processing')),
    'openPositions', (select count(*) from app_private.positions where status in ('opening', 'open', 'closing')),
    'unreconciledExecutions', (select count(*) from app_private.trade_executions where status in ('submitted', 'confirmed')),
    'failedExecutions24h', (select count(*) from app_private.trade_executions where status in ('failed', 'dropped') and created_at >= now() - interval '24 hours'),
    'queuedJobs', (select count(*) from app_private.durable_jobs where status in ('queued', 'leased', 'failed')),
    'deadLetters', (select count(*) from app_private.durable_jobs where status = 'dead-letter'),
    'pendingOutbox', (select count(*) from app_private.outbox_events where status in ('pending', 'processing', 'failed')),
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', w.worker_key,
        'instanceId', w.instance_id,
        'executionMode', w.execution_mode,
        'heartbeatAt', w.heartbeat_at,
        'leaseExpiresAt', w.lease_expires_at,
        'healthy', w.lease_expires_at > now(),
        'metadata', w.metadata
      ) order by w.worker_key)
      from app_private.worker_leases w
    ), '[]'::jsonb),
    'systemFlags', coalesce((
      select jsonb_object_agg(f.flag_key, f.value)
      from app_private.system_flags f
    ), '{}'::jsonb)
  );
end;
$$;

create or replace function public.admin_list_kol_strategies(
  p_secret text,
  p_actor_privy_user_id text,
  p_status text default null,
  p_limit integer default 100
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
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      ks.id,
      ks.slug,
      ks.owner_privy_user_id as "ownerPrivyUserId",
      b.id as "botId",
      b.name,
      b.description,
      b.status as "botStatus",
      b.visibility,
      ks.moderation_status as "moderationStatus",
      ks.creator_fee_bps as "creatorFeeBps",
      ks.risk_tier as "riskTier",
      cv.version,
      cv.config,
      ks.created_at,
      ks.updated_at
    from app_private.kol_strategies ks
    join app_private.bot_profiles b on b.id = ks.bot_id
    left join app_private.bot_config_versions cv on cv.id = b.current_version_id
    where p_status is null or p_status = '' or ks.moderation_status = lower(p_status)
    order by ks.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 250))
  ) x;

  return jsonb_build_object('ok', true, 'strategies', v_rows);
end;
$$;

create or replace function public.admin_decide_kol_strategy(
  p_secret text,
  p_actor_privy_user_id text,
  p_strategy_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_strategy app_private.kol_strategies%rowtype;
  v_previous jsonb;
  v_next_status text;
  v_correlation uuid := gen_random_uuid();
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  v_next_status := case lower(p_action)
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    when 'suspend' then 'suspended'
    when 'request-changes' then 'pending'
    else null
  end;
  if v_next_status is null then
    raise exception 'invalid moderation action' using errcode = '22023';
  end if;
  if lower(p_action) <> 'approve' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required' using errcode = '22023';
  end if;

  select * into v_strategy
  from app_private.kol_strategies
  where id = p_strategy_id
  for update;
  if not found then
    raise exception 'strategy not found' using errcode = 'P0002';
  end if;
  v_previous := to_jsonb(v_strategy);

  update app_private.kol_strategies
  set moderation_status = v_next_status,
      last_moderated_at = now()
  where id = p_strategy_id
  returning * into v_strategy;

  if v_next_status = 'suspended' then
    update app_private.bot_profiles
    set status = 'paused'
    where id = v_strategy.bot_id and status = 'active';
    update app_private.kol_subscriptions
    set status = 'paused'
    where strategy_id = v_strategy.id and status = 'active';
  end if;

  insert into app_private.admin_audit_log (
    actor_privy_user_id, action, target_type, target_id, reason,
    previous_state, next_state, correlation_id
  ) values (
    p_actor_privy_user_id, 'kol.' || lower(p_action), 'kol-strategy',
    p_strategy_id::text, nullif(trim(coalesce(p_reason, '')), ''),
    v_previous, to_jsonb(v_strategy), v_correlation
  );

  return jsonb_build_object('ok', true, 'strategy', to_jsonb(v_strategy), 'correlationId', v_correlation);
end;
$$;

create or replace function public.admin_list_payout_requests(
  p_secret text,
  p_actor_privy_user_id text,
  p_status text default null,
  p_limit integer default 100
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
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      p.id,
      p.owner_privy_user_id as "ownerPrivyUserId",
      p.asset,
      p.chain,
      p.destination_wallet as "destinationWallet",
      p.gross_lamports as "grossLamports",
      p.processing_fee_lamports as "processingFeeLamports",
      p.net_lamports as "netLamports",
      p.status,
      p.requested_at,
      p.reviewed_at,
      p.processed_at,
      p.tx_signature as "txSignature",
      p.decision_reason as "decisionReason",
      p.correlation_id as "correlationId"
    from app_private.payout_requests p
    where p_status is null or p_status = '' or p.status = lower(p_status)
    order by p.requested_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 250))
  ) x;

  return jsonb_build_object('ok', true, 'payouts', v_rows);
end;
$$;

create or replace function public.admin_decide_payout(
  p_secret text,
  p_actor_privy_user_id text,
  p_payout_id uuid,
  p_action text,
  p_reason text,
  p_tx_signature text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout app_private.payout_requests%rowtype;
  v_previous jsonb;
  v_next_status text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select * into v_payout
  from app_private.payout_requests
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'payout not found' using errcode = 'P0002';
  end if;
  v_previous := to_jsonb(v_payout);

  v_next_status := case lower(p_action)
    when 'review' then 'reviewing'
    when 'approve' then 'approved'
    when 'processing' then 'processing'
    when 'confirm' then 'confirmed'
    when 'fail' then 'failed'
    when 'reject' then 'rejected'
    else null
  end;
  if v_next_status is null then
    raise exception 'invalid payout action' using errcode = '22023';
  end if;
  if lower(p_action) in ('fail', 'reject') and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required' using errcode = '22023';
  end if;
  if lower(p_action) = 'confirm' and nullif(trim(coalesce(p_tx_signature, '')), '') is null then
    raise exception 'transaction signature required' using errcode = '22023';
  end if;

  -- 'fail' was absent from this chain, so it matched no disjunct and nothing raised: a
  -- payout could be failed from ANY state, including one already failed or confirmed.
  -- Combined with the reversal below firing only for 'rejected', that left the requester's
  -- reservation debit in place with no path back — the creator's available balance was
  -- reduced permanently. A payout is only failable once it is being sent.
  if lower(p_action) = 'review' and v_payout.status <> 'requested'
    or lower(p_action) = 'approve' and v_payout.status not in ('requested', 'reviewing')
    or lower(p_action) = 'processing' and v_payout.status <> 'approved'
    or lower(p_action) = 'confirm' and v_payout.status <> 'processing'
    or lower(p_action) = 'fail' and v_payout.status not in ('approved', 'processing')
    or lower(p_action) = 'reject' and v_payout.status not in ('requested', 'reviewing', 'approved') then
    raise exception 'invalid payout transition' using errcode = '23514';
  end if;

  -- A signature means lamports may already have left the treasury. Reversing the
  -- reservation would credit the creator for funds they were also sent. That needs
  -- on-chain reconciliation by a human, not a state flip.
  if lower(p_action) = 'fail'
    and nullif(trim(coalesce(v_payout.tx_signature, '')), '') is not null then
    raise exception 'payout already has a transaction signature and must be reconciled'
      using errcode = '23514';
  end if;

  update app_private.payout_requests
  set status = v_next_status,
      reviewed_at = case when v_next_status in ('reviewing', 'approved', 'rejected') then now() else reviewed_at end,
      processed_at = case when v_next_status in ('confirmed', 'failed') then now() else processed_at end,
      tx_signature = case when v_next_status = 'confirmed' then trim(p_tx_signature) else tx_signature end,
      decision_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
  where id = p_payout_id
  returning * into v_payout;

  -- Both terminal non-payment outcomes must return the reservation. 'failed' was omitted,
  -- so a failed payout kept the debit and the creator simply lost the balance. The
  -- idempotency keys are per payout and a payout reaches at most one of these states, so
  -- the reversal is written exactly once.
  if v_next_status in ('rejected', 'failed') then
    insert into app_private.commission_ledger_entries (
      account_owner_privy_user_id, account_type, source_type, source_id,
      payout_request_id, amount_lamports, idempotency_key, correlation_id, metadata
    ) values (
      v_payout.owner_privy_user_id, 'creator', 'reversal', v_payout.id::text,
      v_payout.id, v_payout.gross_lamports,
      'payout:' || v_payout.id::text || ':reservation-reversal',
      v_payout.correlation_id,
      jsonb_build_object('kind', 'payout-' || v_next_status)
    )
    on conflict (idempotency_key) do nothing;

    insert into app_private.commission_ledger_entries (
      account_owner_privy_user_id, account_type, source_type, source_id,
      payout_request_id, amount_lamports, idempotency_key, correlation_id, metadata
    ) values (
      null, 'platform', 'reversal', v_payout.id::text,
      v_payout.id, -v_payout.processing_fee_lamports,
      'payout:' || v_payout.id::text || ':fee-reversal',
      v_payout.correlation_id,
      jsonb_build_object('kind', 'payout-' || v_next_status)
    )
    on conflict (idempotency_key) do nothing;
  end if;

  insert into app_private.admin_audit_log (
    actor_privy_user_id, action, target_type, target_id, reason,
    previous_state, next_state, correlation_id
  ) values (
    p_actor_privy_user_id, 'payout.' || lower(p_action), 'payout',
    p_payout_id::text, nullif(trim(coalesce(p_reason, '')), ''),
    v_previous, to_jsonb(v_payout), v_payout.correlation_id
  );

  return jsonb_build_object('ok', true, 'payout', to_jsonb(v_payout));
end;
$$;

create or replace function public.admin_list_app_users(
  p_secret text,
  p_actor_privy_user_id text,
  p_limit integer default 100
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
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      u.privy_user_id as "privyUserId",
      u.display_name as "displayName",
      u.status,
      coalesce((
        select jsonb_agg(r.role order by r.role)
        from app_private.user_roles r
        where r.privy_user_id = u.privy_user_id and r.revoked_at is null
      ), '[]'::jsonb) as roles,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'provider', i.provider,
          'email', case when i.email_verified then i.normalized_email else null end,
          'emailVerified', i.email_verified,
          'lastVerifiedAt', i.last_verified_at
        ) order by i.provider)
        from app_private.auth_identities i
        where i.privy_user_id = u.privy_user_id and i.revoked_at is null
      ), '[]'::jsonb) as identities,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'address', w.address,
          'label', w.label,
          'status', w.status
        ) order by w.created_at)
        from app_private.trading_wallets w
        where w.privy_user_id = u.privy_user_id
      ), '[]'::jsonb) as wallets,
      (select count(*) from app_private.bot_profiles b where b.owner_privy_user_id = u.privy_user_id)::integer as "botCount",
      u.created_at,
      u.updated_at
    from app_private.app_users u
    order by u.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 250))
  ) x;

  return jsonb_build_object('ok', true, 'users', v_rows);
end;
$$;

create or replace function public.admin_list_trade_executions(
  p_secret text,
  p_actor_privy_user_id text,
  p_status text default null,
  p_limit integer default 100
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
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      e.id,
      e.owner_privy_user_id as "ownerPrivyUserId",
      i.bot_id as "botId",
      i.mint,
      i.side,
      i.intent_kind as "kind",
      i.state as "intentState",
      e.execution_mode as "executionMode",
      e.status,
      e.attempt,
      e.tx_signature as "txSignature",
      e.gross_notional_lamports as "grossNotionalLamports",
      e.network_fee_lamports as "networkFeeLamports",
      e.platform_fee_lamports as "platformFeeLamports",
      e.creator_fee_lamports as "creatorFeeLamports",
      e.error_code as "errorCode",
      e.error_message as "errorMessage",
      e.correlation_id as "correlationId",
      e.submitted_at,
      e.confirmed_at,
      e.reconciled_at,
      e.created_at
    from app_private.trade_executions e
    join app_private.trade_intents i on i.id = e.intent_id
    where p_status is null or p_status = '' or e.status = lower(p_status)
    order by e.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 250))
  ) x;

  return jsonb_build_object('ok', true, 'executions', v_rows);
end;
$$;

create or replace function public.admin_scanner_health(
  p_secret text,
  p_actor_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);
  v_status := public.app_scanner_status(p_secret);

  return v_status || jsonb_build_object(
    'tokenCount', (select count(*) from app_private.scanner_tokens),
    'poolCount', (select count(*) from app_private.scanner_pools),
    'unsupportedPools', (select count(*) from app_private.scanner_pools where status = 'unsupported'),
    'latestMarketSnapshotAt', (select max(created_at) from app_private.market_snapshots),
    'latestRiskSnapshotAt', (select max(created_at) from app_private.risk_snapshots),
    'quarantinedSignals24h', (
      select count(*) from app_private.parsed_signals
      where status = 'quarantined' and created_at >= now() - interval '24 hours'
    )
  );
end;
$$;

create or replace function public.admin_list_audit_log(
  p_secret text,
  p_actor_privy_user_id text,
  p_limit integer default 100
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
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      a.id,
      a.actor_privy_user_id as "actorPrivyUserId",
      a.action,
      a.target_type as "targetType",
      a.target_id as "targetId",
      a.reason,
      a.previous_state as "previousState",
      a.next_state as "nextState",
      a.correlation_id as "correlationId",
      a.created_at
    from app_private.admin_audit_log a
    order by a.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 250))
  ) x;

  return jsonb_build_object('ok', true, 'events', v_rows);
end;
$$;

create or replace function public.admin_list_system_flags(
  p_secret text,
  p_actor_privy_user_id text
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
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.flag_key), '[]'::jsonb)
  into v_rows
  from (
    select flag_key, value, description, updated_by, updated_at
    from app_private.system_flags
  ) x;
  return jsonb_build_object('ok', true, 'flags', v_rows);
end;
$$;

create or replace function public.admin_update_system_flag(
  p_secret text,
  p_actor_privy_user_id text,
  p_flag_key text,
  p_value jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous jsonb;
  v_next jsonb;
  v_flag app_private.system_flags%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required' using errcode = '22023';
  end if;
  if p_flag_key = 'mainnet_execution_enabled' and p_value = 'true'::jsonb then
    raise exception 'mainnet enablement requires controlled deployment review' using errcode = '42501';
  end if;

  select to_jsonb(f) into v_previous
  from app_private.system_flags f
  where f.flag_key = p_flag_key
  for update;
  if not found then
    raise exception 'unknown system flag' using errcode = 'P0002';
  end if;

  update app_private.system_flags
  set value = p_value,
      updated_by = p_actor_privy_user_id,
      updated_at = now()
  where flag_key = p_flag_key
  returning * into v_flag;
  v_next := to_jsonb(v_flag);

  insert into app_private.admin_audit_log (
    actor_privy_user_id, action, target_type, target_id, reason,
    previous_state, next_state
  ) values (
    p_actor_privy_user_id, 'system-flag.update', 'system-flag',
    p_flag_key, trim(p_reason), v_previous, v_next
  );

  return jsonb_build_object('ok', true, 'flag', v_next);
end;
$$;

create or replace function public.admin_source_action(
  p_secret text,
  p_actor_privy_user_id text,
  p_source_group_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.approved_groups%rowtype;
  v_previous jsonb;
  v_next_status text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);
  if lower(p_action) not in ('suspend', 'reactivate', 'remove', 'reapprove') then
    raise exception 'invalid source action' using errcode = '22023';
  end if;
  if lower(p_action) in ('suspend', 'remove', 'reapprove')
    and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required' using errcode = '22023';
  end if;

  select * into v_group
  from public.approved_groups
  where id = p_source_group_id
  for update;
  if not found then
    raise exception 'source not found' using errcode = 'P0002';
  end if;
  v_previous := to_jsonb(v_group);
  v_next_status := case lower(p_action)
    when 'suspend' then 'suspended'
    when 'remove' then 'removed'
    else 'approved'
  end;

  update public.approved_groups
  set verification_status = v_next_status,
      active = v_next_status = 'approved',
      suspended_at = case when v_next_status = 'suspended' then now() else null end,
      removed_at = case when v_next_status = 'removed' then now() else null end,
      removal_reason = case
        when v_next_status in ('suspended', 'removed') then left(trim(p_reason), 500)
        when v_next_status = 'approved' then null
        else removal_reason
      end,
      last_verified_at = case when v_next_status = 'approved' then now() else last_verified_at end
  where id = p_source_group_id
  returning * into v_group;

  update public.call_channels
  set status = case
        when v_next_status = 'approved' then 'approved'
        when v_next_status = 'removed' then 'removed'
        else 'suspended'
      end,
      decision_reason = nullif(left(trim(coalesce(p_reason, '')), 500), ''),
      removed_at = case when v_next_status = 'removed' then now() else null end
  where group_id = p_source_group_id
    and status in ('approved', 'suspended', 'removed');

  if v_next_status <> 'approved' then
    update public.subscriptions
    set enabled = false,
        status = 'paused',
        updated_at = now()
    where group_id = p_source_group_id
      and status in ('active', 'paused');

    update app_private.bot_profiles
    set status = 'paused'
    where source_group_id = p_source_group_id and status = 'active';
  end if;

  insert into app_private.admin_audit_log (
    actor_privy_user_id, action, target_type, target_id, reason,
    previous_state, next_state
  ) values (
    p_actor_privy_user_id, 'discord-source.' || lower(p_action), 'discord-source',
    p_source_group_id::text, nullif(trim(coalesce(p_reason, '')), ''),
    v_previous, to_jsonb(v_group)
  );

  insert into app_private.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    'discord-source', p_source_group_id::text, 'discord-source.' || v_next_status,
    jsonb_build_object('sourceGroupId', p_source_group_id, 'status', v_next_status),
    'discord-source:' || p_source_group_id::text || ':' || v_next_status || ':' || extract(epoch from now())::bigint::text
  );

  return jsonb_build_object('ok', true, 'source', to_jsonb(v_group));
end;
$$;

revoke execute on function app_private.require_app_admin(text) from public, anon, authenticated;

revoke execute on function public.admin_product_overview(text, text) from public, anon, authenticated;
grant execute on function public.admin_product_overview(text, text) to service_role;
revoke execute on function public.admin_list_kol_strategies(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.admin_list_kol_strategies(text, text, text, integer) to service_role;
revoke execute on function public.admin_decide_kol_strategy(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_kol_strategy(text, text, uuid, text, text) to service_role;
revoke execute on function public.admin_list_payout_requests(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.admin_list_payout_requests(text, text, text, integer) to service_role;
revoke execute on function public.admin_decide_payout(text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_decide_payout(text, text, uuid, text, text, text) to service_role;
revoke execute on function public.admin_list_app_users(text, text, integer) from public, anon, authenticated;
grant execute on function public.admin_list_app_users(text, text, integer) to service_role;
revoke execute on function public.admin_list_trade_executions(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.admin_list_trade_executions(text, text, text, integer) to service_role;
revoke execute on function public.admin_scanner_health(text, text) from public, anon, authenticated;
grant execute on function public.admin_scanner_health(text, text) to service_role;
revoke execute on function public.admin_list_audit_log(text, text, integer) from public, anon, authenticated;
grant execute on function public.admin_list_audit_log(text, text, integer) to service_role;
revoke execute on function public.admin_list_system_flags(text, text) from public, anon, authenticated;
grant execute on function public.admin_list_system_flags(text, text) to service_role;
revoke execute on function public.admin_update_system_flag(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_system_flag(text, text, text, jsonb, text) to service_role;
revoke execute on function public.admin_source_action(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_source_action(text, text, uuid, text, text) to service_role;
