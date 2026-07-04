-- ============================================================
-- Discord bot integration — run once in the Supabase SQL editor.
-- Adds: call_channels (owner-registered channels the bot listens to),
--       calls dedup/execution columns, and subscription signing columns.
-- ============================================================

-- 1. Channels a server owner registered the bot in. Bot listens ONLY to approved rows.
create table if not exists public.call_channels (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  guild_name text,
  channel_id text not null unique,
  channel_name text,
  group_id uuid references public.approved_groups(id) on delete set null,
  registered_by text,                       -- discord handle of the owner who ran /register
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table public.call_channels enable row level security;
-- No public policies: only the service role (bot/worker/admin) touches this table.

-- 2. calls: dedup by discord message + let the worker know which calls are executed.
alter table public.calls add column if not exists message_id text;
alter table public.calls add column if not exists raw text;
alter table public.calls add column if not exists executed_at timestamptz;
create unique index if not exists calls_message_id_key on public.calls (message_id) where message_id is not null;

-- 3. subscriptions: the worker needs the subscriber's embedded-wallet id + pubkey to sign
--    a delegated buy when their group posts a call (mirrors copy_subscriptions).
alter table public.subscriptions add column if not exists user_pubkey text;
alter table public.subscriptions add column if not exists wallet_id text;
alter table public.subscriptions add column if not exists daily_spent numeric not null default 0;
