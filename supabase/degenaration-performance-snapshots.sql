-- The writer app_private.performance_snapshots never had.
--
-- WHY
--
-- Four separate surfaces read this table and no code path has ever inserted a row:
--
--   app_user_portfolio_summary        'portfolio'       Portfolio performance and chart
--   app_user_bots                     'bot'            My Bots performance column
--   app_kol_marketplace               'kol-strategy'   KOL cards, and insufficientHistory
--   app_discord_marketplace_sources   'discord-source' the 1D / 7D / 30D figures
--
-- Every one of them left-joins it, so a missing row is silently a dash rather than an error.
-- That is the same missing-writer shape as trade_executions, signal_deliveries and
-- trade_intents: the reader is correct, the aggregation is correct, and nothing upstream
-- produces the row.
--
-- WHAT IT COMPUTES FROM
--
-- Only authoritative reconciled data: app_private.trade_executions for volume and fees, and
-- app_private.position_exits for realized PnL. Both are immutable once written. Nothing here
-- reads a price feed or estimates anything.
--
-- WHAT IT DELIBERATELY LEAVES NULL
--
--   max_drawdown_bps  measured against the REALIZED equity curve -- cumulative realized PnL
--                     by day -- and null until that curve has been above zero, because a fall
--                     from a peak that never existed is not a measurement. It is deliberately
--                     not a marked-to-market drawdown: the ledger does not know what an open
--                     position is worth right now, and inventing that number is the one thing
--                     a performance figure must never do.
--   win_rate_bps      null when no exit has been measured. Zero would read as "every trade
--                     lost", which is a very different claim from "nothing has closed yet".
--
-- Unrealized PnL is deliberately absent: it needs a live price for a held token, which is a
-- market-data question, not a ledger one. What the ledger CAN state is the cost basis still
-- held, and that is published in metrics as unrealizedBasisLamports for the surface to pair
-- with a live quote.
--
-- ONE LABELLING RULE (spec 9.2)
--
-- The 'discord-source' and 'kol-strategy' snapshots measure COPIED EXECUTIONS -- what
-- subscribers actually traded, net of fees. That is not the same as call-signal performance,
-- which is journalled separately from raw signals and price samples. metrics.basis carries
-- 'copied-executions' so a surface can never present one as the other.
--
-- Forward safety: new functions only, and the upsert targets the existing unique key
-- (subject_type, subject_id, period, as_of). Rollback: drop the three functions. Rows already
-- written stay valid.

-- ---------------------------------------------------------------------------------------
-- 1. Window
-- ---------------------------------------------------------------------------------------

