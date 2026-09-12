-- Durable subscriber-owned risk versions and execution-time snapshots.
-- Existing subscriptions receive an explicit legacy-baseline version; financial
-- settings are preserved and no historical execution is rewritten.
-- Rollback: disable entry workers, drop snapshot triggers, then remove the new
-- columns and table. Do not drop versions referenced by new executions.

create table if not exists app_private.subscriber_config_versions (
  id uuid primary key default gen_random_uuid(),
  subscription_kind text not null
    check (subscription_kind in ('discord', 'kol', 'wallet-copy')),
  subscription_ref uuid not null,
  subscriber_privy_user_id text not null,
  version integer not null check (version > 0),
  creator_config_version_id uuid
    references app_private.bot_config_versions(id) on delete restrict,
  compatibility_mode text not null
    check (compatibility_mode in ('versioned', 'legacy-baseline')),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  unique (subscription_kind, subscription_ref, version)
);

create index if not exists subscriber_config_versions_owner_idx
  on app_private.subscriber_config_versions
  (subscriber_privy_user_id, subscription_kind, created_at desc);

alter table app_private.subscriber_config_versions enable row level security;
revoke all on table app_private.subscriber_config_versions from public, anon, authenticated;

alter table public.subscriptions
  add column if not exists subscriber_config_version_id uuid
    references app_private.subscriber_config_versions(id) on delete restrict,
  add column if not exists subscriber_config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists kill_switch boolean not null default false;

alter table public.copy_subscriptions
  add column if not exists subscriber_config_version_id uuid
    references app_private.subscriber_config_versions(id) on delete restrict,
  add column if not exists subscriber_config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists kill_switch boolean not null default false;

alter table app_private.kol_subscriptions
  add column if not exists subscriber_config_version_id uuid
    references app_private.subscriber_config_versions(id) on delete restrict,
  add column if not exists subscriber_config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists kill_switch boolean not null default false;

create index if not exists subscriptions_subscriber_config_version_idx
  on public.subscriptions (subscriber_config_version_id);
create index if not exists copy_subscriptions_subscriber_config_version_idx
  on public.copy_subscriptions (subscriber_config_version_id);
create index if not exists kol_subscriptions_subscriber_config_version_idx
  on app_private.kol_subscriptions (subscriber_config_version_id);

create or replace function app_private.reject_subscriber_config_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'subscriber configuration version is immutable' using errcode = '55000';
end;
$$;

drop trigger if exists subscriber_config_versions_immutable
  on app_private.subscriber_config_versions;
create trigger subscriber_config_versions_immutable
before update or delete on app_private.subscriber_config_versions
for each row execute function app_private.reject_subscriber_config_mutation();

create or replace function app_private.legacy_subscriber_config(
  p_wallet_address text,
  p_wallet_id text,
  p_size_sol numeric,
  p_daily_cap_sol numeric,
  p_slippage_bps integer,
  p_tp1 numeric,
  p_tp1_sell integer,
  p_tp2 numeric,
  p_tp2_sell integer,
  p_stop_loss integer,
  p_enabled boolean,
  p_kill_switch boolean
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'compatibilityMode', 'legacy-baseline',
    'walletAddress', nullif(p_wallet_address, ''),
    'walletId', nullif(p_wallet_id, ''),
    'buyAmountLamports', round(greatest(coalesce(p_size_sol, 0), 0) * 1000000000)::text,
    'maximumCapitalLamports', round(greatest(coalesce(p_daily_cap_sol, 0), 0) * 1000000000)::text,
    'dailyLossLimitLamports', round(greatest(coalesce(p_daily_cap_sol, 0), 0) * 1000000000)::text,
    -- Every ::integer cast below clamps BEFORE casting. Casting first overflows: a row
    -- with size_sol = 0 and daily_cap_sol > 2.147 divides by the 1e-9 floor and produces
    -- a value past int4 range, and a large tp1 does the same through the bps conversion.
    -- Either one aborts the whole migration mid-backfill.
    'maxOpenTrades', greatest(1, least(100, floor(
      greatest(coalesce(p_daily_cap_sol, 0), coalesce(p_size_sol, 0)) /
      greatest(coalesce(p_size_sol, 0), 0.000000001)
    ))::integer),
    'slippageBps', greatest(1, least(coalesce(p_slippage_bps, 300), 2000)),
    'priorityFeeMaxLamports', 0,
    'takeProfit', jsonb_build_object('levels', jsonb_build_array(
      jsonb_build_object(
        'targetBps', greatest(1, least(1000000,
          round((greatest(coalesce(p_tp1, 1.01), 1.0001) - 1) * 10000))::integer),
        'sellBps', greatest(1, least(coalesce(p_tp1_sell, 50), 100) * 100)
      ),
      jsonb_build_object(
        'targetBps', greatest(2, least(1000000,
          round((greatest(coalesce(p_tp2, 1.02), 1.0002) - 1) * 10000))::integer),
        'sellBps', greatest(0, least(coalesce(p_tp2_sell, 25), 100) * 100)
      )
    )),
    'stopLoss', jsonb_build_object('stopBps', greatest(1, least(coalesce(p_stop_loss, 40), 100) * 100)),
    'dca', jsonb_build_object('enabled', false, 'levels', '[]'::jsonb),
    'safetyFilters', jsonb_build_object('compatibilityMode', 'platform-baseline'),
    'status', case when coalesce(p_enabled, false) then 'active' else 'paused' end,
    'killSwitch', coalesce(p_kill_switch, false)
  )
