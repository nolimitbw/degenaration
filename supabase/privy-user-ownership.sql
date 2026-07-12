-- Add Privy-native ownership columns for rows created by the Next.js API.
-- Existing Supabase Auth user_id rows continue to work; Privy rows are filtered server-side.

alter table public.subscriptions add column if not exists privy_user_id text;
alter table public.limit_orders add column if not exists privy_user_id text;
alter table public.copy_subscriptions add column if not exists privy_user_id text;

alter table public.subscriptions alter column user_id drop not null;

create unique index if not exists subscriptions_privy_group_key
  on public.subscriptions (privy_user_id, group_id)
  where privy_user_id is not null;

create unique index if not exists copy_subscriptions_privy_leader_key
  on public.copy_subscriptions (privy_user_id, leader_wallet)
  where privy_user_id is not null;

create index if not exists limit_orders_privy_status_idx
  on public.limit_orders (privy_user_id, status, created_at desc)
  where privy_user_id is not null;
