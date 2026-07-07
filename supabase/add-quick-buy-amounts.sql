-- Run once in the Supabase SQL editor. schema.sql's "create table if not exists"
-- is a no-op on the already-provisioned profiles table, so the new
-- quick_buy_amounts column needs this separate ALTER to reach the live DB.

alter table public.profiles
  add column if not exists quick_buy_amounts numeric[] not null default '{0.1,0.5,1,2}';
