-- Let Privy-authenticated users and the automation worker write trade history
-- without requiring a Supabase Auth user row.

alter table public.trades add column if not exists privy_user_id text;
alter table public.trades add column if not exists user_pubkey text;
alter table public.trades alter column user_id drop not null;

create index if not exists trades_privy_created_at_idx
  on public.trades (privy_user_id, created_at desc)
  where privy_user_id is not null;

create index if not exists trades_pubkey_created_at_idx
  on public.trades (user_pubkey, created_at desc)
  where user_pubkey is not null;
