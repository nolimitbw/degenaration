-- Give the worker somewhere to report what only it can measure.
--
-- WHY
--
-- Spec §5.4 requires an execution record to carry slot, executed quantity, average price,
-- slippage and price impact. The settlement writer populates none of them, and the reason
-- given was that the queue row it settles from does not contain them:
--
--     app_private.call_executions:
--       id, call_id, subscription_id, claim_token, status, amount_sol,
--       tx_signature, error, created_at, updated_at, finished_at, submitted_at, intent_id
--
-- That is true and it was the wrong conclusion. "The queue cannot carry it" is an
-- architectural choice, not a law -- and leaving it unchanged means that when the worker is
-- finally deployed (E-3) it will have measured all five figures and had nowhere to put them,
-- so the same gap would be rediscovered later with live money flowing.
--
-- These columns close that. They are nullable and nothing writes them yet, which is the
-- honest state: a null reads as "not captured", where a zero would read as "measured, and it
-- was zero". For slippage on a real trade those are very different claims.
--
-- Forward safety: additive nullable columns only; no existing row, constraint or function
-- signature changes. Rollback: drop the columns.

-- What the worker measures at submit/confirm time and reports back through the queue.
alter table app_private.call_executions
  add column if not exists slot bigint,
  add column if not exists executed_base_units numeric,
  add column if not exists average_price_usd numeric,
  add column if not exists slippage_bps integer,
  add column if not exists price_impact_bps integer;

alter table app_private.copy_executions
  add column if not exists slot bigint,
  add column if not exists executed_base_units numeric,
  add column if not exists average_price_usd numeric,
  add column if not exists slippage_bps integer,
  add column if not exists price_impact_bps integer;

-- The ledger's own copy. trade_executions already had `slot` and nothing upstream produced
-- one; the other four are added beside it so the settled record is complete in one place.
alter table app_private.trade_executions
  add column if not exists executed_base_units numeric,
  add column if not exists average_price_usd numeric,
  add column if not exists slippage_bps integer,
  add column if not exists price_impact_bps integer;

alter table app_private.trade_executions
  drop constraint if exists trade_executions_measurement_bounds;
alter table app_private.trade_executions
  add constraint trade_executions_measurement_bounds check (
    (executed_base_units is null or executed_base_units >= 0)
    and (average_price_usd is null or average_price_usd > 0)
    -- Slippage and impact are bounded because a value outside these ranges is a reporting bug,
    -- not a market condition, and it must fail loudly rather than land in the ledger.
    and (slippage_bps is null or slippage_bps between 0 and 10000)
    and (price_impact_bps is null or price_impact_bps between -10000 and 10000)
  );

-- Settlement now carries the measurements through when the worker supplies them, and writes
-- null when it does not. Everything else in this function is unchanged from
-- degenaration-settlement-writer.sql.
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

  v_gross := floor(v_intent.requested_input_base_units)::bigint;
  if v_gross <= 0 then
    return new;
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

  if v_exec_id is null then
    return new;
  end if;

  update app_private.trade_intents set state = 'reconciled' where id = v_intent.id;

  if v_intent.side <> 'buy' then
    return new;
  end if;

  -- Prefer what the worker actually filled. Falling back to the requested amount keeps the lot
  -- writable before the worker reports fills, and the difference is visible because
  -- executed_base_units is null in that case rather than equal by coincidence.
  v_qty := coalesce(new.executed_base_units, v_intent.requested_input_base_units);

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