$$;

create or replace function app_private.subscriber_config_valid(
  p_config jsonb,
  p_mode text
)
returns boolean
language sql
immutable
set search_path = ''
-- Every branch must return true or false, never NULL. A missing key makes jsonb_typeof
-- return NULL, `true and NULL` is NULL, and the caller's `not valid(...)` is then NULL —
-- which is not true, so the guard does not fire and an unvalidated configuration is
-- versioned silently. The outer coalesce closes that hole; the CASE arms keep a
-- non-numeric value from raising a cast error instead of failing validation.
--
-- The required shape matches what components/product/BotBuilder.tsx always sends
-- (`dca` and `safetyFilters` are objects for both bot kinds). A payload that omits them
-- is refused rather than versioned without the user's risk settings.
as $$
  select case
    when coalesce(jsonb_typeof(p_config), '') <> 'object' then false
    when p_mode = 'legacy-baseline' then true
    else coalesce(
      coalesce(p_config->>'buyAmountLamports', '') ~ '^[0-9]+$'
      and coalesce(p_config->>'maximumCapitalLamports', '') ~ '^[0-9]+$'
      and coalesce(p_config->>'dailyLossLimitLamports', '') ~ '^[0-9]+$'
      and case when jsonb_typeof(p_config->'takeProfit'->'levels') = 'array'
            then jsonb_array_length(p_config->'takeProfit'->'levels') > 0 else false end
      and coalesce(jsonb_typeof(p_config->'stopLoss'), '') = 'object'
      and coalesce(jsonb_typeof(p_config->'dca'), '') = 'object'
      and coalesce(jsonb_typeof(p_config->'safetyFilters'), '') = 'object'
      and case when coalesce(p_config->>'maxOpenTrades', '') ~ '^[0-9]{1,9}$'
            then (p_config->>'maxOpenTrades')::integer between 1 and 100 else false end
      and case when coalesce(p_config->>'slippageBps', '') ~ '^[0-9]{1,9}$'
            then (p_config->>'slippageBps')::integer between 1 and 2000 else false end
      and case when coalesce(p_config->>'priorityFeeMaxLamports', '') ~ '^[0-9]{1,18}$'
            then (p_config->>'priorityFeeMaxLamports')::bigint between 0 and 100000000
            else false end
      and (
        coalesce(p_config->>'status', 'paused') <> 'active'
        or (
          nullif(p_config->>'walletAddress', '') is not null
          and nullif(p_config->>'walletId', '') is not null
        )
      ),
      false)
  end
$$;

