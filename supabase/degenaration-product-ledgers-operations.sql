-- DegenAration durable signals, execution, accounting, scanner, payout, and operations records.
-- Forward-safe: no existing financial rows are deleted or rewritten.
-- Rollback: stop workers and APIs, then drop new tables in reverse dependency order.

alter table public.approved_groups
  add column if not exists owner_privy_user_id text,
  add column if not exists creator_fee_bps integer not null default 70,
  add column if not exists verification_status text not null default 'approved',
  add column if not exists last_verified_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists removal_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_groups_creator_fee_bps_check'
      and conrelid = 'public.approved_groups'::regclass
  ) then
    alter table public.approved_groups
      add constraint approved_groups_creator_fee_bps_check
      check (creator_fee_bps between 0 and 1000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_groups_verification_status_check'
      and conrelid = 'public.approved_groups'::regclass
  ) then
    alter table public.approved_groups
      add constraint approved_groups_verification_status_check
      check (verification_status in ('pending', 'approved', 'suspended', 'removed'));
  end if;
end;
$$;

alter table public.call_channels
  add column if not exists owner_privy_user_id text,
  add column if not exists permissions_checked_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists removed_at timestamptz;

alter table public.call_channels
  drop constraint if exists call_channels_status_check;

alter table public.call_channels
  add constraint call_channels_status_check
  check (status in ('pending', 'changes_requested', 'approved', 'rejected', 'suspended', 'removed'));

alter table public.calls
  add column if not exists parser_version text,
  add column if not exists parser_confidence numeric,
  add column if not exists parse_status text not null default 'accepted',
  add column if not exists rejection_reason text,
  add column if not exists raw_event_id uuid,
  add column if not exists parsed_signal_id uuid,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.trades
  add column if not exists execution_id uuid,
  add column if not exists gross_notional_lamports bigint,
  add column if not exists platform_fee_lamports bigint,
  add column if not exists creator_fee_lamports bigint,
  add column if not exists net_value_lamports bigint,
  add column if not exists reconciliation_status text not null default 'legacy';

