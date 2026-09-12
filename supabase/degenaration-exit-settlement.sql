-- Exits: consume lots, realize PnL, close positions.
--
-- WHY
--
-- degenaration-settlement-writer.sql opened positions and wrote entry lots. Nothing ever
-- closed one. A sell settling through the same trigger wrote a trade_executions row and then
-- returned early at `if v_intent.side <> 'buy' then return new; end if;`, which left:
--
--   * position_lots.remaining_base_units permanently equal to quantity_base_units, so every
--     position looked fully held no matter how much had been sold,
--   * positions.quantity_base_units never decreasing and status never reaching 'closed',
--   * realized_pnl_lamports structurally 0 for every user, which is why durable losing-trade
--     PnL was recorded as BLOCKED rather than merely unimplemented,
--   * withdrawable capital understated, because a closed position still read as held.
--
-- AND A FEE BUG THIS FIXES
--
-- The previous writer set the executed notional to `floor(requested_input_base_units)` for
-- BOTH sides. For a buy that is lamports and correct. For a sell the input is the TOKEN, so a
-- sale of 1_000_000_000 token base units was recorded as a 1 SOL notional and charged fee on
-- it. That is a fabricated fee basis with no relation to the SOL received. A sell's notional
-- is its proceeds, which only the worker can measure, so `proceeds_lamports` is added to the
-- queue for it to report — null until it does, and a null notional charges nothing rather
-- than charging on a token count.
--
-- WHAT IS DELIBERATELY NOT DONE
--
-- Realized PnL is written only when proceeds were actually reported. An exit whose proceeds
-- are unknown records the quantity and the cost basis released, and leaves realized_pnl null
-- on the exit row. A zero there would read as "broke even" when the truth is "not measured".
--
-- APPLY ORDER
--
-- After degenaration-settlement-writer.sql and degenaration-execution-record-fields.sql. It
-- replaces settle_execution_into_ledger with a superset of that version; applying it earlier
-- would be overwritten by them.
--
-- Forward safety: one new table, one new nullable column per queue table, one function
-- replaced with a superset. No existing row or constraint changes.
-- Rollback: drop position_exits and apply_exit_to_position, restore the prior settle body.

-- ---------------------------------------------------------------------------------------
-- 1. What the worker measures on a sell
-- ---------------------------------------------------------------------------------------

alter table app_private.call_executions
  add column if not exists proceeds_lamports bigint;
alter table app_private.copy_executions
  add column if not exists proceeds_lamports bigint;

alter table app_private.call_executions
  drop constraint if exists call_executions_proceeds_nonnegative;
alter table app_private.call_executions
  add constraint call_executions_proceeds_nonnegative
  check (proceeds_lamports is null or proceeds_lamports >= 0);

alter table app_private.copy_executions
  drop constraint if exists copy_executions_proceeds_nonnegative;
alter table app_private.copy_executions
  add constraint copy_executions_proceeds_nonnegative
  check (proceeds_lamports is null or proceeds_lamports >= 0);

-- ---------------------------------------------------------------------------------------
-- 2. The exit record
-- ---------------------------------------------------------------------------------------

-- One row per (settled sell, position it consumed). A single sell may span several positions
-- in the same mint, which is why this is not a column on positions: the attribution of
-- proceeds and basis across them has to be inspectable afterwards.
create table if not exists app_private.position_exits (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references app_private.positions(id) on delete restrict,
  exit_execution_id uuid not null references app_private.trade_executions(id) on delete restrict,
  quantity_base_units numeric(39, 0) not null check (quantity_base_units > 0),
  cost_basis_lamports bigint not null check (cost_basis_lamports >= 0),
  -- Null means the worker did not report what the sale realized. It is not zero.
  proceeds_lamports bigint check (proceeds_lamports is null or proceeds_lamports >= 0),
  realized_pnl_lamports bigint,
  -- True when the sold quantity exceeded the lots on record, so the basis below is only the
  -- part that could be matched. Visible rather than silently clamped.
  basis_incomplete boolean not null default false,
  created_at timestamptz not null default now(),
  unique (exit_execution_id, position_id),
  -- PnL exists exactly when proceeds do. The two cannot disagree.
  check ((proceeds_lamports is null) = (realized_pnl_lamports is null))
);

