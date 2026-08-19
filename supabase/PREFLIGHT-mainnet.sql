-- ============================================================
-- MAINNET PREFLIGHT — run this BEFORE setting DELEGATED_SIGNING=on
--
-- Read-only. Changes nothing. Paste into the Supabase SQL editor and read the
-- result: every row must say PASS. The moment delegated signing is enabled, the
-- next Discord call spends real client SOL, so anything FAIL here becomes a
-- failed trade, a stuck position, or a position that can never be sold.
--
-- WARN rows are not blockers, but read them — they are the things that surprise
-- people at 3am.
-- ============================================================

with checks as (

  -- ---- schema: the migrations must actually be applied ----
  select 1 as ord, 'Call milestones applied' as check_name,
    case when count(*) = 6 then 'PASS' else 'FAIL' end as status,
    count(*)::text || ' of 6 milestone columns on public.calls' as detail
  from information_schema.columns
  where table_schema = 'public' and table_name = 'calls'
    and column_name in ('trough_price_usd','hit_down_50_at','hit_up_50_at','hit_2x_at','hit_5x_at','outcome')

  union all
  select 2, 'Copy filters applied',
    case when count(*) = 6 then 'PASS' else 'FAIL' end,
    count(*)::text || ' of 6 filter columns on public.subscriptions'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'subscriptions'
    and column_name in ('min_liquidity_usd','max_mcap_usd','cooldown_seconds','skip_duplicate_mints','max_open_positions','max_calls_per_day')

  union all
  select 3, 'Position exit columns applied',
    case when count(*) = 7 then 'PASS' else 'FAIL' end,
    count(*)::text || ' of 7 columns on public.positions'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'positions'
    and column_name in ('privy_user_id','group_id','call_id','subscription_id','opened_by','last_price_usd','last_checked_at')

  union all
  select 4, 'Exit claim table exists',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'app_private.position_exits'
  from information_schema.tables
  where table_schema = 'app_private' and table_name = 'position_exits'

  -- ---- functions the worker calls; a missing one is a silent no-op at runtime ----
  union all
  select 5, 'Worker RPCs present',
    case when count(*) = 8 then 'PASS' else 'FAIL' end,
    'found: ' || coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'worker_claim_call_execution','worker_finish_call_execution','worker_complete_call',
    'worker_open_position','worker_claim_position_exit','worker_finish_position_exit',
    'worker_open_positions','worker_touch_position')

  union all
  select 6, 'Bot secret gate exists',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'app_private.bot_secret_ok — every bot RPC checks this'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private' and p.proname = 'bot_secret_ok'

  union all
  select 7, 'Enrichment RPC present',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'bot_enrich_call_pricing — redeploy bot-bridge if the edge function 400s'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bot_enrich_call_pricing'

  -- ---- the no-double-sell guarantees are index-enforced, not code-enforced ----
  union all
  select 8, 'One position per call+subscription',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'positions_call_subscription_unique — without it a call can open two positions'
  from pg_indexes
  where schemaname = 'public' and indexname = 'positions_call_subscription_unique'

  -- ---- live data: what will actually happen on the next call ----
  union all
  select 9, 'Approved call channels',
    case when count(*) > 0 then 'PASS' else 'WARN' end,
    count(*)::text || ' approved channel(s) — no channels means no calls arrive'
  from public.call_channels where status = 'approved' and removed_at is null

  union all
  select 10, 'Subscriptions that will trade',
    case when count(*) = 0 then 'WARN' else 'PASS' end,
    count(*)::text || ' enabled subscription(s) will buy on the very next call'
  from public.subscriptions where enabled = true

  union all
  select 11, 'Every enabled subscription can sign',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    count(*)::text || ' enabled subscription(s) missing wallet_id or user_pubkey — these buy nothing and confuse the client'
  from public.subscriptions
  where enabled = true and (nullif(wallet_id,'') is null or nullif(user_pubkey,'') is null)

  union all
  select 12, 'Every enabled subscription has a usable exit ladder',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    count(*)::text || ' enabled subscription(s) with tp1<=1x, no stop-loss, or a stop outside 1-99% — their positions could never exit correctly'
  from public.subscriptions
  where enabled = true
    and (coalesce(tp1,0) <= 1 or coalesce(stop_loss,0) <= 0 or coalesce(stop_loss,0) >= 100)

  union all
  select 13, 'Daily caps are set and sane',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    count(*)::text || ' enabled subscription(s) with a daily cap below their per-call size — every call would be skipped'
  from public.subscriptions
  where enabled = true and coalesce(daily_cap_sol,0) < coalesce(size_sol,0)

  -- ---- exposure: the number to look at before flipping the switch ----
  union all
  select 14, 'Maximum SOL at risk per day',
    'INFO',
    coalesce(sum(daily_cap_sol),0)::text || ' SOL across ' || count(*)::text ||
    ' enabled subscription(s); largest single cap ' || coalesce(max(daily_cap_sol),0)::text || ' SOL'
  from public.subscriptions where enabled = true

  union all
  select 15, 'Positions already open',
    case when count(*) = 0 then 'PASS' else 'WARN' end,
    count(*)::text || ' open position(s) — these become live to the exit engine the moment signing is on'
  from public.positions where status = 'open'

  -- ---- anything already bought that the exit engine cannot see ----
  union all
  select 16, 'Executed entries with no position row',
    case when count(*) = 0 then 'PASS' else 'WARN' end,
    count(*)::text || ' succeeded entr(ies) with no position — bought before exits existed, so they have NO stop-loss and must be handled by hand'
  from app_private.call_executions e
  where e.status = 'succeeded'
    and not exists (select 1 from public.positions p where p.call_id = e.call_id and p.subscription_id = e.subscription_id)

  union all
  select 18, 'Take-profits sized against the opening fill',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'positions.opened_amount_raw — without it TP2 sells a share of what TP1 left behind, not of the position'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'positions' and column_name = 'opened_amount_raw'

  union all
  select 19, 'Open positions have a recorded opening fill',
    case when count(*) = 0 then 'PASS' else 'WARN' end,
    count(*)::text || ' open position(s) with no opened_amount_raw — their take-profits fall back to the remaining balance'
  from public.positions where status = 'open' and opened_amount_raw is null

  union all
  select 17, 'Calls still awaiting execution',
    case when count(*) < 50 then 'PASS' else 'WARN' end,
    count(*)::text || ' unexecuted call(s) — a large backlog will all fire at once when signing turns on'
  from public.calls where executed_at is null and group_id is not null
)
select
  case status when 'FAIL' then '[X] FAIL' when 'WARN' then '[!] WARN' when 'INFO' then '[i] INFO' else '[OK] PASS' end as result,
  check_name,
  detail
from checks
order by case status when 'FAIL' then 0 when 'WARN' then 1 when 'INFO' then 2 else 3 end, ord;
