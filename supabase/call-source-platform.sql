-- ============================================================
-- Discord call-source platform
-- Run after supabase/calls.sql and supabase/discord-bot.sql.
-- This preserves existing calls and makes every public source score measurable.
-- ============================================================

alter table public.approved_groups
  add column if not exists discord_guild_id text;

alter table public.call_channels
  add column if not exists guild_member_count integer check (guild_member_count is null or guild_member_count >= 0),
  add column if not exists approved_at timestamptz;

alter table public.calls
  add column if not exists channel_id text,
  add column if not exists channel_name text,
  add column if not exists confidence text,
  add column if not exists called_price_usd numeric,
  add column if not exists peak_price_usd numeric,
  add column if not exists latest_price_usd numeric,
  add column if not exists latest_mcap numeric,
  add column if not exists called_liquidity_usd numeric,
  add column if not exists latest_liquidity_usd numeric,
  add column if not exists last_scanned_at timestamptz;

create index if not exists calls_group_called_at_idx on public.calls (group_id, called_at desc);
create index if not exists calls_performance_scan_idx on public.calls (called_at desc);
create index if not exists call_channels_guild_group_idx on public.call_channels (guild_id, group_id);