create index if not exists position_exits_position_idx
  on app_private.position_exits (position_id, created_at desc);

alter table app_private.position_exits enable row level security;

-- FIFO consumption reads open lots by owner and mint on every exit.
create index if not exists position_lots_open_idx
  on app_private.position_lots (position_id, created_at)
  where remaining_base_units > 0;

-- ---------------------------------------------------------------------------------------
-- 3. FIFO lot consumption
-- ---------------------------------------------------------------------------------------

create or replace function app_private.apply_exit_to_position(
  p_exec_id uuid,
  p_owner text,
  p_bot_id uuid,
  p_mint text,
  p_quantity numeric,
  p_proceeds bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot record;
  v_remaining numeric := p_quantity;
  v_take numeric;
  v_basis bigint;
  v_matched numeric;
  v_pos_ids uuid[] := '{}';
  v_qtys numeric[] := '{}';
  v_bases bigint[] := '{}';
  v_idx integer;
  v_i integer;
  v_share bigint;
  v_pnl bigint;
  v_allocated bigint := 0;
  v_left numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  -- Oldest position first, oldest lot within it. Locked so two workers settling exits on the
  -- same mint cannot both consume the same remaining units.
  for v_lot in
    select l.id, l.position_id, l.remaining_base_units, l.quantity_base_units, l.cost_lamports
    from app_private.position_lots l
    join app_private.positions p on p.id = l.position_id
    where p.owner_privy_user_id = p_owner
      and p.mint = p_mint
      and (p_bot_id is null or p.bot_id is not distinct from p_bot_id)
      and p.status in ('open', 'closing')
      and l.remaining_base_units > 0
    order by p.opened_at, l.created_at
    for update of l, p
  loop
    exit when v_remaining <= 0;

    v_take := least(v_lot.remaining_base_units, v_remaining);
    -- Basis released is the lot's cost in proportion to the units taken. floor keeps the
    -- ledger integer and never releases more basis than the lot paid.
    v_basis := floor(v_lot.cost_lamports::numeric * v_take / v_lot.quantity_base_units)::bigint;

    update app_private.position_lots
      set remaining_base_units = remaining_base_units - v_take
      where id = v_lot.id;

    v_remaining := v_remaining - v_take;

    v_idx := array_position(v_pos_ids, v_lot.position_id);
    if v_idx is null then
      v_pos_ids := v_pos_ids || v_lot.position_id;
      v_qtys := v_qtys || v_take;
      v_bases := v_bases || v_basis;
    else
      v_qtys[v_idx] := v_qtys[v_idx] + v_take;
      v_bases[v_idx] := v_bases[v_idx] + v_basis;
    end if;
  end loop;

  v_matched := p_quantity - v_remaining;
  if v_matched <= 0 then
    -- A sale of something the ledger never recorded an entry for. There is no position to
    -- attach an exit to, and inventing one would fabricate a cost basis. The execution row
    -- itself still records the sale.
    return;
  end if;

  for v_i in 1 .. array_length(v_pos_ids, 1) loop
    if p_proceeds is null then
      v_share := null;
      v_pnl := null;
    elsif v_i = array_length(v_pos_ids, 1) and v_remaining <= 0 then
      -- The whole sale matched, so the last position takes the rounding remainder and the
      -- attributed proceeds sum to exactly what was received.
      v_share := p_proceeds - v_allocated;
      v_pnl := v_share - v_bases[v_i];
    else
      v_share := floor(p_proceeds::numeric * v_qtys[v_i] / p_quantity)::bigint;
      v_allocated := v_allocated + v_share;
      v_pnl := v_share - v_bases[v_i];
    end if;

    insert into app_private.position_exits (
      position_id, exit_execution_id, quantity_base_units, cost_basis_lamports,
      proceeds_lamports, realized_pnl_lamports, basis_incomplete
    ) values (
      v_pos_ids[v_i], p_exec_id, v_qtys[v_i], v_bases[v_i],
      v_share, v_pnl, v_remaining > 0
    )
    on conflict (exit_execution_id, position_id) do nothing;

    select p.quantity_base_units - v_qtys[v_i] into v_left
    from app_private.positions p where p.id = v_pos_ids[v_i];

    update app_private.positions p
      set quantity_base_units = greatest(0, v_left),
          realized_pnl_lamports = p.realized_pnl_lamports + coalesce(v_pnl, 0),
          status = case when v_left <= 0 then 'closed' else p.status end,
          closed_at = case when v_left <= 0 then now() else p.closed_at end,
          updated_at = now()
      where p.id = v_pos_ids[v_i];
  end loop;
end;
$$;

revoke execute on function app_private.apply_exit_to_position(uuid, text, uuid, text, numeric, bigint)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Settlement, with the sell side completed
-- ---------------------------------------------------------------------------------------

create or replace function app_private.settle_execution_into_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent app_private.trade_intents%rowtype;
  v_exec_id uuid;
  v_position_id uuid;
  v_gross bigint;
  v_fee_bps integer;
  v_platform_fee bigint;
  v_qty numeric;
begin
  if new.status is distinct from 'succeeded' or new.intent_id is null then
    return new;
  end if;

  select * into v_intent from app_private.trade_intents where id = new.intent_id;
  if not found then
    return new;
  end if;

  if v_intent.side = 'buy' then
    -- The input of a buy is SOL, so the requested input IS the notional in lamports.
    v_gross := floor(v_intent.requested_input_base_units)::bigint;
    if v_gross <= 0 then
      return new;
    end if;
  else
    -- The input of a sell is the token. Its notional is the SOL received, which only the
    -- worker can measure. Unreported means zero notional and therefore zero fee -- never a
    -- fee computed on a token count.
    v_gross := coalesce(new.proceeds_lamports, 0);
  end if;

  v_fee_bps := app_private.current_platform_fee_bps();
  v_platform_fee := floor(v_gross::numeric * v_fee_bps / 10000)::bigint;

  insert into app_private.trade_executions (
    intent_id, owner_privy_user_id, execution_mode, status, attempt,
    tx_signature, slot, gross_notional_lamports,
    executed_base_units, average_price_usd, slippage_bps, price_impact_bps,
    platform_fee_lamports, platform_fee_bps_snapshot,
    creator_fee_lamports, creator_fee_bps_snapshot,
    source_group_id_snapshot, submitted_at, confirmed_at, reconciled_at
  ) values (
    v_intent.id, v_intent.owner_privy_user_id, v_intent.execution_mode, 'reconciled', 1,
    new.tx_signature, new.slot, v_gross,
    new.executed_base_units, new.average_price_usd, new.slippage_bps, new.price_impact_bps,
    v_platform_fee, v_fee_bps,
    0, 0,
    v_intent.source_group_id, new.submitted_at, now(), now()
  )
  on conflict (intent_id, attempt) do nothing
  returning id into v_exec_id;

  -- A replayed settle finds the execution already written and stops here, so it neither
  -- charges a second fee nor consumes the lots a second time.
  if v_exec_id is null then
    return new;
  end if;

  update app_private.trade_intents set state = 'reconciled' where id = v_intent.id;

  v_qty := coalesce(new.executed_base_units, v_intent.requested_input_base_units);

  if v_intent.side = 'sell' then
    perform app_private.apply_exit_to_position(
      v_exec_id,
      v_intent.owner_privy_user_id,
      v_intent.bot_id,
      v_intent.mint,
      v_qty,
      new.proceeds_lamports
    );
    return new;
  end if;

  insert into app_private.positions (
    owner_privy_user_id, bot_id, config_version_id, mint, status,
    quantity_base_units, cost_lamports, realized_pnl_lamports, fees_lamports,
    entry_config_snapshot
  ) values (
    v_intent.owner_privy_user_id, v_intent.bot_id, v_intent.config_version_id,
    v_intent.mint, 'open',
    v_qty, v_gross, 0, v_platform_fee,
    coalesce(v_intent.subscriber_config_snapshot, '{}'::jsonb)
  )
  returning id into v_position_id;

  insert into app_private.position_lots (
    position_id, entry_execution_id, quantity_base_units, remaining_base_units, cost_lamports
  ) values (
    v_position_id, v_exec_id, v_qty, v_qty, v_gross
  );

  return new;
end;
$$;

revoke execute on function app_private.settle_execution_into_ledger() from public, anon, authenticated;
