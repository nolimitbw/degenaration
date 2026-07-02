-- Recorded Discord calls for the Alpha leaderboard (real performance tracking)
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.approved_groups(id) on delete set null,
  group_name text,
  caller text,
  mint text not null,
  symbol text,
  called_mcap numeric,     -- market cap when the call was made
  peak_mcap numeric,       -- highest market cap since the call
  called_at timestamptz not null default now()
);
alter table public.calls enable row level security;
drop policy if exists "public read calls" on public.calls;
create policy "public read calls" on public.calls for select using (true);