create or replace function app_private.performance_window_start(p_period text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case lower(p_period)
    when '1d' then now() - interval '1 day'
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '3m' then now() - interval '90 days'
    else null            -- 'all': no lower bound
  end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Compute and upsert one snapshot
-- ---------------------------------------------------------------------------------------

create or replace function app_private.refresh_performance_snapshot(
  p_subject_type text,
  p_subject_id text,
  p_period text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := app_private.performance_window_start(p_period);
  v_period text := lower(p_period);
  v_as_of timestamptz := date_trunc('hour', now());
  v_id uuid;
  v_executions integer := 0;
  v_volume bigint := 0;
  v_platform bigint := 0;
  v_creator bigint := 0;
  v_network bigint := 0;
  v_measured integer := 0;
  v_unmeasured integer := 0;
  v_wins integer := 0;
  v_realized bigint := 0;
  v_open_basis bigint := 0;
  v_open_positions integer := 0;
  v_series jsonb := '[]'::jsonb;
  v_first timestamptz;
  v_drawdown integer;
begin
  if v_period not in ('1d', '7d', '30d', '3m', 'all') then
    raise exception 'unsupported period %', p_period using errcode = '22023';
  end if;
  if p_subject_type not in ('portfolio', 'bot', 'kol-strategy', 'discord-source') then
    raise exception 'unsupported subject type %', p_subject_type using errcode = '22023';
  end if;

  -- Volume and fees, from reconciled executions the subject owns.
  select count(*),
         coalesce(sum(e.gross_notional_lamports), 0),
         coalesce(sum(e.platform_fee_lamports), 0),
         coalesce(sum(e.creator_fee_lamports), 0),
         coalesce(sum(e.network_fee_lamports + e.priority_fee_lamports), 0)
    into v_executions, v_volume, v_platform, v_creator, v_network
    from app_private.trade_executions e
    join app_private.trade_intents i on i.id = e.intent_id
   where e.status = 'reconciled'
     and (v_from is null or coalesce(e.reconciled_at, e.created_at) >= v_from)
     and case p_subject_type
           when 'portfolio' then e.owner_privy_user_id = p_subject_id
           when 'bot' then i.bot_id::text = p_subject_id
           when 'kol-strategy' then e.strategy_id_snapshot::text = p_subject_id
           when 'discord-source' then e.source_group_id_snapshot::text = p_subject_id
         end;

  -- Realized PnL, from exits whose proceeds were actually measured.
  select count(*) filter (where x.realized_pnl_lamports is not null),
         count(*) filter (where x.realized_pnl_lamports is null),
         count(*) filter (where x.realized_pnl_lamports > 0),
         coalesce(sum(x.realized_pnl_lamports), 0)
    into v_measured, v_unmeasured, v_wins, v_realized
    from app_private.position_exits x
    join app_private.trade_executions e on e.id = x.exit_execution_id
    join app_private.trade_intents i on i.id = e.intent_id
   where (v_from is null or x.created_at >= v_from)
     and case p_subject_type
           when 'portfolio' then e.owner_privy_user_id = p_subject_id
           when 'bot' then i.bot_id::text = p_subject_id
           when 'kol-strategy' then e.strategy_id_snapshot::text = p_subject_id
           when 'discord-source' then e.source_group_id_snapshot::text = p_subject_id
         end;

  -- Cost basis still held. Point-in-time, not windowed: what is open is open.
  select count(distinct p.id), coalesce(sum(
           floor(l.cost_lamports::numeric * l.remaining_base_units
                 / nullif(l.quantity_base_units, 0))
         ), 0)
    into v_open_positions, v_open_basis
    from app_private.position_lots l
    join app_private.positions p on p.id = l.position_id
   where l.remaining_base_units > 0
     and p.status in ('opening', 'open', 'closing')
     and case p_subject_type
           when 'portfolio' then p.owner_privy_user_id = p_subject_id
           when 'bot' then p.bot_id::text = p_subject_id
           else exists (
             select 1
             from app_private.position_lots l2
             join app_private.trade_executions e2 on e2.id = l2.entry_execution_id
             where l2.position_id = p.id
               and case p_subject_type
                     when 'kol-strategy' then e2.strategy_id_snapshot::text = p_subject_id
                     else e2.source_group_id_snapshot::text = p_subject_id
                   end
           )
         end;

  -- The equity series the Portfolio chart reads. It is CUMULATIVE REALIZED PnL by day, not
  -- a marked-to-market curve: the ledger knows what closed trades returned and does not know
  -- what an open position is worth right now. That is also exactly what the chart's own
  -- header claims -- trading return with deposits and withdrawals excluded -- so plotting
  -- realized PnL is the honest reading of it rather than a narrower one.
  select coalesce(jsonb_agg(jsonb_build_object(
           't', d.day,
           'equityLamports', d.cumulative::text,
           'exits', d.exits
         ) order by d.day), '[]'::jsonb),
         min(d.day),
         -- Drawdown of that realized curve: the deepest fall from a running peak, in bps of
         -- the peak. Null while the curve has never been above zero, because a drawdown from
         -- a peak that does not exist is not a measurement.
         max(case when d.peak > 0
                  then floor((d.peak - d.cumulative)::numeric * 10000 / d.peak)::integer
             end)
    into v_series, v_first, v_drawdown
  from (
    select c.day, c.exits, c.cumulative,
           max(c.cumulative) over (order by c.day
             rows between unbounded preceding and current row) as peak
    from (
    select g.day, g.exits,
           sum(g.realized) over (order by g.day
             rows between unbounded preceding and current row) as cumulative
    from (
      select date_trunc('day', x.created_at) as day,
             count(*) as exits,
             sum(x.realized_pnl_lamports) as realized
        from app_private.position_exits x
        join app_private.trade_executions e on e.id = x.exit_execution_id
        join app_private.trade_intents i on i.id = e.intent_id
       where x.realized_pnl_lamports is not null
         and (v_from is null or x.created_at >= v_from)
         and case p_subject_type
               when 'portfolio' then e.owner_privy_user_id = p_subject_id
               when 'bot' then i.bot_id::text = p_subject_id
               when 'kol-strategy' then e.strategy_id_snapshot::text = p_subject_id
               when 'discord-source' then e.source_group_id_snapshot::text = p_subject_id
             end
       group by 1
    ) g
    ) c
  ) d;

  -- A single closed trade is one observation, and one point draws no line. The origin is the
  -- day before it at zero -- true by definition, since nothing had been realized yet.
  if jsonb_array_length(v_series) > 0 then
    v_series := jsonb_build_array(jsonb_build_object(
      't', v_first - interval '1 day', 'equityLamports', '0', 'exits', 0
    )) || v_series;
  end if;

  insert into app_private.performance_snapshots (
    subject_type, subject_id, period, as_of, sample_size,
    net_pnl_lamports, realized_pnl_lamports, volume_lamports,
    network_fees_lamports, platform_fees_lamports, creator_fees_lamports,
    max_drawdown_bps, win_rate_bps, metrics
  ) values (
    p_subject_type, p_subject_id, v_period, v_as_of, v_measured,
    -- Realized PnL is already net of the platform fee: a buy's cost basis includes it and a
    -- sell's proceeds are what the wallet actually received. Network fees are paid separately
    -- in SOL, so they are the one thing still to subtract.
    case when v_measured = 0 then null else v_realized - v_network end,
    case when v_measured = 0 then null else v_realized end,
    v_volume,
    v_network, v_platform, v_creator,
    v_drawdown,
    case when v_measured = 0 then null
         else floor(v_wins::numeric * 10000 / v_measured)::integer end,
    jsonb_build_object(
      'basis', case when p_subject_type in ('discord-source', 'kol-strategy')
                    then 'copied-executions' else 'owner-executions' end,
      'executionCount', v_executions,
      'measuredExits', v_measured,
      'unpricedExits', v_unmeasured,
      'winningExits', v_wins,
      'openPositions', v_open_positions,
      'unrealizedBasisLamports', v_open_basis::text,
      'equitySeries', v_series,
      'computedAt', now()
    )
  )
  on conflict (subject_type, subject_id, period, as_of) do update
    set sample_size = excluded.sample_size,
        net_pnl_lamports = excluded.net_pnl_lamports,
        realized_pnl_lamports = excluded.realized_pnl_lamports,
        volume_lamports = excluded.volume_lamports,
        network_fees_lamports = excluded.network_fees_lamports,
        platform_fees_lamports = excluded.platform_fees_lamports,
        creator_fees_lamports = excluded.creator_fees_lamports,
        -- Every computed column must appear here. Omitting one means a second refresh in the
        -- same hour bucket silently keeps the first run's value, which is how max_drawdown_bps
        -- stayed null through an entire verifier run that otherwise passed.
        max_drawdown_bps = excluded.max_drawdown_bps,
        win_rate_bps = excluded.win_rate_bps,
        metrics = excluded.metrics
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function app_private.refresh_performance_snapshot(text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Refresh every subject that has authoritative data
-- ---------------------------------------------------------------------------------------

-- Driven off the ledger rather than off the subject tables, so a source with no executions
-- gets no snapshot at all -- which is what makes the marketplace show "tracking" instead of a
-- fabricated zero.
create or replace function app_private.refresh_all_performance_snapshots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text;
  v_subject record;
  v_count integer := 0;
begin
  foreach v_period in array array['1d', '7d', '30d', '3m', 'all'] loop
    for v_subject in
      select 'portfolio' as t, e.owner_privy_user_id as id
        from app_private.trade_executions e where e.status = 'reconciled'
       union
      select 'bot', i.bot_id::text
        from app_private.trade_executions e
        join app_private.trade_intents i on i.id = e.intent_id
       where e.status = 'reconciled' and i.bot_id is not null
       union
      select 'kol-strategy', e.strategy_id_snapshot::text
        from app_private.trade_executions e
       where e.status = 'reconciled' and e.strategy_id_snapshot is not null
       union
      select 'discord-source', e.source_group_id_snapshot::text
        from app_private.trade_executions e
       where e.status = 'reconciled' and e.source_group_id_snapshot is not null
    loop
      perform app_private.refresh_performance_snapshot(v_subject.t, v_subject.id, v_period);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke execute on function app_private.refresh_all_performance_snapshots()
  from public, anon, authenticated;

-- The operator entry point, in the same shape as its admin siblings: secret gate plus a
-- named actor, so a refresh is attributable.
create or replace function public.admin_refresh_performance(
  p_secret text,
  p_actor_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);
  v_count := app_private.refresh_all_performance_snapshots();
  return jsonb_build_object('ok', true, 'snapshotsRefreshed', v_count, 'asOf', now());
end;
$$;

revoke execute on function public.admin_refresh_performance(text, text) from public, anon, authenticated;
grant execute on function public.admin_refresh_performance(text, text) to service_role;