create table if not exists app_private.source_ownership_history (
  id uuid primary key default gen_random_uuid(),
  source_group_id uuid not null references public.approved_groups(id) on delete restrict,
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  verified_identity_id uuid references app_private.auth_identities(id) on delete set null,
  creator_fee_bps integer not null default 70 check (creator_fee_bps between 0 and 1000),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  reason text,
  check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists source_ownership_current_unique
  on app_private.source_ownership_history (source_group_id)
  where valid_to is null;

create table if not exists app_private.scanner_adapters (
  adapter_key text primary key,
  display_name text not null,
  adapter_version integer not null default 1 check (adapter_version > 0),
  status text not null default 'planned'
    check (status in ('supported', 'degraded', 'planned', 'unsupported', 'disabled')),
  program_ids text[] not null default '{}',
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  limitation text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  slot_lag bigint,
  updated_at timestamptz not null default now()
);

insert into app_private.scanner_adapters
  (adapter_key, display_name, status, capabilities, limitation)
values
  ('dexscreener-aggregate', 'DexScreener aggregate market data', 'supported',
    '{"discovery":true,"marketSnapshot":true,"poolProgramVerification":false}'::jsonb,
    'Aggregated off-chain market data; venue program identity is not authoritative.'),
  ('jupiter-route', 'Jupiter route and quote adapter', 'supported',
    '{"quote":true,"swapBuild":true,"discovery":false}'::jsonb,
    'Route availability does not prove a pool-specific scanner adapter is supported.'),
  ('rugcheck-risk', 'RugCheck risk adapter', 'supported',
    '{"riskSnapshot":true,"holderSignals":true}'::jsonb,
    'Third-party risk data may be unavailable or stale and must fail closed when required.'),
  ('raydium-amm-v4', 'Raydium AMM V4', 'planned', '{}'::jsonb,
    'Program-specific event discovery and decoding are not implemented.'),
  ('raydium-cpmm', 'Raydium CPMM', 'planned', '{}'::jsonb,
    'Program-specific event discovery and decoding are not implemented.'),
  ('raydium-clmm', 'Raydium CLMM', 'planned', '{}'::jsonb,
    'Program-specific event discovery and decoding are not implemented.'),
  ('raydium-launchlab', 'Raydium LaunchLab', 'planned', '{}'::jsonb,
    'Program-specific launch discovery is not implemented.'),
  ('pumpfun-bonding', 'Pump.fun bonding curve', 'planned', '{}'::jsonb,
    'Program-specific launch discovery is not implemented.'),
  ('pumpswap', 'PumpSwap', 'planned', '{}'::jsonb,
    'Program-specific pool discovery and decoding are not implemented.'),
  ('meteora', 'Meteora AMM and DAMM', 'planned', '{}'::jsonb,
    'Program-specific pool discovery and decoding are not implemented.'),
  ('orca-whirlpools', 'Orca Whirlpools', 'planned', '{}'::jsonb,
    'Program-specific pool discovery and decoding are not implemented.'),
  ('moonshot', 'Moonshot', 'planned', '{}'::jsonb,
    'Program-specific launch discovery is not implemented.'),
  ('bonk-launch', 'Bonk ecosystem launch venues', 'planned', '{}'::jsonb,
    'Program-specific launch discovery is not implemented.')
on conflict (adapter_key) do nothing;

create table if not exists app_private.scanner_tokens (
  mint text primary key check (length(mint) between 32 and 64),
  token_program text,
  decimals integer check (decimals between 0 and 18),
  symbol text,
  name text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  validation_status text not null default 'unverified'
    check (validation_status in ('valid', 'invalid', 'unverified', 'unsupported')),
  validation_reason text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists app_private.scanner_pools (
  id uuid primary key default gen_random_uuid(),
  pool_address text not null,
  mint text not null references app_private.scanner_tokens(mint) on delete restrict,
  quote_mint text,
  adapter_key text not null references app_private.scanner_adapters(adapter_key) on delete restrict,
  program_id text,
  status text not null default 'observed'
    check (status in ('observed', 'verified', 'unsupported', 'inactive')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (pool_address, adapter_key)
);

create index if not exists scanner_pools_mint_status_idx
  on app_private.scanner_pools (mint, status, last_seen_at desc);

create table if not exists app_private.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  mint text not null references app_private.scanner_tokens(mint) on delete restrict,
  pool_id uuid references app_private.scanner_pools(id) on delete set null,
  provider text not null,
  observed_at timestamptz not null,
  slot bigint,
  price_usd numeric,
  market_cap_usd numeric,
  liquidity_usd numeric,
  volume_usd numeric,
  price_change_bps integer,
  payload jsonb not null default '{}'::jsonb,
  freshness_status text not null default 'fresh'
    check (freshness_status in ('fresh', 'stale', 'unavailable')),
  created_at timestamptz not null default now(),
  unique (mint, provider, observed_at)
);

create index if not exists market_snapshots_mint_observed_idx
  on app_private.market_snapshots (mint, observed_at desc);

create table if not exists app_private.risk_snapshots (
  id uuid primary key default gen_random_uuid(),
  mint text not null references app_private.scanner_tokens(mint) on delete restrict,
  provider text not null,
  observed_at timestamptz not null,
  risk_score integer check (risk_score between 0 and 100),
  mint_authority_revoked boolean,
  freeze_authority_revoked boolean,
  top_10_bps integer check (top_10_bps between 0 and 10000),
  holder_count integer check (holder_count >= 0),
  payload jsonb not null default '{}'::jsonb,
  freshness_status text not null default 'fresh'
    check (freshness_status in ('fresh', 'stale', 'unavailable')),
  created_at timestamptz not null default now(),
  unique (mint, provider, observed_at)
);

create index if not exists risk_snapshots_mint_observed_idx
  on app_private.risk_snapshots (mint, observed_at desc);

create table if not exists app_private.raw_signals (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('discord', 'kol', 'manual', 'scanner')),
  source_ref text not null,
  external_event_id text,
  event_version text,
  immutable_payload jsonb not null check (jsonb_typeof(immutable_payload) = 'object'),
  content_hash text not null,
  received_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (source_type, source_ref, external_event_id)
);

create index if not exists raw_signals_hash_idx
  on app_private.raw_signals (content_hash, received_at desc);

create table if not exists app_private.parsed_signals (
  id uuid primary key default gen_random_uuid(),
  raw_signal_id uuid not null references app_private.raw_signals(id) on delete restrict,
  parser_version text not null,
  status text not null
    check (status in ('accepted', 'quarantined', 'rejected', 'duplicate')),
  mint text,
  confidence_bps integer check (confidence_bps between 0 and 10000),
  rejection_reason text,
  normalized_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (raw_signal_id, parser_version)
);

create index if not exists parsed_signals_status_created_idx
  on app_private.parsed_signals (status, created_at desc);

create table if not exists app_private.signal_deliveries (
  id uuid primary key default gen_random_uuid(),
  parsed_signal_id uuid not null references app_private.parsed_signals(id) on delete restrict,
  bot_id uuid not null references app_private.bot_profiles(id) on delete restrict,
  config_version_id uuid not null references app_private.bot_config_versions(id) on delete restrict,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'evaluating', 'eligible', 'rejected', 'claimed', 'completed', 'failed')),
  evaluation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists signal_deliveries_bot_status_idx
  on app_private.signal_deliveries (bot_id, status, created_at desc);

