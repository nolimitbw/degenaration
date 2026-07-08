-- Run once in the Supabase SQL editor. Adds take-profit/stop-loss/partials columns
-- to the already-provisioned copy_subscriptions table (mirrors the group-call
-- `subscriptions` table's tp1/tp1_sell/tp2/tp2_sell/stop_loss shape).

alter table public.copy_subscriptions
  add column if not exists tp1 numeric default 2,
  add column if not exists tp1_sell int default 50,
  add column if not exists tp2 numeric default 5,
  add column if not exists tp2_sell int default 25,
  add column if not exists stop_loss int default 40;