create or replace function app_private.create_subscriber_config_version(
  p_kind text,
  p_ref uuid,
  p_owner text,
  p_creator_version uuid,
  p_config jsonb,
  p_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_version integer;
begin
  if p_kind not in ('discord', 'kol', 'wallet-copy')
    or nullif(trim(coalesce(p_owner, '')), '') is null
    or p_mode not in ('versioned', 'legacy-baseline')
    or not coalesce(app_private.subscriber_config_valid(p_config, p_mode), false) then
    raise exception 'invalid subscriber configuration' using errcode = '22023';
  end if;

  -- max()+1 is safe without an advisory lock: an INSERT always carries a fresh id, and
  -- concurrent UPDATEs of the same subscription serialize on that row's write lock,
  -- which a BEFORE trigger already holds.
  select coalesce(max(v.version), 0) + 1 into v_version
  from app_private.subscriber_config_versions v
  where v.subscription_kind = p_kind and v.subscription_ref = p_ref;

  insert into app_private.subscriber_config_versions (
    subscription_kind, subscription_ref, subscriber_privy_user_id, version,
    creator_config_version_id, compatibility_mode, config
  ) values (
    p_kind, p_ref, p_owner, v_version, p_creator_version, p_mode, p_config
  ) returning id into v_id;

  return v_id;
end;
$$;

-- The five trigger functions below are SECURITY DEFINER on purpose.
--
-- service_role holds no USAGE on schema app_private (verified against production), and a
-- trigger function without definer rights runs as the invoking role. Its nested calls to
-- app_private.legacy_subscriber_config / create_subscriber_config_version are ordinary
-- function calls and ARE permission-checked, so every worker or bridge write would fail
-- with "permission denied for schema app_private". Definer rights keep app_private closed
-- to service_role while letting the trigger do its work; `set search_path = ''` plus fully
-- qualified names is what makes that safe. This mirrors
-- app_private.accrue_commission_for_execution, which is already a definer trigger.
create or replace function app_private.version_discord_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config jsonb;
  v_mode text;
  v_owner text;
begin
  v_owner := coalesce(
    nullif(new.privy_user_id, ''),
    case when new.user_id is not null then 'supabase:' || new.user_id::text end
  );
  if v_owner is null then
    return new;
  end if;

  v_mode := case
    when (new.bot_profile_id is not null or new.config_version_id is not null)
      and jsonb_typeof(new.extended_config) = 'object'
      and new.extended_config <> '{}'::jsonb
    then 'versioned' else 'legacy-baseline' end;
  v_config := case when v_mode = 'versioned' then
    new.extended_config || jsonb_build_object(
      'status', coalesce(new.status, case when new.enabled then 'active' else 'paused' end),
      'killSwitch', new.kill_switch
    )
  else app_private.legacy_subscriber_config(
    new.user_pubkey::text, new.wallet_id::text,
    new.size_sol::numeric, new.daily_cap_sol::numeric,
    new.slippage_bps::integer, new.tp1::numeric, new.tp1_sell::integer,
    new.tp2::numeric, new.tp2_sell::integer,
    new.stop_loss::integer, new.enabled::boolean, new.kill_switch::boolean
  ) end;

  new.subscriber_config_snapshot := v_config;
  new.subscriber_config_version_id := app_private.create_subscriber_config_version(
    'discord', new.id, v_owner, new.config_version_id, v_config, v_mode
  );
  return new;
end;
$$;

create or replace function app_private.version_wallet_copy_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config jsonb;
  v_mode text;
  v_owner text;
begin
  v_owner := coalesce(
    nullif(new.privy_user_id, ''),
    case when new.user_id is not null then 'supabase:' || new.user_id::text end
  );
  if v_owner is null then
    return new;
  end if;

  v_mode := case
    when jsonb_typeof(new.extended_config) = 'object'
      and new.extended_config <> '{}'::jsonb
    then 'versioned' else 'legacy-baseline' end;
  v_config := case when v_mode = 'versioned' then
    new.extended_config || jsonb_build_object(
      'walletAddress', new.user_pubkey,
      'walletId', new.wallet_id,
      'status', case when new.enabled then 'active' else 'paused' end,
      'killSwitch', new.kill_switch
    )
  -- public.copy_subscriptions declares size_sol / daily_cap_sol / daily_spent as DOUBLE
  -- PRECISION while public.subscriptions declares them NUMERIC. float8 -> numeric is an
  -- assignment cast, so without these explicit casts PostgreSQL cannot resolve
  -- legacy_subscriber_config here and EVERY write to copy_subscriptions raises.
  else app_private.legacy_subscriber_config(
    new.user_pubkey::text, new.wallet_id::text,
    new.size_sol::numeric, new.daily_cap_sol::numeric,
    new.slippage_bps::integer, new.tp1::numeric, new.tp1_sell::integer,
    new.tp2::numeric, new.tp2_sell::integer,
    new.stop_loss::integer, new.enabled::boolean, new.kill_switch::boolean
  ) end;

  new.subscriber_config_snapshot := v_config;
  new.subscriber_config_version_id := app_private.create_subscriber_config_version(
    'wallet-copy', new.id, v_owner, null, v_config, v_mode
  );
  return new;
end;
$$;

create or replace function app_private.version_kol_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator jsonb;
  v_wallet_address text;
  v_wallet_id text;
  v_config jsonb;
  v_mode text;
begin
  select c.config into v_creator
  from app_private.bot_config_versions c
  where c.id = new.strategy_version_id;
  select w.address, w.privy_wallet_id into v_wallet_address, v_wallet_id
  from app_private.trading_wallets w
  where w.id = new.wallet_id and w.privy_user_id = new.subscriber_privy_user_id;

  v_mode := case
    when coalesce(new.config->>'buyAmountLamports', '') ~ '^[0-9]+$'
      and coalesce(new.config->>'maximumCapitalLamports', '') ~ '^[0-9]+$'
      and v_creator is not null
    then 'versioned' else 'legacy-baseline' end;
  v_config := case when v_mode = 'versioned' then
    v_creator || new.config || jsonb_build_object(
      'walletAddress', coalesce(new.config->>'walletAddress', v_wallet_address),
      'walletId', coalesce(new.config->>'walletId', v_wallet_id),
      'takeProfit', coalesce(new.config->'takeProfit', v_creator->'takeProfit'),
      'stopLoss', coalesce(new.config->'stopLoss', v_creator->'stopLoss'),
      'dca', coalesce(new.config->'dca', v_creator->'dca', '{"enabled":false,"levels":[]}'::jsonb),
      'safetyFilters', coalesce(new.config->'safetyFilters', v_creator->'safetyFilters'),
      'status', new.status,
      'killSwitch', new.kill_switch,
      'subscriberOverrides', new.config
    )
  else new.config || jsonb_build_object(
    'compatibilityMode', 'legacy-baseline',
    'status', new.status,
    'killSwitch', new.kill_switch
  ) end;

  new.subscriber_config_snapshot := v_config;
  new.subscriber_config_version_id := app_private.create_subscriber_config_version(
    'kol', new.id, new.subscriber_privy_user_id, new.strategy_version_id,
    v_config, v_mode
  );
  return new;
end;
$$;

drop trigger if exists subscriptions_config_version_insert on public.subscriptions;
create trigger subscriptions_config_version_insert
before insert on public.subscriptions
for each row execute function app_private.version_discord_subscription();
-- subscriber_config_snapshot and subscriber_config_version_id are in the UPDATE column
-- list so they cannot be written directly. public.subscriptions carries a table-level
-- UPDATE grant to authenticated, and a table-level grant cannot be narrowed per column,
-- so the only way to stop a forged snapshot is to make any write of one re-enter the
-- trigger, which recomputes both from the authoritative columns and discards the
-- supplied value. daily_spent is deliberately absent: worker accounting must not version.
drop trigger if exists subscriptions_config_version_update on public.subscriptions;
create trigger subscriptions_config_version_update
before update of size_sol, tp1, tp1_sell, tp2, tp2_sell, stop_loss,
  slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id,
  bot_profile_id, config_version_id, status, extended_config, kill_switch,
  subscriber_config_snapshot, subscriber_config_version_id
on public.subscriptions
for each row execute function app_private.version_discord_subscription();

drop trigger if exists copy_subscriptions_config_version_insert on public.copy_subscriptions;
create trigger copy_subscriptions_config_version_insert
before insert on public.copy_subscriptions
for each row execute function app_private.version_wallet_copy_subscription();
drop trigger if exists copy_subscriptions_config_version_update on public.copy_subscriptions;
create trigger copy_subscriptions_config_version_update
before update of size_sol, tp1, tp1_sell, tp2, tp2_sell, stop_loss,
  slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id,
  extended_config, kill_switch,
  subscriber_config_snapshot, subscriber_config_version_id
on public.copy_subscriptions
for each row execute function app_private.version_wallet_copy_subscription();

drop trigger if exists kol_subscriptions_config_version_insert on app_private.kol_subscriptions;
create trigger kol_subscriptions_config_version_insert
before insert on app_private.kol_subscriptions
for each row execute function app_private.version_kol_subscription();
drop trigger if exists kol_subscriptions_config_version_update on app_private.kol_subscriptions;
create trigger kol_subscriptions_config_version_update
before update of wallet_id, strategy_version_id, status, config, kill_switch,
  subscriber_config_snapshot, subscriber_config_version_id
on app_private.kol_subscriptions
for each row execute function app_private.version_kol_subscription();

-- Backfill through the same builders. Daily spend is excluded from update triggers, so
-- worker accounting never creates configuration versions.
update public.subscriptions set extended_config = extended_config
where (privy_user_id is not null or user_id is not null)
  and subscriber_config_version_id is null;
update public.copy_subscriptions set extended_config = extended_config
where (privy_user_id is not null or user_id is not null)
  and subscriber_config_version_id is null;
update app_private.kol_subscriptions set config = config
where subscriber_config_version_id is null;

alter table app_private.call_executions
  add column if not exists subscriber_config_version_id uuid
    references app_private.subscriber_config_versions(id) on delete restrict,
  add column if not exists subscriber_config_snapshot jsonb not null default '{}'::jsonb;
alter table app_private.copy_executions
  add column if not exists subscriber_config_version_id uuid
    references app_private.subscriber_config_versions(id) on delete restrict,
  add column if not exists subscriber_config_snapshot jsonb not null default '{}'::jsonb;

create index if not exists call_executions_subscriber_config_idx
  on app_private.call_executions (subscriber_config_version_id);
create index if not exists copy_executions_subscriber_config_idx
  on app_private.copy_executions (subscriber_config_version_id);

create or replace function app_private.attach_call_execution_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.subscriber_config_version_id is distinct from old.subscriber_config_version_id
      or new.subscriber_config_snapshot is distinct from old.subscriber_config_snapshot then
      raise exception 'execution subscriber configuration is immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  select s.subscriber_config_version_id, s.subscriber_config_snapshot
  into new.subscriber_config_version_id, new.subscriber_config_snapshot
  from public.subscriptions s
  where s.id = new.subscription_id and s.kill_switch = false;
  if new.subscriber_config_version_id is null or new.subscriber_config_snapshot = '{}'::jsonb then
    raise exception 'subscriber configuration unavailable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.attach_copy_execution_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.subscriber_config_version_id is distinct from old.subscriber_config_version_id
      or new.subscriber_config_snapshot is distinct from old.subscriber_config_snapshot then
      raise exception 'execution subscriber configuration is immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  select s.subscriber_config_version_id, s.subscriber_config_snapshot
  into new.subscriber_config_version_id, new.subscriber_config_snapshot
  from public.copy_subscriptions s
  where s.id = new.subscription_id and s.kill_switch = false;
  if new.subscriber_config_version_id is null or new.subscriber_config_snapshot = '{}'::jsonb then
    raise exception 'subscriber configuration unavailable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists call_executions_config_snapshot on app_private.call_executions;
create trigger call_executions_config_snapshot
before insert or update of subscriber_config_version_id, subscriber_config_snapshot
on app_private.call_executions
for each row execute function app_private.attach_call_execution_config();
drop trigger if exists copy_executions_config_snapshot on app_private.copy_executions;
create trigger copy_executions_config_snapshot
before insert or update of subscriber_config_version_id, subscriber_config_snapshot
on app_private.copy_executions
for each row execute function app_private.attach_copy_execution_config();

revoke execute on function app_private.create_subscriber_config_version(text, uuid, text, uuid, jsonb, text)
  from public, anon, authenticated;
revoke execute on function app_private.legacy_subscriber_config(text, text, numeric, numeric, integer, numeric, integer, numeric, integer, integer, boolean, boolean)
  from public, anon, authenticated;
revoke execute on function app_private.subscriber_config_valid(jsonb, text)
  from public, anon, authenticated;
revoke execute on function app_private.reject_subscriber_config_mutation()
  from public, anon, authenticated;
revoke execute on function app_private.version_discord_subscription()
  from public, anon, authenticated;
revoke execute on function app_private.version_wallet_copy_subscription()
  from public, anon, authenticated;
revoke execute on function app_private.version_kol_subscription()
  from public, anon, authenticated;
revoke execute on function app_private.attach_call_execution_config()
  from public, anon, authenticated;
revoke execute on function app_private.attach_copy_execution_config()
  from public, anon, authenticated;