create table if not exists app_private.trade_intents (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  bot_id uuid references app_private.bot_profiles(id) on delete restrict,
  config_version_id uuid references app_private.bot_config_versions(id) on delete restrict,
  signal_delivery_id uuid references app_private.signal_deliveries(id) on delete restrict,
  intent_kind text not null
    check (intent_kind in ('entry', 'dca', 'take-profit', 'stop-loss', 'emergency-exit', 'manual')),
  side text not null check (side in ('buy', 'sell')),
  mint text not null,
  requested_input_base_units numeric(39, 0) not null check (requested_input_base_units > 0),
  execution_mode text not null
    check (execution_mode in ('paper', 'solana-devnet', 'solana-mainnet')),
  state text not null default 'created'
    check (state in (
      'created', 'validating', 'ready', 'claimed', 'submitting', 'submitted',
      'confirmed', 'reconciled', 'failed', 'expired', 'cancelled', 'quarantined'
    )),
  idempotency_key text not null unique,
  safety_snapshot jsonb not null default '{}'::jsonb,
  quote_expires_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz
);

create index if not exists trade_intents_owner_state_idx
  on app_private.trade_intents (owner_privy_user_id, state, created_at desc);

create index if not exists trade_intents_worker_queue_idx
  on app_private.trade_intents (state, created_at)
  where state in ('ready', 'claimed', 'submitting', 'submitted', 'confirmed');

create table if not exists app_private.trade_executions (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references app_private.trade_intents(id) on delete restrict,
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  execution_mode text not null
    check (execution_mode in ('paper', 'solana-devnet', 'solana-mainnet')),
  status text not null default 'created'
    check (status in ('created', 'submitted', 'confirmed', 'reconciled', 'failed', 'dropped', 'expired')),
  attempt integer not null default 1 check (attempt > 0),
  tx_signature text,
  slot bigint,
  gross_notional_lamports bigint not null default 0 check (gross_notional_lamports >= 0),
  network_fee_lamports bigint not null default 0 check (network_fee_lamports >= 0),
  priority_fee_lamports bigint not null default 0 check (priority_fee_lamports >= 0),
  platform_fee_lamports bigint not null default 0 check (platform_fee_lamports >= 0),
  creator_fee_lamports bigint not null default 0 check (creator_fee_lamports >= 0),
  platform_fee_bps_snapshot integer not null default 0 check (platform_fee_bps_snapshot between 0 and 10000),
  creator_fee_bps_snapshot integer not null default 0 check (creator_fee_bps_snapshot between 0 and 10000),
  creator_privy_user_id_snapshot text,
  source_group_id_snapshot uuid,
  strategy_id_snapshot uuid,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  reconciled_at timestamptz,
  error_code text,
  error_message text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (intent_id, attempt)
);

create unique index if not exists trade_executions_signature_unique
  on app_private.trade_executions (tx_signature)
  where tx_signature is not null;

create index if not exists trade_executions_owner_created_idx
  on app_private.trade_executions (owner_privy_user_id, created_at desc);

