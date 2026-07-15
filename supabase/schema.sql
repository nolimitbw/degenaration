-- ============================================================
-- DEGENARATION — database schema
-- Run in Supabase SQL editor. Safe to re-run (idempotent-ish).
-- ============================================================

-- 1. PROFILES: one row per authenticated user
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  wallet_address text,
  max_trade_sol numeric not null default 0.5,
  daily_cap_sol numeric not null default 2,
  quick_buy_amounts numeric[] not null default '{0.1,0.5,1,2}',
  risk_accepted boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. APPROVED_GROUPS: Discord call groups live on the Calls page
create table if not exists public.approved_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discord_channel_id text,
  members text,
  win_rate int,
  pnl_30d text,
  tag text,
  active boolean not null default true,
  public_slug text,
  referral_code text,
  bio text,
  avatar_url text,
  discord_invite_url text,
  server_application_id uuid,
  created_at timestamptz not null default now()
);

-- 3. SERVER_APPLICATIONS: owners apply to get listed
create table if not exists public.server_applications (
  id uuid primary key default gen_random_uuid(),
  server_name text not null,
  invite_link text not null,
  owner_handle text not null,
  member_count text,
  pitch text,
  status text not null default 'pending', -- pending | approved | rejected
  created_at timestamptz not null default now()
);

-- 4. SUBSCRIPTIONS: which groups a user copies + per-group settings
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.approved_groups(id) on delete cascade,
  size_sol numeric not null default 0.5,
  tp1 numeric default 2, tp1_sell int default 50,
  tp2 numeric default 5, tp2_sell int default 25,
  stop_loss int default 40,
  slippage_bps int default 300,
  daily_cap_sol numeric default 2,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, group_id)
);

-- 5. TRADES: every executed buy/sell (audit + portfolio + fees)
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references public.approved_groups(id),
  mint text not null,
  side text not null,            -- buy | sell
  sol_amount numeric,
  token_amount numeric,
  price_usd numeric,
  fee_sol numeric,               -- the 2% platform fee taken
  tx_signature text,
  kind text,                     -- entry | tp1 | tp2 | sl | manual
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.trades enable row level security;
alter table public.approved_groups enable row level security;
alter table public.server_applications enable row level security;

-- profiles: a user sees/edits only their own row
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- subscriptions: user owns their subs
drop policy if exists "own subs" on public.subscriptions;
create policy "own subs" on public.subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- trades: user reads their own trades
drop policy if exists "own trades read" on public.trades;
create policy "own trades read" on public.trades
  for select using (auth.uid() = user_id);

-- approved_groups: anyone (even anon) can read the active list
drop policy if exists "public read groups" on public.approved_groups;
create policy "public read groups" on public.approved_groups
  for select using (active = true);

-- server_applications: anyone can submit; only inserts allowed publicly
-- Production applies service-role-api-hardening.sql afterward and routes submissions through /api/apply.
drop policy if exists "public apply" on public.server_applications;
create policy "public apply" on public.server_applications
  for insert with check (true);

-- ============================================================
-- Auto-create a profile row when a new auth user signs up
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- No seed data: approved_groups is populated ONLY when the owner approves a real server
-- application in the Admin panel. The Calls page shows an empty state until then.

-- ============================================================
-- Limit orders (client creates; server worker executes on trigger)
-- ============================================================
create table if not exists public.limit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_pubkey text not null,
  wallet_id text,
  mint text not null,
  symbol text,
  trigger text not null check (trigger in ('below','above')),
  target_usd double precision not null,
  amount_sol double precision not null,
  slippage_bps int not null default 300,
  status text not null default 'open' check (status in ('open','filled','cancelled')),
  sig text,
  last_error text,
  created_at timestamptz default now(),
  filled_at timestamptz
);
alter table public.limit_orders enable row level security;
create policy "own limit orders" on public.limit_orders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Copy-trade subscriptions (follow a leader wallet, mirror its buys)
-- ============================================================
create table if not exists public.copy_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_pubkey text not null,
  wallet_id text,
  leader_wallet text not null,
  label text,
  size_sol double precision not null default 0.1,
  -- partial take-profit ladder + stop-loss, same shape as the group-call `subscriptions`
  -- table: tpN is a price multiple (e.g. 2 = 2x), tpN_sell is the % of the position sold there
  tp1 numeric default 2, tp1_sell int default 50,
  tp2 numeric default 5, tp2_sell int default 25,
  stop_loss int default 40,
  slippage_bps int not null default 300,
  daily_cap_sol double precision not null default 2,
  daily_spent double precision not null default 0,
  enabled boolean not null default true,
  created_at timestamptz default now(),
  unique (user_id, leader_wallet)
);
alter table public.copy_subscriptions enable row level security;
create policy "own copy subs" on public.copy_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
