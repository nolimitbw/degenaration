-- Add the `positions` table to a LIVE Supabase project.
-- Run once in the Supabase SQL editor (the anon/publishable key cannot DDL).
-- Idempotent: safe to re-run. Mirrors the block added to supabase/schema.sql.
-- The 24/7 monitor reads these open rows to fire per-subscription TP/SL sells.

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_pubkey text not null,
  wallet_id text,
  mint text not null,
  entry_price_usd numeric not null,
  amount_raw numeric not null,           -- raw token units held (not human amount)
  tp1 numeric, tp1_sell int default 50,
  tp2 numeric, tp2_sell int default 25,
  stop_loss int,
  slippage_bps int not null default 300,
  filled_tp1 boolean not null default false,
  filled_tp2 boolean not null default false,
  status text not null default 'open' check (status in ('open','closed')),
  entry_sig text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table public.positions enable row level security;
drop policy if exists "own positions" on public.positions;
create policy "own positions" on public.positions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