create table if not exists app_private.execution_legs (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references app_private.trade_executions(id) on delete restrict,
  leg_index integer not null check (leg_index >= 0),
  input_mint text not null,
  output_mint text not null,
  input_base_units numeric(39, 0) not null check (input_base_units >= 0),
  output_base_units numeric(39, 0) not null check (output_base_units >= 0),
  route_label text,
  pool_address text,
  created_at timestamptz not null default now(),
  unique (execution_id, leg_index)
);

create table if not exists app_private.positions (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  bot_id uuid references app_private.bot_profiles(id) on delete restrict,
  config_version_id uuid references app_private.bot_config_versions(id) on delete restrict,
  mint text not null,
  status text not null default 'open'
    check (status in ('opening', 'open', 'closing', 'closed', 'error')),
  quantity_base_units numeric(39, 0) not null default 0 check (quantity_base_units >= 0),
  cost_lamports bigint not null default 0 check (cost_lamports >= 0),
  realized_pnl_lamports bigint not null default 0,
  fees_lamports bigint not null default 0 check (fees_lamports >= 0),
  entry_config_snapshot jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists positions_owner_status_idx
  on app_private.positions (owner_privy_user_id, status, opened_at desc);

create table if not exists app_private.position_lots (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references app_private.positions(id) on delete restrict,
  entry_execution_id uuid not null references app_private.trade_executions(id) on delete restrict,
  quantity_base_units numeric(39, 0) not null check (quantity_base_units > 0),
  remaining_base_units numeric(39, 0) not null check (remaining_base_units >= 0),
  cost_lamports bigint not null check (cost_lamports >= 0),
  created_at timestamptz not null default now(),
  check (remaining_base_units <= quantity_base_units)
);

create table if not exists app_private.cash_movements (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  wallet_id uuid references app_private.trading_wallets(id) on delete set null,
  movement_type text not null check (movement_type in ('deposit', 'withdrawal')),
  status text not null check (status in ('detected', 'pending', 'confirmed', 'failed', 'reversed')),
  amount_lamports bigint not null check (amount_lamports > 0),
  network_fee_lamports bigint not null default 0 check (network_fee_lamports >= 0),
  tx_signature text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tx_signature, movement_type)
);

create index if not exists cash_movements_owner_created_idx
  on app_private.cash_movements (owner_privy_user_id, created_at desc);

