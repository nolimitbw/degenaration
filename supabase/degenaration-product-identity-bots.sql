-- DegenAration product foundation: verified identities, roles, wallets, and versioned bots.
-- Forward-safe: creates new private records and only adds nullable columns to legacy tables.
-- Rollback: disable the new RPCs first, then drop the new tables in reverse dependency order.

create schema if not exists app_private;

create table if not exists app_private.app_users (
  privy_user_id text primary key,
  display_name text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.auth_identities (
  id uuid primary key default gen_random_uuid(),
  privy_user_id text not null references app_private.app_users(privy_user_id) on delete cascade,
  provider text not null check (provider in ('google_oauth', 'discord_oauth', 'wallet')),
  provider_subject text not null,
  normalized_email text,
  email_verified boolean not null default false,
  linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (provider, provider_subject)
);

create unique index if not exists auth_identities_verified_email_unique
  on app_private.auth_identities (provider, normalized_email)
  where normalized_email is not null and email_verified = true and revoked_at is null;

create table if not exists app_private.admin_email_allowlist (
  normalized_email text primary key,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

insert into app_private.admin_email_allowlist (normalized_email, note)
values ('flipthatsol@gmail.com', 'Initial DegenAration owner')
on conflict (normalized_email) do update
set active = true;

create table if not exists app_private.user_roles (
  id uuid primary key default gen_random_uuid(),
  privy_user_id text not null references app_private.app_users(privy_user_id) on delete cascade,
  role text not null check (role in ('USER', 'ADMIN')),
  granted_by text,
  reason text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists user_roles_active_unique
  on app_private.user_roles (privy_user_id, role)
  where revoked_at is null;

create table if not exists app_private.trading_wallets (
  id uuid primary key default gen_random_uuid(),
  privy_user_id text not null references app_private.app_users(privy_user_id) on delete cascade,
  privy_wallet_id text,
  address text not null check (length(address) between 32 and 64),
  chain text not null default 'solana' check (chain = 'solana'),
  label text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'revoked')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (privy_user_id, address)
);

create unique index if not exists trading_wallets_privy_wallet_unique
  on app_private.trading_wallets (privy_user_id, privy_wallet_id)
  where privy_wallet_id is not null;

create table if not exists app_private.bot_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  kind text not null check (kind in ('discord', 'kol')),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 600),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'stopping', 'archived', 'error')),
  visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  execution_mode text not null default 'paper'
    check (execution_mode in ('paper', 'solana-devnet', 'solana-mainnet')),
  wallet_id uuid references app_private.trading_wallets(id) on delete set null,
  source_group_id uuid references public.approved_groups(id) on delete set null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  last_activity_at timestamptz
);

create index if not exists bot_profiles_owner_kind_idx
  on app_private.bot_profiles (owner_privy_user_id, kind, status, updated_at desc);

create index if not exists bot_profiles_marketplace_idx
  on app_private.bot_profiles (kind, visibility, status, published_at desc)
  where visibility = 'public' and status in ('active', 'paused');

