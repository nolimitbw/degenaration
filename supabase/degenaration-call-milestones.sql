-- Honest per-call outcomes, recorded whether or not anyone copied the call.
--
-- Every Discord source accrues a public record from the same live data: how many of its
-- calls ran +50%, 2x, 5x, and how many bled -50%. Nothing here depends on a subscriber
-- existing — the performance scanner prices every journaled call.
--
-- Milestones are write-once timestamps against the call's PEAK (for the up legs) and
-- TROUGH (for the down leg). A call that ran 3x and round-tripped keeps its 2x badge:
-- that is what actually happened, and pretending otherwise would flatter nobody.

alter table public.calls
  add column if not exists trough_price_usd numeric,
  add column if not exists hit_down_50_at timestamptz,
  add column if not exists hit_up_50_at timestamptz,
  add column if not exists hit_2x_at timestamptz,
  add column if not exists hit_5x_at timestamptz,
  add column if not exists outcome text;

comment on column public.calls.outcome is
  'open | win | loss — win once the call ran +50% from entry, loss once it fell -50%, whichever came first.';

-- The scanner sweeps by age, and the journal reads by source.
create index if not exists calls_scan_idx on public.calls (called_at desc, last_scanned_at nulls first);
create index if not exists calls_group_called_idx on public.calls (group_id, called_at desc);

-- ============================================================
-- Per-source public record
-- ============================================================
drop view if exists public.source_call_stats;
create view public.source_call_stats
with (security_invoker = true)
as
select
  c.group_id,
  count(*)::int                                                as calls,
  count(*) filter (where c.hit_up_50_at is not null)::int      as calls_up_50,
  count(*) filter (where c.hit_2x_at is not null)::int         as calls_2x,
  count(*) filter (where c.hit_5x_at is not null)::int         as calls_5x,
  count(*) filter (where c.hit_down_50_at is not null)::int    as calls_down_50,
  count(*) filter (where c.outcome = 'win')::int               as wins,
  count(*) filter (where c.outcome = 'loss')::int              as losses,
  count(*) filter (where c.outcome = 'open' or c.outcome is null)::int as open_calls,
  -- Win rate over SETTLED calls only; an open call has not proved anything yet.
  case
    when count(*) filter (where c.outcome in ('win', 'loss')) = 0 then null
    else round(
      100.0 * count(*) filter (where c.outcome = 'win')
      / count(*) filter (where c.outcome in ('win', 'loss'))
    )::int
  end                                                          as win_rate,
  max(c.peak_price_usd / nullif(c.called_price_usd, 0))         as best_multiple,
  percentile_cont(0.5) within group (
    order by c.peak_price_usd / nullif(c.called_price_usd, 0)
  )                                                            as median_peak_multiple,
  max(c.called_at)                                             as last_call_at
from public.calls c
where c.group_id is not null
  and c.deleted_at is null
  and coalesce(c.parse_status, 'accepted') = 'accepted'
group by c.group_id;

grant select on public.source_call_stats to anon, authenticated, service_role;