create table if not exists app_private.affiliate_profiles (
  privy_user_id text primary key references app_private.app_users(privy_user_id) on delete restrict,
  referral_code text not null unique check (referral_code ~ '^[A-Za-z0-9_-]{6,32}$'),
  payout_wallet text,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.referral_links (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{6,48}$'),
  subject_type text not null check (subject_type in ('discord', 'kol', 'profile')),
  subject_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists app_private.referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_link_id uuid not null references app_private.referral_links(id) on delete restrict,
  event_type text not null check (event_type in ('click', 'signup', 'follow', 'trade')),
  visitor_hash text,
  referred_privy_user_id text,
  notional_lamports bigint check (notional_lamports is null or notional_lamports >= 0),
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists referral_events_link_occurred_idx
  on app_private.referral_events (referral_link_id, occurred_at desc);

create table if not exists app_private.payout_requests (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  asset text not null default 'SOL' check (asset = 'SOL'),
  chain text not null default 'solana' check (chain = 'solana'),
  destination_wallet text not null,
  gross_lamports bigint not null check (gross_lamports >= 100000000),
  processing_fee_lamports bigint not null default 43000000
    check (processing_fee_lamports = 43000000),
  net_lamports bigint generated always as (gross_lamports - processing_fee_lamports) stored,
  status text not null default 'requested'
    check (status in ('requested', 'reviewing', 'approved', 'processing', 'confirmed', 'failed', 'rejected', 'reversed')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  processed_at timestamptz,
  tx_signature text,
  decision_reason text,
  correlation_id uuid not null default gen_random_uuid(),
  check (gross_lamports > processing_fee_lamports)
);

create index if not exists payout_requests_owner_status_idx
  on app_private.payout_requests (owner_privy_user_id, status, requested_at desc);

create table if not exists app_private.commission_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_owner_privy_user_id text,
  account_type text not null check (account_type in ('creator', 'platform')),
  source_type text not null check (source_type in ('discord', 'kol', 'payout', 'reversal', 'adjustment')),
  source_id text,
  execution_id uuid references app_private.trade_executions(id) on delete restrict,
  payout_request_id uuid references app_private.payout_requests(id) on delete restrict,
  amount_lamports bigint not null check (amount_lamports <> 0),
  rate_bps integer check (rate_bps is null or rate_bps between 0 and 10000),
  gross_notional_lamports bigint check (gross_notional_lamports is null or gross_notional_lamports >= 0),
  available_at timestamptz not null default now(),
  idempotency_key text not null unique,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (account_type = 'creator' and account_owner_privy_user_id is not null)
    or account_type = 'platform'
  )
);

create index if not exists commission_ledger_owner_available_idx
  on app_private.commission_ledger_entries
  (account_owner_privy_user_id, available_at, created_at desc);

create table if not exists app_private.pnl_card_records (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  card_type text not null check (card_type in ('winner', 'loser', 'portfolio')),
  subject_type text not null check (subject_type in ('execution', 'position', 'portfolio-snapshot')),
  subject_id text not null,
  authoritative_snapshot jsonb not null check (jsonb_typeof(authoritative_snapshot) = 'object'),
  referral_link_id uuid references app_private.referral_links(id) on delete set null,
  render_version integer not null default 1,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (owner_privy_user_id, card_type, subject_type, subject_id, content_hash)
);

create table if not exists app_private.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('discord-source', 'kol-strategy', 'bot', 'portfolio')),
  subject_id text not null,
  period text not null check (period in ('1d', '7d', '30d', '3m', 'all')),
  as_of timestamptz not null,
  sample_size integer not null default 0 check (sample_size >= 0),
  net_pnl_lamports bigint,
  realized_pnl_lamports bigint,
  volume_lamports bigint,
  network_fees_lamports bigint,
  platform_fees_lamports bigint,
  creator_fees_lamports bigint,
  max_drawdown_bps integer,
  win_rate_bps integer,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (subject_type, subject_id, period, as_of)
);

create index if not exists performance_snapshots_subject_idx
  on app_private.performance_snapshots (subject_type, subject_id, period, as_of desc);

create table if not exists app_private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'published', 'failed', 'dead-letter')),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_by text,
  locked_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists outbox_events_queue_idx
  on app_private.outbox_events (status, available_at, created_at)
  where status in ('pending', 'processing', 'failed');

