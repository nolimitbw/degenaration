drop function if exists public.app_public_discord_journal_stats(text, text);
drop function if exists public.worker_record_call_market_scan(
  uuid, text, timestamptz, numeric, numeric, numeric, text
);
drop table if exists app_private.call_performance_milestones;
alter table public.calls
  drop column if exists tracking_started_at,
  drop column if exists performance_status,
  drop column if exists performance_freshness,
  drop column if exists performance_provider,
  drop column if exists maximum_return_bps,
  drop column if exists current_return_bps,
  drop column if exists minimum_price_usd;
