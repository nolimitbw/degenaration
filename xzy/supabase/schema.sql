-- ============================================================
-- Xzy — initial schema
-- Standalone. No dependency on any other project's tables.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- users ----------
-- Keyed on the numeric Telegram ID. Usernames are reassignable in Telegram, so they
-- are stored for display and never used as an identity or authorization key.
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  tg_id       text not null unique,
  username    text,
  first_name  text,
  created_at  timestamptz not null default now(),
  constraint users_tg_id_numeric check (tg_id ~ '^[0-9]{1,19}$')
);

-- ---------- channels ----------
-- A channel is listed when its owner promotes the bot to admin, and copyable only
-- once an admin approves it. Listing is not approval.
create table if not exists public.channels (
  id              uuid primary key default gen_random_uuid(),
  chat_id         text not null unique,
  title           text,
  username        text,
  listed_by_tg_id text,
  status          text not null default 'pending',
  member_count    integer,
  listed_at       timestamptz not null default now(),
  approved_at     timestamptz,
  constraint channels_status_valid check (status in ('pending', 'approved', 'rejected', 'removed')),
  constraint channels_chat_id_numeric check (chat_id ~ '^-?[0-9]{1,19}$'),
  constraint channels_member_count_sane check (member_count is null or member_count >= 0),
  -- An approved channel must carry the time it was approved; the audit trail is not optional.
  constraint channels_approved_has_time check (status <> 'approved' or approved_at is not null)
);

create index if not exists channels_status_idx on public.channels (status, approved_at desc);

-- ---------- calls ----------
-- The journal. Every Solana mint posted in an approved channel lands here, recorded
-- before any pricing or filtering happens, so the record of what was called is never
-- lost to a slow price feed.
create table if not exists public.calls (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid not null references public.channels (id) on delete cascade,
  chat_id           text not null,
  mint              text not null,
  message_id        text not null,
  event_version     text not null default 'original',
  confidence        text not null default 'medium',
  caller            text,
  called_at         timestamptz not null default now(),
  recorded_at       timestamptz not null default now(),
  symbol            text,
  called_price_usd  numeric,
  called_mcap       numeric,
  called_liquidity_usd numeric,
  latest_price_usd  numeric,
  peak_price_usd    numeric,
  last_scanned_at   timestamptz
);

-- Idempotency. Telegram redelivers updates freely and a webhook can be retried at any
-- time, so dedup lives in the database rather than in process memory a restart loses.
create unique index if not exists calls_event_unique
  on public.calls (chat_id, message_id, event_version, mint);

create index if not exists calls_channel_time_idx on public.calls (channel_id, called_at desc);
create index if not exists calls_scan_idx on public.calls (called_at desc);

-- ---------- row level security ----------
-- Every table is closed by default. All access goes through the service key from server
-- code that has already verified who the caller is; no anon or authenticated policy is
-- granted, so a leaked public key reads nothing.
alter table public.users    enable row level security;
alter table public.channels enable row level security;
alter table public.calls    enable row level security;

-- ============================================================
-- Trading
-- ============================================================

-- ---------- wallets ----------
-- One custodial wallet per user. `encrypted_secret` is AES-256-GCM ciphertext under a
-- master key held only in the environment, so a database dump alone yields no keys.
-- The plaintext key never leaves the server process that signs with it.
create table if not exists public.wallets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references public.users (id) on delete cascade,
  address          text not null unique,
  encrypted_secret text not null,
  created_at       timestamptz not null default now()
);

-- ---------- subscriptions ----------
-- What a user copies, and on what terms. This is the whole configuration surface:
-- pick a channel, set size, set a daily ceiling, set take-profits and a stop.
create table if not exists public.subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  channel_id     uuid not null references public.channels (id) on delete cascade,
  per_trade_sol  numeric not null,
  max_daily_sol  numeric not null,
  -- [{ "gainPct": 100, "sellPct": 50 }, ...] validated in application code before write.
  take_profits   jsonb not null default '[]'::jsonb,
  stop_loss_pct  numeric,
  slippage_bps   integer not null default 300,
  paused         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, channel_id),
  constraint subscriptions_per_trade_positive check (per_trade_sol >= 0.001 and per_trade_sol <= 100),
  constraint subscriptions_daily_positive check (max_daily_sol > 0 and max_daily_sol <= 1000),
  -- A daily cap below one trade would refuse the very first copy, which reads as a
  -- broken bot rather than as a limit doing its job.
  constraint subscriptions_daily_covers_trade check (max_daily_sol >= per_trade_sol),
  constraint subscriptions_stop_loss_range check (stop_loss_pct is null or (stop_loss_pct > 0 and stop_loss_pct < 100)),
  constraint subscriptions_slippage_range check (slippage_bps between 1 and 5000)
);

create index if not exists subscriptions_channel_idx on public.subscriptions (channel_id) where paused = false;