create table if not exists app_private.durable_jobs (
  id uuid primary key default gen_random_uuid(),
  queue_name text not null,
  job_type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'failed', 'dead-letter', 'cancelled')),
  priority integer not null default 100,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 100),
  correlation_id uuid not null default gen_random_uuid(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists durable_jobs_claim_idx
  on app_private.durable_jobs (queue_name, status, available_at, priority, created_at)
  where status in ('queued', 'leased', 'failed');

create table if not exists app_private.worker_leases (
  worker_key text primary key,
  instance_id text not null,
  execution_mode text not null
    check (execution_mode in ('paper', 'solana-devnet', 'solana-mainnet')),
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists app_private.system_flags (
  flag_key text primary key,
  value jsonb not null,
  description text,
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into app_private.system_flags (flag_key, value, description)
values
  ('execution_mode', '"paper"'::jsonb, 'Current automation execution environment.'),
  ('mainnet_execution_enabled', 'false'::jsonb, 'Global mainnet execution gate.'),
  ('discord_entries_enabled', 'false'::jsonb, 'Global Discord automated entry gate.'),
  ('kol_entries_enabled', 'false'::jsonb, 'Global KOL automated entry gate.'),
  ('automated_exits_enabled', 'false'::jsonb, 'Global TP/SL execution gate.'),
  ('payout_processing_enabled', 'false'::jsonb, 'Global payout transaction gate.')
on conflict (flag_key) do nothing;

create table if not exists app_private.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_privy_user_id text not null,
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  previous_state jsonb,
  next_state jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  request_ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_idx
  on app_private.admin_audit_log (created_at desc);

create table if not exists app_private.rate_limit_buckets (
  scope text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  expires_at timestamptz not null,
  primary key (scope, subject_hash, window_started_at)
);

create index if not exists rate_limit_buckets_expiry_idx
  on app_private.rate_limit_buckets (expires_at);

create or replace function app_private.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable record' using errcode = '55000';
end;
$$;

create or replace function app_private.validate_execution_fees()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform_fee_lamports + new.creator_fee_lamports > new.gross_notional_lamports then
    raise exception 'fees exceed gross notional' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists raw_signals_immutable on app_private.raw_signals;
create trigger raw_signals_immutable
before update or delete on app_private.raw_signals
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists market_snapshots_immutable on app_private.market_snapshots;
create trigger market_snapshots_immutable
before update or delete on app_private.market_snapshots
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists risk_snapshots_immutable on app_private.risk_snapshots;
create trigger risk_snapshots_immutable
before update or delete on app_private.risk_snapshots
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists commission_ledger_immutable on app_private.commission_ledger_entries;
create trigger commission_ledger_immutable
before update or delete on app_private.commission_ledger_entries
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists admin_audit_immutable on app_private.admin_audit_log;
create trigger admin_audit_immutable
before update or delete on app_private.admin_audit_log
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists trade_executions_validate_fees on app_private.trade_executions;
create trigger trade_executions_validate_fees
before insert or update of gross_notional_lamports, platform_fee_lamports, creator_fee_lamports
on app_private.trade_executions
for each row execute function app_private.validate_execution_fees();

drop trigger if exists signal_deliveries_touch_updated_at on app_private.signal_deliveries;
create trigger signal_deliveries_touch_updated_at
before update on app_private.signal_deliveries
for each row execute function app_private.touch_updated_at();

drop trigger if exists trade_intents_touch_updated_at on app_private.trade_intents;
create trigger trade_intents_touch_updated_at
before update on app_private.trade_intents
for each row execute function app_private.touch_updated_at();

drop trigger if exists trade_executions_touch_updated_at on app_private.trade_executions;
create trigger trade_executions_touch_updated_at
before update on app_private.trade_executions
for each row execute function app_private.touch_updated_at();

drop trigger if exists positions_touch_updated_at on app_private.positions;
create trigger positions_touch_updated_at
before update on app_private.positions
for each row execute function app_private.touch_updated_at();

drop trigger if exists affiliate_profiles_touch_updated_at on app_private.affiliate_profiles;
create trigger affiliate_profiles_touch_updated_at
before update on app_private.affiliate_profiles
for each row execute function app_private.touch_updated_at();

drop trigger if exists durable_jobs_touch_updated_at on app_private.durable_jobs;
create trigger durable_jobs_touch_updated_at
before update on app_private.durable_jobs
for each row execute function app_private.touch_updated_at();

alter table app_private.source_ownership_history enable row level security;
alter table app_private.scanner_adapters enable row level security;
alter table app_private.scanner_tokens enable row level security;
alter table app_private.scanner_pools enable row level security;
alter table app_private.market_snapshots enable row level security;
alter table app_private.risk_snapshots enable row level security;
alter table app_private.raw_signals enable row level security;
alter table app_private.parsed_signals enable row level security;
alter table app_private.signal_deliveries enable row level security;
alter table app_private.trade_intents enable row level security;
alter table app_private.trade_executions enable row level security;
alter table app_private.execution_legs enable row level security;
alter table app_private.positions enable row level security;
alter table app_private.position_lots enable row level security;
alter table app_private.cash_movements enable row level security;
alter table app_private.affiliate_profiles enable row level security;
alter table app_private.referral_links enable row level security;
alter table app_private.referral_events enable row level security;
alter table app_private.payout_requests enable row level security;
alter table app_private.commission_ledger_entries enable row level security;
alter table app_private.pnl_card_records enable row level security;
alter table app_private.performance_snapshots enable row level security;
alter table app_private.outbox_events enable row level security;
alter table app_private.durable_jobs enable row level security;
alter table app_private.worker_leases enable row level security;
alter table app_private.system_flags enable row level security;
alter table app_private.admin_audit_log enable row level security;
alter table app_private.rate_limit_buckets enable row level security;

revoke all on all tables in schema app_private from public, anon, authenticated;