create table if not exists app_private.bot_config_versions (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references app_private.bot_profiles(id) on delete restrict,
  version integer not null check (version > 0),
  schema_version integer not null default 1 check (schema_version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_by text not null,
  change_note text,
  created_at timestamptz not null default now(),
  unique (bot_id, version)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_profiles_current_version_fkey'
      and conrelid = 'app_private.bot_profiles'::regclass
  ) then
    alter table app_private.bot_profiles
      add constraint bot_profiles_current_version_fkey
      foreign key (current_version_id)
      references app_private.bot_config_versions(id)
      on delete restrict
      deferrable initially deferred;
  end if;
end;
$$;

create table if not exists app_private.bot_events (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references app_private.bot_profiles(id) on delete restrict,
  actor_privy_user_id text,
  event_type text not null,
  previous_status text,
  next_status text,
  reason text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bot_events_bot_created_idx
  on app_private.bot_events (bot_id, created_at desc);

create table if not exists app_private.kol_strategies (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null unique references app_private.bot_profiles(id) on delete restrict,
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  moderation_status text not null default 'unreviewed'
    check (moderation_status in ('unreviewed', 'pending', 'approved', 'rejected', 'suspended')),
  creator_fee_bps integer not null default 20 check (creator_fee_bps between 0 and 1000),
  risk_tier text not null default 'high'
    check (risk_tier in ('moderate', 'high', 'very-high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_moderated_at timestamptz
);

create index if not exists kol_strategies_marketplace_idx
  on app_private.kol_strategies (moderation_status, updated_at desc);

create table if not exists app_private.kol_subscriptions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references app_private.kol_strategies(id) on delete restrict,
  subscriber_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  wallet_id uuid references app_private.trading_wallets(id) on delete set null,
  strategy_version_id uuid not null references app_private.bot_config_versions(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'stopping', 'archived', 'error')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  creator_fee_bps_snapshot integer not null default 20
    check (creator_fee_bps_snapshot between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (strategy_id, subscriber_privy_user_id)
);

create index if not exists kol_subscriptions_user_idx
  on app_private.kol_subscriptions (subscriber_privy_user_id, status, updated_at desc);

alter table public.subscriptions
  add column if not exists bot_profile_id uuid,
  add column if not exists config_version_id uuid,
  add column if not exists channel_id text,
  add column if not exists status text not null default 'paused',
  add column if not exists extended_config jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_bot_profile_fkey'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_bot_profile_fkey
      foreign key (bot_profile_id)
      references app_private.bot_profiles(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_config_version_fkey'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_config_version_fkey
      foreign key (config_version_id)
      references app_private.bot_config_versions(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_status_check_v2'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_status_check_v2
      check (status in ('draft', 'active', 'paused', 'stopping', 'archived', 'error'));
  end if;
end;
$$;

create unique index if not exists subscriptions_bot_profile_unique
  on public.subscriptions (bot_profile_id)
  where bot_profile_id is not null;

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.reject_financial_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable record' using errcode = '55000';
end;
$$;

create or replace function app_private.enforce_kol_publication_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.kind <> 'kol'
    or new.visibility <> 'public'
    or new.status not in ('active', 'paused') then
    return new;
  end if;

  select count(*) into v_count
  from app_private.bot_profiles b
  where b.owner_privy_user_id = new.owner_privy_user_id
    and b.kind = 'kol'
    and b.visibility = 'public'
    and b.status in ('active', 'paused')
    and b.id <> new.id;

  if v_count >= 3 then
    raise exception 'maximum three published KOL bots' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_touch_updated_at on app_private.app_users;
create trigger app_users_touch_updated_at
before update on app_private.app_users
for each row execute function app_private.touch_updated_at();

drop trigger if exists trading_wallets_touch_updated_at on app_private.trading_wallets;
create trigger trading_wallets_touch_updated_at
before update on app_private.trading_wallets
for each row execute function app_private.touch_updated_at();

drop trigger if exists bot_profiles_touch_updated_at on app_private.bot_profiles;
create trigger bot_profiles_touch_updated_at
before update on app_private.bot_profiles
for each row execute function app_private.touch_updated_at();

drop trigger if exists kol_strategies_touch_updated_at on app_private.kol_strategies;
create trigger kol_strategies_touch_updated_at
before update on app_private.kol_strategies
for each row execute function app_private.touch_updated_at();

drop trigger if exists kol_subscriptions_touch_updated_at on app_private.kol_subscriptions;
create trigger kol_subscriptions_touch_updated_at
before update on app_private.kol_subscriptions
for each row execute function app_private.touch_updated_at();

drop trigger if exists bot_config_versions_immutable on app_private.bot_config_versions;
create trigger bot_config_versions_immutable
before update or delete on app_private.bot_config_versions
for each row execute function app_private.reject_financial_history_mutation();

drop trigger if exists bot_profiles_kol_publication_limit on app_private.bot_profiles;
create trigger bot_profiles_kol_publication_limit
before insert or update of kind, visibility, status on app_private.bot_profiles
for each row execute function app_private.enforce_kol_publication_limit();

alter table app_private.app_users enable row level security;
alter table app_private.auth_identities enable row level security;
alter table app_private.admin_email_allowlist enable row level security;
alter table app_private.user_roles enable row level security;
alter table app_private.trading_wallets enable row level security;
alter table app_private.bot_profiles enable row level security;
alter table app_private.bot_config_versions enable row level security;
alter table app_private.bot_events enable row level security;
alter table app_private.kol_strategies enable row level security;
alter table app_private.kol_subscriptions enable row level security;

revoke all on table app_private.app_users from public, anon, authenticated;
revoke all on table app_private.auth_identities from public, anon, authenticated;
revoke all on table app_private.admin_email_allowlist from public, anon, authenticated;
revoke all on table app_private.user_roles from public, anon, authenticated;
revoke all on table app_private.trading_wallets from public, anon, authenticated;
revoke all on table app_private.bot_profiles from public, anon, authenticated;
revoke all on table app_private.bot_config_versions from public, anon, authenticated;
revoke all on table app_private.bot_events from public, anon, authenticated;
revoke all on table app_private.kol_strategies from public, anon, authenticated;
revoke all on table app_private.kol_subscriptions from public, anon, authenticated;