-- ---------- positions ----------
create table if not exists public.positions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  -- Nullable: a manual /buy has no subscription and no call behind it. Copied positions
  -- always carry both, which the unique index below still enforces for them.
  subscription_id   uuid references public.subscriptions (id) on delete cascade,
  call_id           uuid references public.calls (id) on delete cascade,
  mint              text not null,
  symbol            text,
  status            text not null default 'open',
  amount_sol        numeric not null,
  tokens_bought     numeric not null,
  tokens_remaining  numeric not null,
  entry_price_usd   numeric,
  entry_signature   text,
  -- Exit rules are copied onto the position at open time, not read live from the
  -- subscription. Changing your ladder must not retroactively rewrite the terms of a
  -- trade that is already running.
  take_profits      jsonb not null default '[]'::jsonb,
  stop_loss_pct     numeric,
  slippage_bps      integer not null default 300,
  realized_sol      numeric not null default 0,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  constraint positions_status_valid check (status in ('open', 'closed', 'failed')),
  -- One position per call per subscription: the guard against a redelivered call being
  -- bought twice. Postgres treats NULLs as distinct here, so manual buys are unaffected.
  unique (subscription_id, call_id),
  -- A copied position must carry both halves of that key, or the guard silently lapses.
  constraint positions_copy_has_both check (
    (subscription_id is null and call_id is null) or (subscription_id is not null and call_id is not null)
  )
);

create index if not exists positions_open_idx on public.positions (status, opened_at) where status = 'open';
create index if not exists positions_user_idx on public.positions (user_id, opened_at desc);

-- ---------- position exits ----------
-- Every partial sell, kept as an append-only record so realised PnL can be recomputed
-- from the ledger rather than trusted from a running total.
create table if not exists public.position_exits (
  id           uuid primary key default gen_random_uuid(),
  position_id  uuid not null references public.positions (id) on delete cascade,
  kind         text not null,
  level_index  integer,
  fraction     numeric not null,
  sol_out      numeric not null,
  price_usd    numeric,
  signature    text,
  exited_at    timestamptz not null default now(),
  constraint position_exits_kind_valid check (kind in ('take_profit', 'stop_loss', 'manual'))
);

create index if not exists position_exits_position_idx on public.position_exits (position_id, exited_at);

-- ---------- daily spend ----------
-- Ledger of committed SOL per user per UTC day, enforcing the daily ceiling. Rows are
-- appended (including negative refunds) rather than updated, so a concurrent copy
-- cannot lose a write to a read-modify-write race.
create table if not exists public.daily_spend (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  day        date not null,
  amount_sol numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists daily_spend_user_day_idx on public.daily_spend (user_id, day);

alter table public.wallets        enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.positions      enable row level security;
alter table public.position_exits enable row level security;
alter table public.daily_spend    enable row level security;

-- ============================================================
-- Channel scoring
-- ============================================================

-- Rolling performance, recomputed by the scanner. Stored rather than aggregated on read
-- so the marketplace list stays one cheap query as the call journal grows.
alter table public.channels
  add column if not exists calls_measured   integer not null default 0,
  add column if not exists wins             integer not null default 0,
  add column if not exists avg_peak_x       numeric,
  add column if not exists median_peak_x    numeric,
  add column if not exists best_peak_x      numeric,
  add column if not exists stats_updated_at timestamptz;

-- A call counts as measured only once we have both a price at call time and a peak
-- since. Anything else is unmeasured and must never be shown as a zero.
create index if not exists calls_measurable_idx
  on public.calls (channel_id)
  where called_price_usd is not null;

-- ============================================================
-- Fees
-- ============================================================

-- Append-only fee ledger. Every accrual is a row, so what is owed to a channel is a sum
-- over this table rather than a running total that a failed write could desynchronise.
create table if not exists public.fee_accruals (
  id            uuid primary key default gen_random_uuid(),
  position_id   uuid references public.positions (id) on delete set null,
  user_id       uuid references public.users (id) on delete set null,
  -- Null for a manual trade: no caller earned anything.
  channel_id    uuid references public.channels (id) on delete set null,
  kind          text not null,
  trade_sol     numeric not null,
  fee_bps       integer not null,
  total_fee_sol numeric not null,
  channel_sol   numeric not null default 0,
  platform_sol  numeric not null default 0,
  paid_out      boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint fee_accruals_kind_valid check (kind in ('entry', 'exit')),
  constraint fee_accruals_non_negative check (total_fee_sol >= 0 and channel_sol >= 0 and platform_sol >= 0),
  -- The split must always reconstruct the total; a mismatch means money was invented.
  constraint fee_accruals_split_balances check (abs((channel_sol + platform_sol) - total_fee_sol) < 0.000001)
);

create index if not exists fee_accruals_channel_idx on public.fee_accruals (channel_id, paid_out);
create index if not exists fee_accruals_user_idx on public.fee_accruals (user_id, created_at desc);

alter table public.fee_accruals enable row level security;
